"""Bounded, transactional fresh-project recovery; never replay unknown results."""
import json
import re
import uuid
from pathlib import Path


def recovery_policy():
    path = Path(__file__).resolve().parents[1] / 'config' / 'automation-recovery.json'
    return json.loads(path.read_text(encoding='utf-8'))


def is_content_repair_failure(path, status, message):
    if path not in ('/api/script/plan', '/api/script/generate') or status != 400:
        return False
    text = str(message).lower()
    if any(word in text for word in (
        '인증', 'api 키', '결제', '한도', '용량', 'no space', 'quota',
        '준비되지', '파일', '자산', '레퍼런스', 'timeout', '시간이 초과',
        '연결', '응답을 확인하지', 'policy', '정책 위반',
    )):
        return False
    return bool(re.search(r'scene-\d+|씬별 검수를 완료하지|invalid json|schema validation|나레이션.*글자|내레이션.*글자', text))


def initialize_recovery(db):
    db.execute('''CREATE TABLE IF NOT EXISTS automation_recovery_links (
        parent_run_id TEXT PRIMARY KEY REFERENCES automation_runs(run_id) ON DELETE CASCADE,
        child_run_id TEXT UNIQUE NOT NULL REFERENCES automation_runs(run_id) ON DELETE CASCADE,
        root_run_id TEXT NOT NULL, restart_number INTEGER NOT NULL,
        reason TEXT NOT NULL, created_at TEXT NOT NULL)''')


def enqueue_replacement(db, run, now, code):
    """Caller holds BEGIN IMMEDIATE and has persisted the terminal failure."""
    if code != 'content_repair_exhausted':
        return False
    current = db.execute('SELECT * FROM automation_runs WHERE run_id=?', (run['run_id'],)).fetchone()
    setting = db.execute('SELECT * FROM automation_settings WHERE user_id=?', (run['user_id'],)).fetchone()
    if not current or current['status'] != 'failed' or current['cancel_requested']:
        return False
    if not setting or setting['version'] != current['settings_version']:
        return False
    if db.execute('SELECT 1 FROM automation_recovery_links WHERE parent_run_id=?', (run['run_id'],)).fetchone():
        return False
    parent = db.execute('SELECT * FROM automation_recovery_links WHERE child_run_id=?', (run['run_id'],)).fetchone()
    number = parent['restart_number'] + 1 if parent else 1
    if number > int(recovery_policy()['max_new_project_restarts']):
        return False
    group = db.execute('SELECT group_id FROM groups WHERE owner_user_id=? ORDER BY created_at LIMIT 1', (run['user_id'],)).fetchone()
    if not group or not current['project_id']:
        return False
    project_id, child = str(uuid.uuid4()), str(uuid.uuid4())
    config = json.loads(current['config_json'])
    db.execute('INSERT INTO projects(project_id,owner_user_id,group_id,name,created_at,updated_at) VALUES(?,?,?,?,?,?)',
               (project_id, run['user_id'], group['group_id'], f'자동 복구 · 신규 제작 {number}', now, now))
    db.execute('''INSERT INTO automation_runs(run_id,user_id,settings_version,scheduled_for,project_id,
        config_json,status,stage,created_at,updated_at) VALUES(?,?,?,?,?,?,'queued','create_project',?,?)''',
        (child, run['user_id'], current['settings_version'], now, project_id, current['config_json'], now, now))
    db.execute("INSERT INTO automated_projects(project_id,run_id,created_at,status,stage,endpoint) VALUES(?,?,?,'queued','create_project',?)",
               (project_id, child, now, config['endpoint']))
    db.execute('INSERT INTO automation_recovery_links VALUES(?,?,?,?,?,?)',
               (run['run_id'], child, parent['root_run_id'] if parent else run['run_id'], number, code, now))
    return True
