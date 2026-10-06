import hashlib
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock
from test_pipeline_contracts import load_render_server


class SharedVoiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.server=load_render_server()
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.auth=self.server.AuthStore(self.root/'test.sqlite')
        self.user=self.auth.create_user('voice_fixture','strong-password')['user_id']
        self.project=self.auth.create_project(self.user)['project_id']
        self.document={'production':{'timeline':{'scenes':[
            {'id':'s1','narration_cue_ids':['c1']},{'id':'s2','narration_cue_ids':['c1']},{'id':'s3','narration_cue_ids':['c2']} ]},
            'narration_cues':[{'id':'c1','start':0,'end':4,'narration':{'text':'같은 문장'}},
                              {'id':'c2','start':4,'end':8,'narration':{'text':'같은 문장'}}]}}
        self.revision=self.auth.save_stage_draft(self.user,self.project,3,{'document':self.document})
        self.patches=[mock.patch.object(self.server,'get_auth_store',return_value=self.auth),
            mock.patch.object(self.server,'VOICE_ARTIFACT_DIR',self.root/'voice'),
            mock.patch.object(self.server.shutil,'which',return_value=None),
            mock.patch.object(self.server,'openai_tts_audio',return_value=(b'isolated-wav','mock-id','mock-model',{'total_tokens':3}))]
        for patch in self.patches:patch.start()
        self.provider=self.server.openai_tts_audio
    def tearDown(self):
        for patch in reversed(self.patches):patch.stop()
        self.tmp.cleanup()
    def generate(self,scene=None,profile='warm_female'):
        return self.server.generate_voice_clips('test',self.user,self.project,self.revision,self.document,profile,scene)
    def test_continuation_and_bulk_generate_once_per_cue(self):
        second=self.generate('s2')['clips'][0]
        self.assertEqual(second['scene_id'],'s1')
        self.assertEqual(self.generate('s1')['clips'][0]['uri'],second['uri'])
        self.assertEqual(self.provider.call_count,1)
        self.generate();self.assertEqual(self.provider.call_count,2)
        self.generate();self.assertEqual(self.provider.call_count,2)
        clips=self.auth.list_scene_voice_clips(self.user,self.project,self.revision['revision_id'])
        self.assertEqual(len(clips),2)
        self.assertEqual(next(c for c in clips if c['cue_id']=='c1')['scene_ids'],['s1','s2'])
    def test_targeted_second_cue_keeps_global_ordinal(self):
        clip=self.generate('s3')['clips'][0]
        self.assertIn('file=02_c2_',clip['uri'])
        self.generate();self.assertEqual(self.provider.call_count,2)
    def test_concurrent_shared_scene_requests_only_one_tts(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            clips=list(pool.map(self.generate,['s1','s2']))
        self.assertEqual(self.provider.call_count,1)
        self.assertEqual(clips[0]['clips'][0]['uri'],clips[1]['clips'][0]['uri'])
    def test_legacy_second_scene_binding_is_read_as_cue_owner_and_reused(self):
        rev=self.revision['revision_id'];digest=hashlib.sha256('같은 문장'.encode()).hexdigest()[:16]
        folder=self.root/'voice'/self.project/rev/'warm_female';folder.mkdir(parents=True)
        name='01_c1_'+digest+'.wav';(folder/name).write_bytes(b'legacy-wav')
        uri=f'/api/voice/audio?project_id={self.project}&revision_id={rev}&profile=warm_female&file={name}'
        self.auth.register_artifact(self.user,self.project,rev,'s2','narration_wav',uri,'fixture',{'cue_id':'c1','text_hash':digest})
        clips=self.auth.list_scene_voice_clips(self.user,self.project,rev)
        self.assertEqual(clips[0]['scene_id'],'s1')
        self.assertEqual(self.generate('s1')['clips'][0]['uri'],uri)
        self.provider.assert_not_called()
    def test_profiles_do_not_share_files(self):
        first=self.generate('s1')['clips'][0]
        second=self.generate('s2','steady_male')['clips'][0]
        self.assertNotEqual(first['uri'],second['uri']);self.assertEqual(self.provider.call_count,2)
    def test_endpoint_continuation_returns_same_owner_audio(self):
        handler=object.__new__(self.server.Handler);handler.path='/api/voice/generate-scene'
        handler.current_user=mock.Mock(return_value={'user_id':self.user})
        handler.send_json=mock.Mock()
        with mock.patch.object(self.server,'load_demo_data',return_value={}),mock.patch.object(self.server,'provider_values',return_value={'api_key':'test'}):
            results=[]
            for scene in ['s2','s1']:
                handler.read_json=mock.Mock(return_value={'project_id':self.project,'scene_id':scene})
                handler.do_POST()
                self.assertEqual(handler.send_json.call_args.args[0],200)
                results.append(handler.send_json.call_args.args[1]['voice'])
        self.assertEqual(results[0]['scene_id'],'s1')
        self.assertEqual(results[0]['uri'],results[1]['uri']);self.assertEqual(self.provider.call_count,1)
    def test_inherited_old_revision_uri_remains_playable(self):
        old=self.generate('s1')['clips'][0]
        self.revision=self.auth.save_stage_draft(self.user,self.project,3,{'document':self.document})
        self.auth.register_artifact(self.user,self.project,self.revision['revision_id'],'s1','narration_wav',old['uri'],'fixture',{'cue_id':'c1','text_hash':old['text_hash']})
        new=self.generate('s2')['clips'][0]
        self.assertEqual(new['uri'],old['uri']);self.assertTrue(self.server.voice_audio_path(new['uri']).is_file())
        self.assertEqual(self.provider.call_count,1)
    def test_read_filters_revision_selected_profile(self):
        female=self.generate('s1')['clips'][0];male=self.generate('s1','steady_male')['clips'][0]
        self.revision=self.auth.save_stage_draft(self.user,self.project,3,{'document':self.document,'voice_profile':'steady_male'})
        for clip in [female,male]:
            self.auth.register_artifact(self.user,self.project,self.revision['revision_id'],'s1','narration_wav',clip['uri'],'fixture',{'cue_id':'c1','text_hash':clip['text_hash']})
        clips=self.auth.list_scene_voice_clips(self.user,self.project,self.revision['revision_id'])
        self.assertEqual(len(clips),1);self.assertEqual(clips[0]['profile_id'],'steady_male')

if __name__=='__main__':unittest.main()
