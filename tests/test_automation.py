import copy
import json
import sys
import tempfile
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
from unittest import mock

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'01_app'))
from auth_store import AuthStore
from automation_store import AutomationStore,PLATFORMS,VersionConflict,next_occurrence,validate_config
from automation_runner import AutomationRunner,AdapterFailure

NOW='2026-10-01T00:00:00+00:00'
BASE=[{'id':str(i),'label':'키워드'+str(i)} for i in range(20)]

def config(endpoint='2'):
    return {'schema_version':'1.0.0','endpoint':endpoint,'repeat':{'unit':'month','interval':1},
            'keywords':{'count':3,'ai':False,'month':''},'video':{'scene_count':0,'crop':'default'},
            'brand':{'intro':False,'outro':False,'watermark':False},'channels':['youtube']}


class FakeAPI:
    calls=[]
    fail=None
    def __init__(self,auth,user):self.auth,self.user=auth,user
    def close(self):pass
    def call(self,path,payload):
        self.calls.append((path,payload))
        if path==self.fail:raise AdapterFailure('test failure')
        project=payload.get('project_id')
        if path=='/api/season-keywords/preview':return {'ok':True,'keywords':BASE[:payload['count']]}
        if path=='/api/script/generate':
            self.auth.save_stage_draft(self.user,project,3,{'document':{'production':{'narration_cues':[{'id':'cue-a'},{'id':'cue-b'}],'timeline':{'scenes':[{'id':'fixture_scene_a','narration_cue_ids':['cue-a']},{'id':'fixture_scene_b','narration_cue_ids':['cue-b']}]}}}})
        if path=='/api/voice/select':
            latest=self.auth.latest_stage_data(self.user,project,3)
            self.auth.save_stage_draft(self.user,project,3,{**latest['data'],'voice_profile':payload['profile_id']})
        return {'ok':True}


class AutomationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.auth=AuthStore(Path(self.tmp.name)/'test.sqlite')
        self.user=self.auth.create_user('automation_test','strong-test-password')['user_id']
        self.other=self.auth.create_user('other_user','strong-test-password')['user_id']
        self.store=AutomationStore(self.auth)
        FakeAPI.calls=[];FakeAPI.fail=None
    def tearDown(self):self.tmp.cleanup()
    def request(self,action,c=None,version=0,run_id=None,user=None,now=NOW,request_id=None):
        payload={'action':action,'request_id':request_id or str(uuid.uuid4()),'version':version}
        if c is not None:payload['config']=c
        if run_id:payload['run_id']=run_id
        return self.store.configure(user or self.user,action,payload,now)
    def start(self,endpoint='2'):
        self.request('start',config(endpoint))
        self.store.enqueue_due(NOW)
        return self.store.claim('test-worker',NOW)
    def test_settings_schema_and_validation(self):
        self.assertEqual(validate_config(config()),config())
        schema=json.loads((ROOT/'contracts'/'automation-settings.schema.json').read_text())
        self.assertEqual(set(schema['required']),set(config()))
        catalog=json.loads((ROOT/'config'/'render-catalog.json').read_text())
        self.assertEqual(tuple(catalog['platforms']), PLATFORMS)
        for key,value in [('repeat',None),('keywords',{}),('brand',[]),('channels',['invalid'])]:
            item=config();item[key]=value
            with self.assertRaises((ValueError,TypeError)):validate_config(item)
        for value in [True,0,6,2.5]:
            item=config();item['keywords']['count']=value
            with self.assertRaises(ValueError):validate_config(item)
        item=config('3-1');item['video']['scene_count']=1
        self.assertEqual(validate_config(item)['video']['scene_count'],1)
        item=config('4');item['video']['crop']='manual'
        with self.assertRaises(ValueError):validate_config(item)
    def test_month_end_anchor_and_leap_year(self):
        a='2028-01-31T03:00:00+00:00'
        self.assertEqual(next_occurrence(a,'month',1,a),'2028-02-29T03:00:00+00:00')
        self.assertEqual(next_occurrence(a,'month',1,'2028-02-29T03:00:00+00:00'),'2028-03-31T03:00:00+00:00')
        self.assertEqual(next_occurrence(NOW,'week',2,NOW),'2026-10-15T00:00:00+00:00')
        self.assertEqual(next_occurrence(NOW,'day',2,'2026-10-04T05:00:00+00:00'),'2026-10-05T00:00:00+00:00')
    def test_voice_selection_persisted_and_applied_before_prepare(self):
        c=config('3-1');c['voice']={'profile_id':'steady_male'}
        self.request('start',c);self.store.enqueue_due(NOW);run=self.store.claim('voice-worker',NOW)
        AutomationRunner(self.store,FakeAPI,BASE).execute(run)
        latest=self.auth.latest_stage_data(self.user,run['project_id'],3)
        self.assertEqual(latest['data']['voice_profile'],'steady_male')
        self.assertEqual(latest['status'],'confirmed')
        paths=[p for p,_ in FakeAPI.calls]
        self.assertLess(paths.index('/api/voice/select'),paths.index('/api/production/prepare'))
        self.assertEqual(self.store.snapshot(self.user)['settings']['config']['voice']['profile_id'],'steady_male')
        c['voice']['profile_id']='unknown'
        with self.assertRaises(ValueError):validate_config(c)

    def test_count_repeat_is_valid_and_stops_after_requested_runs(self):
        c=config('2')
        c['repeat']={'unit':'count','interval':2}
        self.assertEqual(validate_config(c)['repeat'],{'unit':'count','interval':2})
        self.request('start',c)
        self.store.enqueue_due(NOW)
        first=self.store.claim('count-worker-1',NOW)
        self.assertIsNotNone(first)
        self.store.finish(first,'succeeded')
        second_time='2026-10-01T00:00:02+00:00'
        self.store.enqueue_due(second_time)
        second=self.store.claim('count-worker-2',second_time)
        self.assertIsNotNone(second)
        self.store.finish(second,'succeeded')
        self.store.enqueue_due('2026-10-01T00:00:04+00:00')
        snapshot=self.store.snapshot(self.user)
        self.assertEqual(len(snapshot['runs']),2)
        self.assertFalse(snapshot['settings']['enabled'])
        self.assertIsNone(snapshot['settings']['next_run_at'])
    def test_save_is_stopped_persistent_and_owner_scoped(self):
        self.request('save',config())
        again=AutomationStore(AuthStore(self.auth.path))
        self.assertFalse(again.snapshot(self.user)['settings']['enabled'])
        self.assertIsNone(again.snapshot(self.other)['settings'])
        again.enqueue_due(NOW)
        self.assertEqual(again.snapshot(self.user)['runs'],[])
        with self.assertRaises(VersionConflict):self.request('start',config(),version=0)
    def test_duplicate_start_and_concurrent_scheduler(self):
        request=str(uuid.uuid4())
        self.request('start',config(),request_id=request)
        self.request('start',config(),request_id=request)
        with ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(lambda _:self.store.enqueue_due(NOW),range(8)))
        self.assertEqual(len(self.store.snapshot(self.user)['runs']),1)
        with ThreadPoolExecutor(max_workers=4) as pool:claims=list(pool.map(lambda i:self.store.claim(str(i),NOW),range(4)))
        self.assertEqual(sum(r is not None for r in claims),1)
    def test_content_list_marks_automated_projects_only(self):
        manual=self.auth.create_project(self.user,'수동 콘텐츠')
        run=self.start('3-1')
        projects={item['project_id']:item for item in self.auth.list_projects(self.user)}
        self.assertFalse(projects[manual['project_id']]['is_automated'])
        automatic=projects[run['project_id']]
        self.assertTrue(automatic['is_automated'])
        self.assertEqual(automatic['automation_status'],'running')
        self.assertEqual(automatic['automation_endpoint'],'3-1')
        self.assertEqual(automatic['automation_images_total'],0)
        self.assertEqual(automatic['automation_images_done'],0)
        self.assertEqual(automatic['automation_voice_total'],0)
        self.assertEqual(automatic['automation_voice_done'],0)
        self.assertEqual(automatic['automation_videos_total'],0)
        self.assertEqual(automatic['automation_videos_done'],0)
        AutomationRunner(self.store,FakeAPI,BASE).execute(run)
        finished=next(item for item in self.auth.list_projects(self.user) if item['project_id']==run['project_id'])
        self.assertEqual(finished['automation_status'],'succeeded')
        self.assertEqual(finished['automation_images_total'],2)
        self.assertEqual(finished['automation_voice_total'],2)
        self.assertEqual(finished['automation_videos_total'],0)
        self.assertEqual(finished['automation_videos_done'],0)
    def test_keyword_counts_one_to_five(self):
        for count in range(1,6):
            c=config();c['keywords']['count']=count
            v=(self.store.snapshot(self.user)['settings'] or {}).get('version',0)
            self.request('start',c,version=v)
            self.store.enqueue_due(NOW)
            run=self.store.claim('test-worker',NOW)
            AutomationRunner(self.store,FakeAPI,BASE).execute(run)
            data=self.auth.latest_stage_data(self.user,run['project_id'],2)
            self.assertEqual(len(data['data']['selected_keywords']),count)
            self.assertEqual(len(set(data['data']['selected_keywords'])),count)
            self.assertEqual(data['status'],'confirmed')
    def test_pipeline_stops_at_each_selected_stage(self):
        expected={'2':0,'3':2,'3-1':5,'4':5,'5':6}
        for endpoint,n in expected.items():
            v=(self.store.snapshot(self.user)['settings'] or {}).get('version',0)
            self.request('start',config(endpoint),version=v)
            self.store.enqueue_due(NOW);run=self.store.claim('test-worker',NOW)
            FakeAPI.calls=[]
            AutomationRunner(self.store,FakeAPI,BASE).execute(run)
            saved=next(r for r in self.store.snapshot(self.user)['runs'] if r['run_id']==run['run_id'])
            self.assertEqual(saved['status'],'succeeded',(endpoint,saved))
            self.assertEqual(len(FakeAPI.calls),n,(endpoint,FakeAPI.calls))
            self.assertEqual(any(p=='/render' for p,_ in FakeAPI.calls),endpoint=='5')
    def test_failure_retry_same_project_and_checkpoints(self):
        run=self.start('3');FakeAPI.fail='/api/script/generate'
        runner=AutomationRunner(self.store,FakeAPI,BASE);runner.execute(run)
        self.assertEqual(self.store.snapshot(self.user)['runs'][0]['status'],'failed')
        failed=next(item for item in self.auth.list_projects(self.user) if item['project_id']==run['project_id'])
        self.assertEqual(failed['automation_status'],'failed')
        self.assertEqual(failed['automation_stage'],'script_generate')
        self.assertTrue(failed['automation_error_message'])
        self.assertFalse(self.store.snapshot(self.user)['settings']['enabled'])
        chosen=self.auth.latest_stage_data(self.user,run['project_id'],2)['revision_id']
        self.request('retry',run_id=run['run_id'])
        retried=self.store.claim('retry-worker',NOW)
        self.assertEqual(retried['project_id'],run['project_id'])
        FakeAPI.fail=None;FakeAPI.calls=[];runner.execute(retried)
        self.assertEqual([p for p,_ in FakeAPI.calls],['/api/script/generate'])
        self.assertEqual(chosen,self.auth.latest_stage_data(self.user,run['project_id'],2)['revision_id'])
    def test_stop_cancels_before_paid_work_and_other_owner_denied(self):
        run=self.start('5')
        with self.assertRaises(ValueError):self.request('cancel',run_id=run['run_id'],user=self.other)
        self.request('stop');AutomationRunner(self.store,FakeAPI,BASE).execute(run)
        self.assertEqual(FakeAPI.calls,[])
        self.assertEqual(self.store.snapshot(self.user)['runs'][0]['status'],'cancelled')
    def test_expired_lease_fails_without_new_project(self):
        run=self.start()
        self.assertIsNone(self.store.claim('restart-worker','2026-10-01T00:05:00+00:00'))
        self.store.enqueue_due('2026-12-01T00:00:00+00:00')
        state=self.store.snapshot(self.user)
        self.assertEqual(len(state['runs']),1)
        self.assertEqual(state['runs'][0]['error_code'],'lease_expired')
    def test_ai_count_forwarded_and_brand_missing_rejected(self):
        c=config();c['keywords']['ai']=True;c['keywords']['count']=5
        self.request('start',c);self.store.enqueue_due(NOW);run=self.store.claim('worker',NOW)
        AutomationRunner(self.store,FakeAPI,BASE).execute(run)
        self.assertEqual(FakeAPI.calls[0][1]['count'],5)
        c=config('4');c['brand']['intro']=True
        with self.assertRaises(ValueError):self.request('start',c,version=1)

    def test_automation_preserves_selected_brand_versions_and_settings(self):
        outro = self.auth.add_brand_asset_version(
            self.user, 'outro', '아웃트로', 'outro-main.png', 'image', 'image/png'
        )
        self.auth.add_brand_asset_version(
            self.user, 'outro', '아웃트로', 'outro-companion.png', 'image', 'image/png'
        )
        watermark = self.auth.add_brand_asset_version(
            self.user, 'watermark', '워터마크', 'watermark.png', 'image', 'image/png'
        )
        expected = {
            'outro': {'position': 'bottom-center', 'width_ratio': 0.72,
                      'profiles': {'16x9': {'position': 'bottom-center', 'width_ratio': 0.72}}},
            'watermark': {'position': 'top-right', 'opacity': 0.63, 'width_ratio': 0.14},
        }
        self.auth.save_content_brand_selections(self.user, None, [
            {'role': 'outro', 'enabled': True, 'version_id': outro['version_id'], 'settings': expected['outro']},
            {'role': 'watermark', 'enabled': True, 'version_id': watermark['version_id'], 'settings': expected['watermark']},
        ])
        configured = config('4')
        configured['brand'].update({'outro': True, 'watermark': True})
        self.request('start', configured)
        stored = self.store.snapshot(self.user)['settings']['config']
        self.assertEqual(stored['brand_versions']['outro'], outro['version_id'])
        self.assertEqual(stored['brand_settings'], expected)
        self.store.enqueue_due(NOW)
        run = self.store.claim('brand-worker', NOW)
        AutomationRunner(self.store, FakeAPI, BASE).execute(run)
        selections = {item['role']: item for item in self.auth.content_brand_selections(self.user)}
        self.assertEqual(selections['outro']['version_id'], outro['version_id'])
        self.assertEqual(selections['outro']['settings'], expected['outro'])
        self.assertEqual(selections['watermark']['settings'], expected['watermark'])
    def test_changed_keywords_on_retry_stop_before_more_paid_calls(self):
        run=self.start('3');FakeAPI.fail='/api/script/generate'
        runner=AutomationRunner(self.store,FakeAPI,BASE);runner.execute(run)
        self.auth.apply_keyword_recommendation(self.user,run['project_id'],BASE[10:13])
        self.request('retry',run_id=run['run_id'])
        FakeAPI.calls=[];FakeAPI.fail=None
        runner.execute(self.store.claim('retry-worker',NOW))
        self.assertEqual(FakeAPI.calls,[])
        self.assertEqual(self.store.snapshot(self.user)['runs'][0]['status'],'failed')
    def test_long_downtime_coalesces_one_run(self):
        self.request('start',config())
        self.store.enqueue_due('2030-06-01T00:00:00+00:00')
        self.assertEqual(len(self.store.snapshot(self.user)['runs']),1)
        self.assertEqual(self.store.snapshot(self.user)['settings']['next_run_at'],'2030-07-01T00:00:00+00:00')
    def test_gpt_selection_only_selected_kling_and_ai_crop_export(self):
        class VisualAPI(FakeAPI):
            def call(api,path,payload):
                if path.startswith('/api/storyboard/video-status'):
                    api.calls.append((path,payload));return {'ok':True,'status':'succeeded','video':{}}
                result=super().call(path,payload)
                project=payload.get('project_id')
                latest=api.auth.latest_stage_data(api.user,project,3)
                if path=='/api/storyboard/image-generate':
                    api.auth.register_artifact(api.user,project,latest['revision_id'],payload['scene_id'],'scene_image_candidate','/test/'+payload['scene_id'],'hash',{'selected':True})
                if path=='/api/storyboard/auto-select':
                    images=api.auth.list_scene_images(api.user,project,latest['revision_id'])
                    return {'ok':True,'decision_id':'test-decision','revision_id':latest['revision_id'],'selected':[{'scene_id':'fixture_scene_b','reason':'test'}],
                            'source_signature':[{'scene_id':i['scene_id'],'artifact_id':i['artifact_id']} for i in images]}
                if path=='/api/storyboard/video-generate':return {'ok':True,'video_job':{'status':'queued','task_id':'test-task'}}
                if path=='/api/project/auto-crop':
                    api.auth.save_scene_crop_position(api.user,project,payload['scene_id'],'9x16',75)
                    return {'ok':True,'needs_review':False,'applied':True}
                return result
        c=config('5');c['video']={'scene_count':1,'crop':'ai'}
        self.request('start',c);self.store.enqueue_due(NOW);run=self.store.claim('worker',NOW)
        AutomationRunner(self.store,VisualAPI,BASE).execute(run)
        self.assertEqual(self.store.snapshot(self.user)['runs'][0]['status'],'succeeded')
        generated=[p['scene_id'] for route,p in FakeAPI.calls if route=='/api/storyboard/video-generate']
        self.assertEqual(generated,['fixture_scene_b'])
        project=next(item for item in self.auth.list_projects(self.user) if item['project_id']==run['project_id'])
        self.assertEqual(project['automation_videos_total'],1)
        self.assertEqual(project['automation_videos_done'],1)
        exported=next(p for route,p in FakeAPI.calls if route=='/render')
        self.assertEqual(exported['scene_crop_positions']['fixture_scene_a']['9x16'],75)

if __name__=='__main__':unittest.main()
