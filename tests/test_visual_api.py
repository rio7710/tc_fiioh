"""Endpoint adapter tests; no external providers or production database."""
import unittest
from unittest import mock
from test_pipeline_contracts import load_render_server


class VisualAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.server=load_render_server()
    def handler(self,path,payload,user=True):
        handler=object.__new__(self.server.Handler)
        handler.path=path
        handler.current_user=mock.Mock(return_value={'user_id':'owner'} if user else None)
        handler.read_json=mock.Mock(return_value=payload)
        handler.send_json=mock.Mock()
        return handler
    def test_authentication_and_input(self):
        for path in ['/api/storyboard/auto-select','/api/project/auto-crop']:
            handler=self.handler(path,{},False);handler.do_POST()
            self.assertEqual(handler.send_json.call_args.args[0],401)
            handler=self.handler(path,[]);handler.do_POST()
            self.assertEqual(handler.send_json.call_args.args[0],400)
    def test_dispatch_and_conflict(self):
        with mock.patch.object(self.server,'get_auth_store'),mock.patch.object(self.server,'provider_values',return_value={}),mock.patch.object(self.server,'find_ffmpeg',return_value='ffmpeg'),mock.patch.object(self.server,'VisualDecisions') as factory:
            service=factory.return_value
            service.select.return_value={'selected':[],'count':0}
            handler=self.handler('/api/storyboard/auto-select',{'project_id':'project','count':0});handler.do_POST()
            service.select.assert_called_once_with('owner','project',0)
            self.assertEqual(handler.send_json.call_args.args[0],200)
            service.crop.return_value={'applied':False,'needs_review':False}
            handler=self.handler('/api/project/auto-crop',{'project_id':'project','scene_id':'scene'});handler.do_POST()
            service.crop.assert_called_once_with('owner','project','scene',False)
            service.crop.side_effect=self.server.DecisionConflict('changed')
            handler.do_POST();self.assertEqual(handler.send_json.call_args.args[0],409)
            service.crop.side_effect=RuntimeError('secret provider details')
            handler.do_POST();self.assertEqual(handler.send_json.call_args.args[0],502)
            self.assertNotIn('secret',str(handler.send_json.call_args))
    def test_pending_kling_is_reused_without_resubmission(self):
        auth=mock.Mock()
        auth.latest_stage_data.return_value={'revision_id':'rev','data':{'document':{'production':{'timeline':{'scenes':[{'id':'scene'}]}}}}}
        auth.list_scene_videos.return_value=[]
        job={'user_id':'owner','project_id':'project','revision_id':'rev','scene_id':'scene','status':'running'}
        with mock.patch.object(self.server,'get_auth_store',return_value=auth),mock.patch.object(self.server,'load_demo_data',return_value={}),mock.patch.object(self.server,'load_project_kling_jobs',return_value={'task':job}),mock.patch.object(self.server,'kling_api_request') as provider:
            handler=self.handler('/api/storyboard/video-generate',{'project_id':'project','scene_id':'scene','force':False})
            handler.do_POST()
            self.assertEqual(handler.send_json.call_args.args[0],200)
            self.assertEqual(handler.send_json.call_args.args[1]['scene_video_job']['task_id'],'task')
            provider.assert_not_called()
    def test_concurrent_kling_submission_conflicts(self):
        self.server.kling_submission_lock.acquire()
        try:
            handler=self.handler('/api/storyboard/video-generate',{})
            handler.do_POST();self.assertEqual(handler.send_json.call_args.args[0],409)
            handler.read_json.assert_not_called()
        finally:self.server.kling_submission_lock.release()

if __name__=='__main__':unittest.main()
