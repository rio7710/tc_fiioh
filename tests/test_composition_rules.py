import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from test_pipeline_contracts import load_render_server, ROOT
from tools.unified_content_prompt_harness import build_prompt


class CompositionRuleTests(unittest.TestCase):
    def test_reference_catalog_uses_nested_server_owned_metadata(self):
        server=load_render_server()
        resources=[{'payload':{'document':{'assets':[{
            'id':'ref-character-v2','kind':'character','uri':'캐릭터/v2.png',
            'status':'ready','usage':'canonical','wardrobe_variant':'cardigan','sha256':'ignored',
        }]}}}]
        asset=server.group_reference_asset_catalog(resources)['ref-character-v2']
        self.assertEqual(asset['uri'],'캐릭터/v2.png')
        self.assertEqual(asset['wardrobe_variant'],'cardigan')
        self.assertNotIn('sha256',asset)

    def test_scene_reference_paths_ignores_style_and_requires_character_media(self):
        server=load_render_server()
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)/'group_resources/defaults/characters/v2.png'
            target.parent.mkdir(parents=True)
            target.write_bytes(b'fixture')
            document={'production':{'reference_assets':[
                {'id':'ref-character-v2','kind':'character','uri':'캐릭터/v2.png'},
                {'id':'ref-style-film','kind':'style','uri':None},
            ]}}
            scene={'reference_ids':['ref-character-v2','ref-style-film']}
            with mock.patch.dict(os.environ,{'DATA_DIR':directory}):
                self.assertEqual(server.scene_reference_paths(document,scene),[target])
                document['production']['reference_assets'][0]['uri']=None
                with self.assertRaisesRegex(ValueError,'URI'):
                    server.scene_reference_paths(document,scene)

    def test_storyboard_prompt_includes_main_extra_motion_and_shot_delta(self):
        prompt=build_prompt(['산책'],'격리 테스트 자료',reference_material='')
        for phrase in ['MAIN SUBJECT SAFE FRAME','BACKGROUND CAST LEDGER','AMBIENT MOTION','SHOT DELTA PLAN','엑스트라는 일부 잘리거나','의자에 앉은 사람이 씬마다 교체','인접 씬은 한눈에 구분','레터박스는 절대 금지','주인공 한 명을 중심으로 정돈된 정면 구도','어르신의 선택과 속도를 존중','180도 동작축의 같은 편','원형은 원형']:
            self.assertIn(phrase,prompt)
    def test_image_lock_keeps_declared_extras_and_motion_is_secondary(self):
        server=load_render_server()
        scene={'sequence':{'continuity_anchor':'bg-lobby-01 green jacket chair A','character_blocking':'main in center'}}
        prompt=server.continuity_locked_prompt({'production':{}},scene,'fixture')
        self.assertIn('bg-lobby-01 green jacket chair A',prompt)
        self.assertIn('NOT background extras',prompt)
        self.assertIn('unplanned people beyond the declared',prompt)
        self.assertNotIn('No text, captions, logos, extra people,',prompt)
        self.assertIn('SHOT DELTA PLAN',prompt)
        self.assertIn('ABSOLUTE PROHIBITION',prompt)
        self.assertIn('DISTINCT SHOT LOCK',prompt)
        self.assertIn('full-bleed 16:9 landscape scene',prompt)
        self.assertIn('LOCATION LATCH',prompt)
        self.assertIn('SCREEN-AXIS LOCK',prompt)
        self.assertIn('FURNITURE GEOMETRY LOCK',prompt)
        self.assertIn('camera_axis_transition',prompt)
        self.assertIn('AMBIENT MOTION',server.KLING_I2V_HARNESS)
        self.assertIn('never add foliage',server.KLING_I2V_HARNESS)
    def test_final_image_prompt_requires_frontal_camera_gaze(self):
        server=load_render_server()
        document={'production':{'timeline':{'scenes':[{'id':'first'},{'id':'last'}]}}}
        prompt=server.continuity_locked_prompt(document,{'id':'last','sequence':{}},'fixture')
        self.assertIn('FINAL SCENE',prompt)
        self.assertIn('looking naturally toward the camera lens',prompt)
        nonfinal=server.continuity_locked_prompt(document,{'id':'first','sequence':{}},'fixture')
        self.assertNotIn('FINAL SCENE',nonfinal)

if __name__=='__main__':unittest.main()
