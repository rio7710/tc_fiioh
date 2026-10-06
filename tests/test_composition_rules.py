import unittest
from test_pipeline_contracts import load_render_server, ROOT
from tools.unified_content_prompt_harness import build_prompt


class CompositionRuleTests(unittest.TestCase):
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
