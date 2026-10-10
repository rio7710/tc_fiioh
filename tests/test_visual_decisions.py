import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from test_automation import AuthStore,ROOT
import visual_decisions as visual


class VisualDecisionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.auth=AuthStore(self.root/'test.sqlite')
        self.user=self.auth.create_user('visual_user','strong-password')['user_id']
        self.other=self.auth.create_user('visual_other','strong-password')['user_id']
        self.project=self.auth.create_project(self.user)['project_id']
        self.scenes=[{'id':'scene_a','motion_prompt':{'text':'hand movement'}},{'id':'scene_b','motion_prompt':{'text':'walk'}}]
        self.revision=self.auth.save_stage_draft(self.user,self.project,3,{'document':{'production':{'timeline':{'scenes':self.scenes}}}})['revision_id']
        self.paths={}
        for scene in self.scenes:
            path=self.root/(scene['id']+'.jpg');path.write_bytes(scene['id'].encode());uri='/test/'+scene['id'];self.paths[uri]=path
            self.auth.register_artifact(self.user,self.project,self.revision,scene['id'],'scene_image_candidate',uri,'test',{'selected':True})
        self.vision=mock.Mock(return_value=({'frames':[{'people':[{'left':.6,'right':.7,'confidence':.9}]}]},{'id':'mock-response','usage':{}}))
        self.service=visual.VisualDecisions(self.auth,lambda uri:self.paths[uri],lambda *a:None,'ffmpeg','test-key',vision=self.vision)
        self.samples=mock.patch.object(visual,'sample_media',return_value=(1600,900,[{'type':'input_image','image_url':'data:image/jpeg;base64,mock'}]));self.samples.start()
    def tearDown(self):self.samples.stop();self.temp.cleanup()
    def test_crop_compute_cache_apply_and_both_formats(self):
        a=self.service.crop(self.user,self.project,'scene_a',True)
        b=self.service.crop(self.user,self.project,'scene_a',False)
        self.assertTrue(a['applied']);self.assertTrue(b['cached']);self.assertFalse(b['applied'])
        self.assertGreater(a['positions']['9x16'],50)
        self.assertEqual(set(a['positions']),{'9x16','4x5'})
        self.assertEqual(self.auth.scene_crop_positions(self.user,self.project)['scene_a'],a['positions'])
        self.assertEqual(self.vision.call_count,1)
    def test_unknown_owner_or_scene_cannot_analyze(self):
        for owner,sid in [(self.other,'scene_a'),(self.user,'unknown')]:
            with self.assertRaises(ValueError):self.service.crop(owner,self.project,sid,True)
        self.vision.assert_not_called()
    def test_review_never_overwrites_existing_crop(self):
        self.auth.save_scene_crop_position(self.user,self.project,'scene_a','9x16',22)
        self.vision.return_value=({'frames':[{'people':[{'left':.1,'right':.9,'confidence':.99}]}]},{'usage':{}})
        result=self.service.crop(self.user,self.project,'scene_a',True)
        self.assertTrue(result['needs_review']);self.assertFalse(result['applied'])
        self.assertEqual(self.auth.scene_crop_positions(self.user,self.project)['scene_a'],{'9x16':22})
    def test_inflight_claim_never_duplicates_provider_call(self):
        def recursive(*args):
            with self.assertRaises(visual.DecisionConflict):self.service.crop(self.user,self.project,'scene_a',True)
            return {'frames':[{'people':[]}]},{'usage':{}}
        self.vision.side_effect=recursive
        self.service.crop(self.user,self.project,'scene_a',True)
        self.assertEqual(self.vision.call_count,1)
    def test_manual_adjustment_during_analysis_is_preserved(self):
        def response(*args):
            self.auth.save_scene_crop_position(self.user,self.project,'scene_a','9x16',22)
            return {'frames':[{'people':[{'left':.6,'right':.7,'confidence':.9}]}]},{'usage':{}}
        self.vision.side_effect=response
        with self.assertRaises(visual.DecisionConflict):self.service.crop(self.user,self.project,'scene_a',True)
        self.assertEqual(self.auth.scene_crop_positions(self.user,self.project)['scene_a'],{'9x16':22})
    def test_source_change_rejects_stale_apply(self):
        def response(*args):
            self.paths['/test/scene_a'].write_bytes(b'changed')
            return {'frames':[{'people':[{'left':.6,'right':.7,'confidence':.9}]}]},{'usage':{}}
        self.vision.side_effect=response
        with self.assertRaises(visual.DecisionConflict):self.service.crop(self.user,self.project,'scene_a',True)
        self.assertEqual(self.auth.scene_crop_positions(self.user,self.project),{})
    def test_uncertain_group_and_no_person_do_not_overwrite(self):
        for people in [[],[{'left':.1,'right':.9,'confidence':.99}],[{'left':.6,'right':.7,'confidence':.4}]]:
            result=visual.crop_positions({'frames':[{'people':people}]},1600,900,1)
            if people:self.assertTrue(result['needs_review'])
            else:self.assertFalse(result['positions'])
    def test_malformed_and_nonfinite_coordinates_rejected(self):
        for left,right,confidence in [(math.nan,.7,.9),(.8,.2,.9),(-.1,.7,.9),(.1,.2,True)]:
            with self.assertRaises(ValueError):visual.crop_positions({'frames':[{'people':[{'left':left,'right':right,'confidence':confidence}]}]},1600,900,1)
    def test_three_video_frames_get_one_static_position(self):
        frames=[{'people':[{'left':x,'right':x+.08,'confidence':.9}]} for x in [.5,.53,.55]]
        result=visual.crop_positions({'frames':frames},1600,900,3)
        self.assertFalse(result['needs_review']);self.assertEqual(len(result['positions']),2)
    def test_wide_group_uses_primary_person(self):
        raw={'primary_person_id':'p2','frames':[{'people':[
            {'person_id':'p1','left':.05,'right':.2,'confidence':.99},
            {'person_id':'p2','left':.7,'right':.85,'confidence':.9}]}]}
        result=visual.crop_positions(raw,1600,900,1)
        self.assertFalse(result['needs_review']);self.assertTrue(result['single_person_fallback'])
        self.assertEqual(result['subjects'],{'9x16':'p2','4x5':'p2'})
        self.assertGreater(result['positions']['9x16'],50)
    def test_extras_are_excluded_even_if_low_confidence_or_easy_to_fit(self):
        main={'person_id':'p1','role':'main','left':.65,'right':.8,'confidence':.9}
        extra={'person_id':'p2','role':'extra','left':.1,'right':.2,'confidence':.3}
        raw={'primary_person_id':'p2','frames':[{'people':[main,extra]}]}
        result=visual.crop_positions(raw,1600,900,1)
        self.assertFalse(result['needs_review']);self.assertGreater(result['positions']['9x16'],50)
        main.update(left=.05,right=.9)
        self.assertTrue(visual.crop_positions(raw,1600,900,1)['needs_review'])
        raw['frames'][0]['people']=[extra]
        self.assertTrue(visual.crop_positions(raw,1600,900,1)['needs_review'])
    def test_group_preserved_for_wider_format(self):
        raw={'primary_person_id':'p1','frames':[{'people':[
            {'person_id':'p1','left':.3,'right':.4,'confidence':.9},
            {'person_id':'p2','left':.55,'right':.65,'confidence':.9}]}]}
        result=visual.crop_positions(raw,1600,900,1)
        self.assertFalse(result['needs_review'])
        self.assertEqual(result['subjects'],{'9x16':'p1','4x5':'group'})
    def test_video_person_order_can_change_without_target_switch(self):
        a={'person_id':'p1','left':.05,'right':.2,'confidence':.9}
        b={'person_id':'p2','left':.7,'right':.85,'confidence':.9}
        raw={'primary_person_id':'p2','frames':[{'people':[a,b]},{'people':[b,a]},{'people':[a,b]}]}
        result=visual.crop_positions(raw,1600,900,3)
        self.assertFalse(result['needs_review']);self.assertEqual(result['subjects']['9x16'],'p2')
        raw['frames'][1]['people']=[]
        self.assertTrue(visual.crop_positions(raw,1600,900,3)['needs_review'])
    def test_single_fallback_persisted_and_policy_invalidates_old_cache(self):
        latest,_=self.service.context(self.user,self.project)
        signature=self.service.signature(self.service.sources(self.user,self.project,latest,[self.scenes[0]],True))
        self.service.cached(self.user,self.project,self.revision,'person_crop',signature,lambda:{'positions':{},'needs_review':True})
        self.vision.return_value=({'primary_person_id':'p2','frames':[{'people':[
            {'person_id':'p1','left':.05,'right':.2,'confidence':.9},
            {'person_id':'p2','left':.7,'right':.85,'confidence':.9}]}]},{'usage':{}})
        result=self.service.crop(self.user,self.project,'scene_a',True)
        self.assertTrue(result['applied']);self.assertFalse(result['cached'])
        self.assertEqual(self.auth.scene_crop_positions(self.user,self.project)['scene_a'],result['positions'])
        self.assertTrue(self.service.crop(self.user,self.project,'scene_a',False)['cached'])
        self.assertEqual(self.vision.call_count,1)
    def test_selection_exact_count_cached_and_zero_no_call(self):
        self.assertEqual(self.service.select(self.user,self.project,0)['selected'],[])
        self.vision.assert_not_called()
        self.vision.return_value=({'selected':[{'scene_id':'scene_b','reason':'움직임에 적합'}]},{'usage':{}})
        selected=self.service.select(self.user,self.project,1)
        self.assertEqual(selected['selected'][0]['scene_id'],'scene_b')
        self.assertTrue(self.service.select(self.user,self.project,1)['cached'])
        self.assertEqual(self.vision.call_count,1)
    def test_selection_clamps_count_and_rejects_duplicates(self):
        self.vision.return_value=({'selected':[{'scene_id':s['id'],'reason':'적합'} for s in self.scenes]},{'usage':{}})
        self.assertEqual(self.service.select(self.user,self.project,200)['count'],2)
        self.paths['/test/scene_a'].write_bytes(b'new media')
        self.vision.return_value=({'selected':[{'scene_id':'scene_a','reason':'적합'}]*2},{'usage':{}})
        with self.assertRaises(ValueError):self.service.select(self.user,self.project,2)
    def test_motion_review_keeps_ordinary_prompt_byte_for_byte_and_caches(self):
        original='The resident slowly raises one hand while the camera remains fixed.'
        self.vision.return_value=({'decision':'keep','reason':'이미지와 동작이 자연스럽습니다.','content_preserved':True,'protected_phrases':[],'revised_motion_prompt':original},{'id':'review-1','usage':{}})
        result=self.service.review_motion(self.user,self.project,'scene_a',original)
        self.assertEqual(result['reviewed_motion_prompt'],original)
        self.assertEqual(result['decision'],'keep')
        self.assertTrue(self.service.review_motion(self.user,self.project,'scene_a',original)['cached'])
        self.assertEqual(self.vision.call_count,1)
    def test_motion_review_only_accepts_minimal_physical_correction(self):
        original='The resident smiles while the tree grows rapidly behind her.'
        revised='The resident smiles while the tree remains stable behind her.'
        self.vision.return_value=({'decision':'revise','reason':'나무의 급격한 성장은 부자연스럽습니다.','content_preserved':True,'protected_phrases':['The resident smiles'],'revised_motion_prompt':revised},{'id':'review-2','usage':{}})
        result=self.service.review_motion(self.user,self.project,'scene_a',original)
        self.assertEqual(result['reviewed_motion_prompt'],revised)
        self.assertEqual(result['decision'],'revise')
    def test_motion_review_rejects_content_change_before_kling(self):
        original='The resident smiles while the camera remains fixed.'
        for revised,preserved in [('A dog runs into a different garden.',True),(original,False)]:
            self.paths['/test/scene_a'].write_bytes(revised.encode())
            self.vision.return_value=({'decision':'revise','reason':'수정','content_preserved':preserved,'protected_phrases':[],'revised_motion_prompt':revised},{'usage':{}})
            with self.assertRaises(ValueError):self.service.review_motion(self.user,self.project,'scene_a',original)

if __name__=='__main__':unittest.main()
