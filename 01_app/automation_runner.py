"""Existing HTTP APIs are the production adapters; this module owns sequencing only."""
import json
import math
import os
import random
import threading
import time
from contextlib import closing
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import quote

from automation_store import STAGES
from worker_core import JobConflict, WorkerRuntimeSettings


class AdapterFailure(RuntimeError):
    pass


class RenderTerminalFailure(AdapterFailure):
    """The render API recorded a terminal failure for the stable render job."""


class RenderResultUnknown(AdapterFailure):
    """Submission may have started, so replaying it would be unsafe."""


def _render_settings(config, settings):
    render = config.get('render', {}) if isinstance(config.get('render', {}), dict) else {}
    render_type = render.get('type') if isinstance(render.get('type'), str) and render.get('type').strip() else settings.render_type
    render_music = render.get('music') if isinstance(render.get('music'), str) and render.get('music').strip() else settings.render_music

    def number_or_default(value, fallback):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1:
            return fallback
        return value

    return (
        render_type,
        render_music,
        number_or_default(render.get('volume'), settings.render_volume),
        number_or_default(render.get('pan_x'), settings.render_pan_x),
    )


class InternalAPI:
    def __init__(self, auth, user_id, settings=None):
        self.auth = auth
        self.user_id = user_id
        self.token = auth.create_session(user_id, days=1/8)
        self.base = os.environ.get('AUTOMATION_API_URL', 'http://api:10000').rstrip('/')
        self.settings = settings or WorkerRuntimeSettings.from_env()

    def close(self):
        self.auth.delete_session(self.token)

    def call(self, path, payload):
        self.auth.delete_session(self.token)
        self.token = self.auth.create_session(self.user_id, days=1/8)
        body = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
        # Voice preparation is replay-safe: the API names WAV files from the cue
        # identity/text hash and reuses completed files. This lets the worker
        # reconnect after an API restart without replaying other paid providers.
        replay_safe = path == '/api/production/prepare'
        for attempt in range(self.settings.api_retry_count):
            req = Request(self.base + path, body, headers={'Content-Type':'application/json', 'Cookie':'thinkcast_session='+self.token}, method='POST' if body is not None else 'GET')
            try:
                with urlopen(req, timeout=self.settings.api_timeout_seconds) as response:
                    result = json.load(response)
                if result.get('ok') is not True:
                    raise AdapterFailure('기존 제작 API가 작업을 완료하지 못했습니다.')
                return result
            except HTTPError as exc:
                retryable_status = exc.code == 409 or (replay_safe and exc.code in {502, 503, 504})
                if retryable_status and attempt + 1 < self.settings.api_retry_count:
                    time.sleep(self.settings.api_retry_backoff_seconds * (2 ** attempt))
                    continue
                try:
                    error_body = json.load(exc)
                    detail = str(error_body.get('error', '')).strip()[:500] if isinstance(error_body, dict) else ''
                except (OSError, TypeError, ValueError, json.JSONDecodeError):
                    detail = ''
                message = detail or '결과 확인 후 다시 시도해 주세요.'
                raise AdapterFailure(f'제작 API 요청이 실패했습니다 (HTTP {exc.code}): {message}') from None
            except (URLError, TimeoutError, ConnectionError, json.JSONDecodeError):
                if replay_safe and attempt + 1 < self.settings.api_retry_count:
                    time.sleep(self.settings.api_retry_backoff_seconds * (2 ** attempt))
                    continue
                raise AdapterFailure('제작 API 응답을 확인하지 못했습니다. 중복 과금을 피하기 위해 실행을 멈췄습니다.') from None


class AutomationRunner:
    def __init__(self, store, api_factory=InternalAPI, base_keywords=None, job_store=None, worker_id=None, settings=None):
        self.store, self.auth, self.api_factory = store, store.auth, api_factory
        self.base_keywords = base_keywords
        self.job_store = job_store
        self.worker_id = worker_id or ('automation-runner-' + str(os.getpid()))
        self.settings = settings or WorkerRuntimeSettings.from_env()

    def _project_deleted(self, project_id):
        with closing(self.auth._connect()) as db:
            return db.execute('SELECT 1 FROM projects WHERE project_id=?', (project_id,)).fetchone() is None

    def _tombstone_if_deleted(self, project_id):
        if self.job_store and self._project_deleted(project_id):
            self.job_store.tombstone_project(project_id)
            return True
        return False

    def execute(self, run):
        stop = threading.Event()
        def keep_alive():
            while not stop.wait(self.settings.automation_heartbeat_interval_seconds):
                try:
                    if not self.store.check_active(run):
                        self._tombstone_if_deleted(run['project_id'])
                        return
                    if not self.store.heartbeat(run['run_id'],run['lease_owner']):
                        return
                except Exception:
                    return
        thread = threading.Thread(target=keep_alive, daemon=True)
        thread.start()
        api = None
        try:
            api = self.api_factory(self.auth,run['user_id'],self.settings) if self.api_factory is InternalAPI else self.api_factory(self.auth,run['user_id'])
            self.pipeline(run,api)
            self.store.finish(run,'succeeded')
        except InterruptedError:
            self.store.finish(run,'cancelled')
        except AdapterFailure as exc:
            self.store.finish(run,'failed','adapter_failed',str(exc))
        except Exception:
            self.store.finish(run,'failed','production_failed','제작 단계에서 오류가 발생했습니다. 콘텐츠 결과를 확인한 뒤 다시 시도해 주세요.')
        finally:
            stop.set()
            thread.join(timeout=2)
            if api:
                api.close()

    def pipeline(self,run,api):
        config, project, user = run['config'],run['project_id'],run['user_id']
        level = STAGES.index(config['endpoint'])
        source_revision = None
        def step(key,operation,stage=None,job_input=None,adapter=None,max_attempts=None):
            resolved_stage = stage or key
            if not self.store.check_active(run):
                self._tombstone_if_deleted(project)
            if self.job_store and resolved_stage in ('scene_image','final_composite'):
                def dispatch():
                    def cancellation_requested():
                        if not self.store.check_active(run):
                            self._tombstone_if_deleted(project)
                            return True
                        return self.job_store.is_project_tombstoned(project)

                    try:
                        job = self.job_store.dispatch(
                            project,
                            resolved_stage,
                            job_input or {'step_key': key},
                            adapter or _OperationAdapter(operation),
                            worker_id=self.worker_id,
                            trace_id=run['run_id'],
                            lease_seconds=self.settings.job_lease_seconds,
                            cancellation_check=cancellation_requested,
                            max_attempts=max_attempts,
                        )
                    except JobConflict:
                        deleted = self._tombstone_if_deleted(project)
                        if deleted or not self.store.check_active(run) or self.job_store.is_project_tombstoned(project):
                            raise InterruptedError('자동화가 중지되었거나 프로젝트가 삭제되었습니다.') from None
                        raise AdapterFailure('같은 제작 작업이 이미 실행 중이거나 취소되었습니다.') from None
                    if job['status'] == 'cancelled':
                        raise InterruptedError('자동화가 중지되었거나 프로젝트가 삭제되었습니다.')
                    if job['status'] != 'succeeded':
                        raise AdapterFailure('제작 작업을 완료하지 못했습니다. 결과를 확인한 뒤 다시 시도해 주세요.')
                    return (job.get('result') or {}).get('value', {})
                return self.store.step(run,key,resolved_stage,dispatch)
            return self.store.step(run,key,resolved_stage,operation)
        def call(path,extra=None):
            if not self.store.check_active(run):
                self._tombstone_if_deleted(project)
                raise InterruptedError('자동화가 중지되었습니다.')
            if source_revision:
                current=self.auth.latest_stage_data(user,project,3)
                if not current or current['revision_id']!=source_revision:
                    raise AdapterFailure('자동화 중 대본이 변경되어 실행을 멈췄습니다.')
            return api.call(path,{'project_id':project,**(extra or {})})
        def choose_keywords():
            # A committed revision is authoritative if a previous response was lost.
            existing=self.auth.latest_stage_data(user,project,2)
            if existing:
                return {'keywords':existing['data'].get('seasonal_keywords',[]),'revision_id':existing['revision_id'],'already_applied':True}
            spec=config['keywords']
            if spec['ai']:
                data=api.call('/api/season-keywords/preview',{'count':spec['count'],'month':spec['month'],'refresh':True})
                items=data['keywords']
            else:
                source=self.base_keywords
                if source is None:
                    source=json.loads((Path(__file__).parent/'data'/'demo_data.json').read_text(encoding='utf-8'))['keywords']
                unique={item['label']:item for item in source if not item.get('seasonal')}
                items=random.SystemRandom().sample(list(unique.values()),spec['count'])
            if len(items)!=spec['count'] or len({item['label'] for item in items})!=len(items):
                raise AdapterFailure('추천 키워드 개수 또는 중복 검증에 실패했습니다.')
            return {'keywords':items}
        chosen=step('keywords_select',choose_keywords)
        keyword_revision=step('keywords_confirm',lambda:self.auth.apply_keyword_recommendation(user,project,chosen['keywords']) if not chosen.get('already_applied') else {'revision_id':chosen['revision_id']})
        if self.auth.latest_stage_data(user,project,2)['revision_id']!=keyword_revision['revision_id']:
            raise AdapterFailure('자동화 중 키워드가 변경되어 실행을 멈췄습니다.')
        if level==1:
            return
        step('script_plan',lambda:call('/api/script/plan'))
        step('script_generate',lambda:call('/api/script/generate'))
        if config.get('voice'):
            step('voice_select',lambda:call('/api/voice/select',{'profile_id':config['voice']['profile_id']}))
        def confirm_script():
            latest=self.auth.latest_stage_data(user,project,3)
            if not latest or not latest['data'].get('document'):
                raise AdapterFailure('생성된 대본을 찾을 수 없습니다.')
            if latest['status']!='confirmed':
                self.auth.confirm_stage_revision(user,project,latest['revision_id'])
            return {'revision_id':latest['revision_id']}
        confirmed=step('script_confirm',confirm_script)
        source_revision=confirmed['revision_id']
        if level==2:
            return
        step('voice_prepare',lambda:call('/api/production/prepare'))
        latest=self.auth.latest_stage_data(user,project,3)
        if latest['revision_id']!=confirmed['revision_id']:
            raise AdapterFailure('자동화 중 대본이 변경되어 실행을 멈췄습니다.')
        scenes=latest['data']['document']['production']['timeline']['scenes']
        image_model = self.settings.image_model
        for scene in scenes:
            step('image_'+scene['id'],lambda s=scene:call('/api/storyboard/image-generate',{
                'scene_id':s['id'],'provider':'openai','model':image_model,'force':False}),stage='scene_image',
                 job_input={'scene_id':scene['id'],'source_revision':source_revision,'provider':'openai','model':image_model,'force':False})
        if config['video']['scene_count']:
            decision=step('video_scene_selection',lambda:call('/api/storyboard/auto-select',{'count':config['video']['scene_count']}))
            current_images={item['scene_id']:item['artifact_id'] for item in self.auth.list_scene_images(user,project,source_revision)}
            if decision.get('revision_id')!=source_revision or any(current_images.get(item['scene_id'])!=item['artifact_id'] for item in decision['source_signature']):
                raise AdapterFailure('선택 이후 이미지가 변경되었습니다. 장면 선택을 다시 확인해 주세요.')
            for selected in decision['selected']:
                sid=selected['scene_id']
                def convert(scene_id=sid):
                    submitted=step('video_submit_'+scene_id+'_'+str(run['attempt']),lambda:call('/api/storyboard/video-generate',{'scene_id':scene_id,'force':False}),stage='image_to_video')
                    job=submitted.get('video_job') or submitted.get('scene_video_job')
                    if not isinstance(job,dict):raise AdapterFailure('Kling 작업 정보를 확인하지 못했습니다.')
                    if job['status']=='succeeded':return job
                    deadline=time.monotonic()+self.settings.i2v_timeout_seconds
                    while time.monotonic()<deadline:
                        if not self.store.check_active(run):raise InterruptedError('자동화가 중지되었습니다.')
                        result=api.call('/api/storyboard/video-status?task_id='+quote(job['task_id'],safe=''),None)
                        if result['status']=='succeeded':return result
                        if result['status'] in ('failed','cancelled'):raise AdapterFailure('Kling 장면 생성이 실패했습니다. 같은 장면으로 다시 시도할 수 있습니다.')
                        time.sleep(self.settings.i2v_poll_interval_seconds)
                    raise AdapterFailure('Kling 완료 대기 시간이 초과되었습니다. 저장된 작업 ID로 다시 확인해 주세요.')
                step('video_complete_'+sid,convert,stage='image_to_video')
        if level==3:
            return
        if config['video']['crop']=='ai':
            for scene in scenes:
                def align(sid=scene['id']):
                    result=call('/api/project/auto-crop',{'scene_id':sid,'apply':True})
                    if result.get('needs_review'):raise AdapterFailure('사람 위치를 자동으로 맞추기 어려운 장면이 있습니다. 영상 디자인에서 크롭을 확인해 주세요.')
                    return result
                step('crop_'+scene['id'],align,stage='person_crop')
        def design():
            saved_settings = config.get('brand_settings') if isinstance(config.get('brand_settings'), dict) else {}
            current_settings = {
                item['role']: item.get('settings', {})
                for item in self.auth.content_brand_selections(user)
                if isinstance(item, dict) and isinstance(item.get('settings'), dict)
            }
            selections=[{'role':role,'enabled':enabled,'version_id':config['brand_versions'].get(role,''),
                         'settings':saved_settings.get(role, current_settings.get(role, {}))}
                        for role,enabled in config['brand'].items()]
            brands=self.auth.save_content_brand_selections(user,project,selections)
            source=self.auth.latest_stage_data(user,project,4)
            data={**(source['data'] if source else {}),'automation_editor':{'channels':config['channels'],'crop':config['video']['crop'],'brand':brands,'run_id':run['run_id']}}
            result=self.auth.save_stage_draft(user,project,4,data)
            return {'revision_id':result['revision_id']}
        step('video_design',design)
        if level==4:
            return
        render_type, render_music, render_volume, render_pan_x = _render_settings(config, self.settings)
        def export():
            job_id='automation-'+run['run_id']
            with closing(self.auth._connect()) as db:
                rows=db.execute("SELECT uri,metadata_json FROM artifacts WHERE project_id=? AND artifact_type='final_video' AND status='active' AND json_extract(metadata_json,'$.job_id')=?",(project,job_id)).fetchall()
            covered={p for row in rows for p in json.loads(row['metadata_json']).get('platforms',[])}
            if set(config['channels']).issubset(covered):
                return {'reused':True,'exports':[{'url':row['uri']} for row in rows]}
            if rows:
                raise AdapterFailure('일부 출력이 이미 저장되어 있습니다. 중복 출력을 피하기 위해 콘텐츠에서 나머지를 확인해 주세요.')
            return call('/render',{'job_id':job_id,'platforms':config['channels'],'preview_platform':config['channels'][0],
                                   'type':render_type,'music':render_music,'volume':render_volume,'narration':True,'video_pan_x':render_pan_x,
                                   'scene_crop_positions':self.auth.scene_crop_positions(user,project)})
        export_input={'render_job_id':'automation-'+run['run_id'],'platforms':config['channels'],
                      'preview_platform':config['channels'][0],'type':render_type,'music':render_music,
                      'volume':render_volume,'narration':True,'video_pan_x':render_pan_x,
                      'scene_crop_positions':self.auth.scene_crop_positions(user,project)}
        render_job_id = export_input['render_job_id']
        final_adapter = _FinalExportAdapter(
            export,
            lambda: api.call('/api/render/status?job_id='+quote(render_job_id,safe=''), None),
            poll_interval_seconds=self.settings.i2v_poll_interval_seconds,
            recovery_timeout_seconds=self.settings.api_timeout_seconds,
        )
        step(
            'final_export_calendar', export, stage='final_composite', job_input=export_input,
            adapter=final_adapter, max_attempts=self.settings.api_retry_count,
        )


class _OperationAdapter:
    """Adapter boundary for existing internal API operations."""

    def __init__(self, operation):
        self.operation = operation

    def run(self, job):
        return {'value': self.operation()}


class _FinalExportAdapter:
    """At-most-once render submission with status-based response recovery.

    Attempt one may submit the stable render job. Later attempts only inspect
    that job and existing artifacts; they never replay an ambiguous POST.
    """

    def __init__(self, submit, status, *, poll_interval_seconds, recovery_timeout_seconds):
        self.submit = submit
        self.status = status
        self.poll_interval_seconds = poll_interval_seconds
        self.recovery_timeout_seconds = recovery_timeout_seconds

    def _status(self):
        try:
            result = self.status()
        except AdapterFailure:
            return None
        return result if isinstance(result, dict) and result.get('status') else None

    @staticmethod
    def _terminal(status):
        state = status.get('status')
        if state == 'succeeded':
            response = status.get('response')
            if not isinstance(response, dict) or response.get('ok') is not True:
                raise RenderResultUnknown('완료된 렌더 작업의 저장 응답을 확인하지 못했습니다.')
            return {'value': response}
        if state in ('failed', 'cancelled'):
            raise RenderTerminalFailure('최종 영상 합성 작업이 실패했습니다. 저장된 작업 상태를 확인해 주세요.')
        return None

    def _recover(self):
        deadline = time.monotonic() + self.recovery_timeout_seconds
        while True:
            status = self._status()
            if status:
                terminal = self._terminal(status)
                if terminal:
                    return terminal
            if time.monotonic() >= deadline:
                raise RenderResultUnknown('렌더 응답이 끊겨 저장된 작업 상태만 확인 중입니다. 동일 작업을 다시 제출하지 않았습니다.')
            time.sleep(self.poll_interval_seconds)

    def run(self, job):
        status = self._status()
        if status:
            terminal = self._terminal(status)
            if terminal:
                return terminal
            return self._recover()
        if job.get('attempt', 1) > 1:
            raise RenderResultUnknown('이전 렌더 제출 여부를 확인할 수 없어 중복 실행을 차단했습니다.')
        try:
            return {'value': self.submit()}
        except AdapterFailure:
            return self._recover()
