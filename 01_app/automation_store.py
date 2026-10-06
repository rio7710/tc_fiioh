"""Durable, owner-scoped recurring production orchestration (additive schema v1)."""
from __future__ import annotations

import calendar
import json
import sqlite3
import uuid
import sys
from pathlib import Path
from contextlib import closing
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from validate_json_schema import validate_json_schema_file
STAGES = ('manual', '2', '3', '3-1', '4', '5')


def _render_catalog() -> dict:
    return json.loads((ROOT / 'config' / 'render-catalog.json').read_text(encoding='utf-8'))


# Compatibility alias; the catalog is the only platform source of truth.
PLATFORMS = tuple(_render_catalog().get('platforms', {}))


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def next_occurrence(anchor, unit, interval, after):
    """First anchored occurrence strictly after `after`; no end-of-month drift."""
    start = datetime.fromisoformat(anchor).astimezone(KST)
    current = datetime.fromisoformat(after).astimezone(KST)
    if unit != 'month':
        delta = timedelta(days=interval * (7 if unit == 'week' else 1))
        result = start + max(1, (current - start) // delta + 1) * delta
    else:
        months = (current.year - start.year) * 12 + current.month - start.month
        n = max(1, months // interval)
        while True:
            index = start.year * 12 + start.month - 1 + n * interval
            year, month = divmod(index, 12)
            month += 1
            result = start.replace(year=year, month=month, day=min(start.day, calendar.monthrange(year, month)[1]))
            if result > current:
                break
            n += 1
    return result.astimezone(timezone.utc).isoformat()


def validate_config(data):
    validate_json_schema_file(data, ROOT/'contracts'/'automation-settings.schema.json')
    if not isinstance(data, dict) or set(data) - {'schema_version', 'endpoint', 'repeat', 'keywords', 'video', 'voice', 'brand', 'channels', 'render'}:
        raise ValueError('자동화 설정 형식이 올바르지 않습니다.')
    if data.get('schema_version') != '1.0.0' or data.get('endpoint') not in STAGES:
        raise ValueError('자동화 단계 또는 설정 버전이 올바르지 않습니다.')
    config = json.loads(json.dumps(data, allow_nan=False))
    repeat = config.get('repeat', {})
    if not isinstance(repeat, dict) or set(repeat) != {'unit', 'interval'} or repeat['unit'] not in ('day', 'week', 'month', 'count') or type(repeat['interval']) is not int or not 1 <= repeat['interval'] <= (100 if repeat.get('unit') == 'count' else 365):
        raise ValueError('반복 간격은 일·주·월 또는 연속 횟수와 올바른 정수로 입력해 주세요.')
    keywords = config.get('keywords', {})
    if not isinstance(keywords, dict) or set(keywords) != {'count', 'ai', 'month'} or type(keywords['count']) is not int or not 1 <= keywords['count'] <= 5 or type(keywords['ai']) is not bool:
        raise ValueError('키워드는 1~5개로 설정해 주세요.')
    from keyword_pool import load_month_pool
    if keywords['month'] != '' and (not isinstance(keywords['month'], str) or not load_month_pool(keywords['month'])):
        raise ValueError('선택한 월의 키워드 후보가 없습니다.')
    video = config.get('video', {})
    if not isinstance(video, dict) or set(video) != {'scene_count', 'crop'} or type(video['scene_count']) is not int or not 0 <= video['scene_count'] <= 200 or video['crop'] not in ('default', 'manual', 'ai'):
        raise ValueError('영상 옵션이 올바르지 않습니다.')
    level = STAGES.index(config['endpoint'])
    if level >= 4 and video['crop'] == 'manual':
        raise ValueError('사용자 지정 크롭은 수동 작업이 필요합니다. 기본 또는 AI 크롭을 선택해 주세요.')
    render = config.get('render')
    if render is not None:
        catalog = _render_catalog()
        if 'type' in render and render['type'] not in catalog.get('styles', {}):
            raise ValueError('지원하지 않는 자막 스타일입니다.')
        if 'music' in render and render['music'] not in catalog.get('music', {}):
            raise ValueError('지원하지 않는 배경음악입니다.')
    brand = config.get('brand', {})
    if not isinstance(brand, dict) or set(brand) != {'intro', 'outro', 'watermark'} or any(type(v) is not bool for v in brand.values()):
        raise ValueError('브랜드 옵션이 올바르지 않습니다.')
    channels = config.get('channels')
    if not isinstance(channels, list) or any(v not in PLATFORMS for v in channels) or len(channels) != len(set(channels)):
        raise ValueError('채널 선택이 올바르지 않습니다.')
    if level >= 4 and not channels:
        raise ValueError('제작 채널을 한 개 이상 선택해 주세요.')
    return config


class VersionConflict(ValueError):
    pass


class AutomationStore:
    def __init__(self, auth):
        self.auth = auth
        with closing(auth._connect()) as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS automation_schema_versions (
                    version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS automation_settings (
                    user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
                    version INTEGER NOT NULL CHECK(version>0),
                    config_json TEXT NOT NULL CHECK(json_valid(config_json)),
                    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
                    anchor_at TEXT, next_run_at TEXT, updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS automation_runs (
                    run_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                    settings_version INTEGER NOT NULL,
                    scheduled_for TEXT NOT NULL,
                    project_id TEXT REFERENCES projects(project_id) ON DELETE SET NULL,
                    config_json TEXT NOT NULL CHECK(json_valid(config_json)),
                    status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
                    attempt INTEGER NOT NULL DEFAULT 1,
                    stage TEXT NOT NULL DEFAULT 'create_project',
                    cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
                    lease_owner TEXT, lease_until TEXT,
                    error_code TEXT, error_message TEXT,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    UNIQUE(user_id,settings_version,scheduled_for));
                INSERT OR IGNORE INTO automated_projects(project_id,run_id,created_at,status,stage,error_message,endpoint)
                    SELECT project_id,run_id,created_at,status,stage,error_message,
                        COALESCE(json_extract(config_json,'$.endpoint'),'manual')
                    FROM automation_runs WHERE project_id IS NOT NULL;
                UPDATE automated_projects SET
                    status=(SELECT status FROM automation_runs WHERE automation_runs.run_id=automated_projects.run_id),
                    stage=(SELECT stage FROM automation_runs WHERE automation_runs.run_id=automated_projects.run_id),
                    error_message=(SELECT error_message FROM automation_runs WHERE automation_runs.run_id=automated_projects.run_id),
                    endpoint=COALESCE((SELECT json_extract(config_json,'$.endpoint') FROM automation_runs WHERE automation_runs.run_id=automated_projects.run_id),'manual')
                    WHERE EXISTS(SELECT 1 FROM automation_runs WHERE automation_runs.run_id=automated_projects.run_id);
                CREATE INDEX IF NOT EXISTS automation_due ON automation_settings(enabled,next_run_at);
                CREATE UNIQUE INDEX IF NOT EXISTS automation_one_active_owner ON automation_runs(user_id)
                    WHERE status IN ('queued','running');
                CREATE TABLE IF NOT EXISTS automation_steps (
                    job_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL REFERENCES automation_runs(run_id) ON DELETE CASCADE,
                    step_key TEXT NOT NULL, stage TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
                    attempt INTEGER NOT NULL DEFAULT 1,
                    input_json TEXT NOT NULL CHECK(json_valid(input_json)),
                    result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    UNIQUE(run_id,step_key));
                CREATE TABLE IF NOT EXISTS automation_requests (
                    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                    request_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY(user_id,request_id));
                INSERT OR IGNORE INTO automation_schema_versions VALUES(1,strftime('%Y-%m-%dT%H:%M:%f+00:00','now'));
            ''')
            db.commit()

    def snapshot(self, user_id):
        with closing(self.auth._connect()) as db:
            setting = db.execute('SELECT * FROM automation_settings WHERE user_id=?', (user_id,)).fetchone()
            rows = db.execute('''SELECT run_id,project_id,status,stage,attempt,scheduled_for,created_at,
                updated_at,error_code,error_message FROM automation_runs WHERE user_id=?
                ORDER BY created_at DESC LIMIT 20''', (user_id,)).fetchall()
        return {'settings': ({**{k:setting[k] for k in setting.keys() if k!='config_json'}, 'config': json.loads(setting['config_json'])} if setting else None),
                'runs': [dict(row) for row in rows]}

    def configure(self, user_id, action, payload, now=None):
        now = now or now_iso()
        request_id = payload.get('request_id', '')
        if not isinstance(request_id, str) or not 8 <= len(request_id) <= 100:
            raise ValueError('요청 식별자가 올바르지 않습니다.')
        import hashlib
        fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True, allow_nan=False).encode()).hexdigest()
        config = None
        if action in ('save', 'start'):
            config = validate_config(payload.get('config'))
            if action == 'start' and config['endpoint'] == 'manual':
                raise ValueError('자동화할 단계를 선택해 주세요.')
            config['brand_versions'] = {}
            if STAGES.index(config['endpoint']) >= 4:
                assets = self.auth.list_brand_assets(user_id)
                for role, enabled in config['brand'].items():
                    if not enabled:
                        continue
                    candidates = [a for a in assets if a['role'] == role and a['active']]
                    if not candidates:
                        raise ValueError(f'{role} 브랜드 리소스를 먼저 등록해 주세요.')
                    config['brand_versions'][role] = max(candidates, key=lambda a: a['created_at'])['version_id']
        with closing(self.auth._connect()) as db:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute('SELECT fingerprint FROM automation_requests WHERE user_id=? AND request_id=?', (user_id, request_id)).fetchone()
            if previous:
                if previous['fingerprint'] != fingerprint:
                    raise VersionConflict('이미 사용된 요청 식별자입니다.')
                return self.snapshot(user_id)
            setting = db.execute('SELECT * FROM automation_settings WHERE user_id=?', (user_id,)).fetchone()
            if action in ('save', 'start'):
                version = setting['version'] if setting else 0
                if type(payload.get('version')) is not int or payload['version'] != version:
                    raise VersionConflict('다른 창에서 설정이 변경되었습니다. 설정을 다시 열어 주세요.')
                if db.execute("SELECT 1 FROM automation_runs WHERE user_id=? AND status IN ('queued','running')", (user_id,)).fetchone():
                    raise VersionConflict('진행 중인 자동화를 먼저 중지한 뒤 설정해 주세요.')
                db.execute('''INSERT INTO automation_settings VALUES(?,?,?,?,?,?,?)
                    ON CONFLICT(user_id) DO UPDATE SET version=excluded.version,config_json=excluded.config_json,
                    enabled=excluded.enabled,anchor_at=excluded.anchor_at,next_run_at=excluded.next_run_at,updated_at=excluded.updated_at''',
                    (user_id, version + 1, json.dumps(config, ensure_ascii=False), int(action == 'start'),
                     now if action == 'start' else None, now if action == 'start' else None, now))
            elif action == 'stop':
                db.execute('UPDATE automation_settings SET enabled=0,next_run_at=NULL,version=version+1,updated_at=? WHERE user_id=?', (now,user_id))
                db.execute("UPDATE automation_runs SET cancel_requested=1,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,updated_at=? WHERE user_id=? AND status IN ('queued','running')", (now,user_id))
            elif action in ('retry','cancel'):
                run = db.execute('SELECT * FROM automation_runs WHERE run_id=? AND user_id=?', (payload.get('run_id'),user_id)).fetchone()
                if not run:
                    raise ValueError('실행 기록을 찾을 수 없습니다.')
                if action == 'cancel':
                    db.execute("UPDATE automation_runs SET cancel_requested=1,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,updated_at=? WHERE run_id=? AND status IN ('queued','running')", (now,run['run_id']))
                else:
                    if run['status'] != 'failed' or not run['project_id']:
                        raise ValueError('실패한 콘텐츠만 다시 시도할 수 있습니다.')
                    if db.execute("SELECT 1 FROM automation_runs WHERE user_id=? AND status IN ('queued','running')", (user_id,)).fetchone():
                        raise VersionConflict('진행 중인 자동화가 있습니다.')
                    db.execute("UPDATE automation_runs SET status='queued',attempt=attempt+1,cancel_requested=0,error_code=NULL,error_message=NULL,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE run_id=?", (now,run['run_id']))
            else:
                raise ValueError('지원하지 않는 자동화 요청입니다.')
            if action in ('stop','retry','cancel'):
                db.execute('''UPDATE automated_projects SET
                    status=(SELECT status FROM automation_runs WHERE automation_runs.run_id=automated_projects.run_id),
                    stage=(SELECT stage FROM automation_runs WHERE automation_runs.run_id=automated_projects.run_id),
                    error_message=(SELECT error_message FROM automation_runs WHERE automation_runs.run_id=automated_projects.run_id)
                    WHERE run_id IN (SELECT run_id FROM automation_runs WHERE user_id=?)''',(user_id,))
            db.execute('INSERT INTO automation_requests VALUES(?,?,?,?)',(user_id,request_id,fingerprint,now))
            db.commit()
        return self.snapshot(user_id)

    def enqueue_due(self, now=None):
        now = now or now_iso()
        with closing(self.auth._connect()) as db:
            db.execute('BEGIN IMMEDIATE')
            settings = db.execute('SELECT * FROM automation_settings WHERE enabled=1 AND next_run_at<=?', (now,)).fetchall()
            for row in settings:
                if db.execute("SELECT 1 FROM automation_runs WHERE user_id=? AND status IN ('queued','running')", (row['user_id'],)).fetchone():
                    continue
                config = json.loads(row['config_json'])
                project_id, run_id = str(uuid.uuid4()), str(uuid.uuid4())
                group = db.execute('SELECT group_id FROM groups WHERE owner_user_id=? ORDER BY created_at LIMIT 1',(row['user_id'],)).fetchone()
                if not group:
                    continue
                db.execute('''INSERT INTO projects
                    (project_id,owner_user_id,group_id,name,created_at,updated_at)
                    VALUES(?,?,?,?,?,?)''',
                    (project_id,row['user_id'],group['group_id'],'자동 제작 · '+datetime.fromisoformat(now).astimezone(KST).strftime('%m/%d %H:%M'),now,now))
                db.execute('''INSERT INTO automation_runs(run_id,user_id,settings_version,scheduled_for,project_id,config_json,status,created_at,updated_at)
                    VALUES(?,?,?,?,?,?,'queued',?,?)''',(run_id,row['user_id'],row['version'],row['next_run_at'],project_id,row['config_json'],now,now))
                db.execute("INSERT INTO automated_projects(project_id,run_id,created_at,status,stage,endpoint) VALUES(?,?,?,'queued','create_project',?)",(project_id,run_id,now,config['endpoint']))
                repeat = config['repeat']
                if repeat['unit'] == 'count':
                    completed = db.execute('SELECT COUNT(*) AS n FROM automation_runs WHERE user_id=? AND settings_version=?', (row['user_id'], row['version'])).fetchone()['n']
                    if completed >= repeat['interval']:
                        db.execute('UPDATE automation_settings SET enabled=0,next_run_at=NULL WHERE user_id=?',(row['user_id'],))
                    else:
                        immediate = (datetime.fromisoformat(now) + timedelta(seconds=1)).isoformat()
                        db.execute('UPDATE automation_settings SET next_run_at=? WHERE user_id=?',(immediate,row['user_id']))
                else:
                    following = next_occurrence(row['anchor_at'],repeat['unit'],repeat['interval'],now)
                    db.execute('UPDATE automation_settings SET next_run_at=? WHERE user_id=?',(following,row['user_id']))
            db.commit()

    def claim(self, owner, now=None):
        now = now or now_iso()
        expiry = (datetime.fromisoformat(now)+timedelta(seconds=90)).isoformat()
        with closing(self.auth._connect()) as db:
            db.execute('BEGIN IMMEDIATE')
            expired = db.execute("SELECT user_id FROM automation_runs WHERE status='running' AND lease_until<?",(now,)).fetchall()
            db.execute("UPDATE automation_runs SET status='failed',error_code='lease_expired',error_message='작업 연결이 끊겼습니다. 결과를 확인한 뒤 다시 시도해 주세요.',updated_at=? WHERE status='running' AND lease_until<?",(now,now))
            db.execute('''UPDATE automated_projects SET
                status=(SELECT status FROM automation_runs WHERE automation_runs.run_id=automated_projects.run_id),
                stage=(SELECT stage FROM automation_runs WHERE automation_runs.run_id=automated_projects.run_id),
                error_message=(SELECT error_message FROM automation_runs WHERE automation_runs.run_id=automated_projects.run_id)
                WHERE run_id IN (SELECT run_id FROM automation_runs WHERE status='failed' AND error_code='lease_expired' AND updated_at=?)''',(now,))
            for row in expired:
                db.execute('UPDATE automation_settings SET enabled=0,next_run_at=NULL WHERE user_id=?',(row['user_id'],))
            # Keep paid media work serial across all worker replicas.
            if db.execute("SELECT 1 FROM automation_runs WHERE status='running'").fetchone():
                db.commit()
                return None
            row = db.execute("SELECT * FROM automation_runs WHERE status='queued' AND cancel_requested=0 ORDER BY created_at LIMIT 1").fetchone()
            if not row:
                db.commit()
                return None
            db.execute("UPDATE automation_runs SET status='running',lease_owner=?,lease_until=?,updated_at=? WHERE run_id=?",(owner,expiry,now,row['run_id']))
            db.execute("UPDATE automated_projects SET status='running' WHERE run_id=?",(row['run_id'],))
            db.commit()
        return {**dict(row),'status':'running','lease_owner':owner,'config':json.loads(row['config_json'])}

    def heartbeat(self, run_id, owner):
        expiry = (datetime.now(timezone.utc)+timedelta(seconds=90)).isoformat()
        with closing(self.auth._connect()) as db:
            updated = db.execute("UPDATE automation_runs SET lease_until=?,updated_at=? WHERE run_id=? AND lease_owner=? AND status='running'",(expiry,now_iso(),run_id,owner)).rowcount
            db.commit()
        return bool(updated)

    def check_active(self, run):
        with closing(self.auth._connect()) as db:
            row=db.execute('SELECT status,cancel_requested,lease_owner,project_id FROM automation_runs WHERE run_id=?',(run['run_id'],)).fetchone()
        return bool(row and row['status']=='running' and not row['cancel_requested'] and row['lease_owner']==run['lease_owner'] and row['project_id'])

    def step(self, run, key, stage, operation):
        if not self.check_active(run):
            raise InterruptedError('자동화가 중지되었습니다.')
        stamp=now_iso()
        job_id=str(uuid.uuid5(uuid.NAMESPACE_URL,run['run_id']+':'+key))
        with closing(self.auth._connect()) as db:
            row=db.execute('SELECT * FROM automation_steps WHERE run_id=? AND step_key=?',(run['run_id'],key)).fetchone()
            if row and row['status']=='succeeded':
                return json.loads(row['result_json'])['value']
            job={'schema_version':'1.0.0','job_id':job_id,'project_id':run['project_id'],'stage':stage,'status':'running',
                 'attempt':row['attempt']+1 if row else 1,'idempotency_key':run['run_id']+':'+key,
                 'input':{'project_id':run['project_id'],'settings_version':run['settings_version']},
                 'trace':{'trace_id':run['run_id'],'created_at':stamp,'parent_job_id':None}}
            validate_json_schema_file(job,ROOT/'contracts'/'worker-job.schema.json')
            db.execute('''INSERT INTO automation_steps VALUES(?,?,?,?,'running',1,?,NULL,?,?)
                ON CONFLICT(run_id,step_key) DO UPDATE SET status='running',attempt=attempt+1,input_json=excluded.input_json,updated_at=excluded.updated_at''',
                (job_id,run['run_id'],key,stage,json.dumps(job),stamp,stamp))
            db.execute('UPDATE automation_runs SET stage=?,updated_at=? WHERE run_id=?',(key,stamp,run['run_id']))
            db.execute('UPDATE automated_projects SET stage=? WHERE run_id=?',(key,run['run_id']))
            db.commit()
        try:
            result=operation() or {}
        except Exception:
            with closing(self.auth._connect()) as db:
                failure={'schema_version':'1.0.0','job_id':job_id,'stage':stage,'status':'failed','artifacts':[],
                         'metrics':{},'error':{'code':'step_failed','message':'단계 실행을 완료하지 못했습니다.','retryable':False}}
                validate_json_schema_file(failure,ROOT/'contracts'/'worker-result.schema.json')
                db.execute("UPDATE automation_steps SET status='failed',result_json=?,updated_at=? WHERE job_id=?",(json.dumps({'worker_result':failure}),now_iso(),job_id))
                db.commit()
            raise
        with closing(self.auth._connect()) as db:
            worker_result={'schema_version':'1.0.0','job_id':job_id,'stage':stage,'status':'succeeded','artifacts':[],
                           'metrics':{},'error':None}
            validate_json_schema_file(worker_result,ROOT/'contracts'/'worker-result.schema.json')
            db.execute("UPDATE automation_steps SET status='succeeded',result_json=?,updated_at=? WHERE job_id=?",(json.dumps({'value':result,'worker_result':worker_result},ensure_ascii=False,allow_nan=False),now_iso(),job_id))
            db.commit()
        return result

    def finish(self, run, status, code=None, message=None):
        with closing(self.auth._connect()) as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute("UPDATE automation_runs SET status=CASE WHEN cancel_requested=1 THEN 'cancelled' ELSE ? END,error_code=?,error_message=?,lease_until=NULL,updated_at=? WHERE run_id=? AND lease_owner=? AND status='running'",(status,code,message,now_iso(),run['run_id'],run['lease_owner']))
            db.execute('''UPDATE automated_projects SET
                status=(SELECT status FROM automation_runs WHERE run_id=?),
                stage=(SELECT stage FROM automation_runs WHERE run_id=?),
                error_message=(SELECT error_message FROM automation_runs WHERE run_id=?)
                WHERE run_id=?''',(run['run_id'],run['run_id'],run['run_id'],run['run_id']))
            if status=='failed':
                db.execute('UPDATE automation_settings SET enabled=0,next_run_at=NULL WHERE user_id=?',(run['user_id'],))
            db.commit()
