"""Synthetic regressions: historical failed candidate bodies were not retained."""
import unittest

from tools.location_activity_validation import validate_location_activity_policy
from tools.storyboard_issue import StoryboardIssue
from tools.scene_validation_repair import target_scene


def candidate(role, text):
    return {'production': {
        'reference_assets': [{'id': 'room', 'kind': 'location', 'activity_role': role}],
        'timeline': {'scenes': [{'id': 'scene-01', 'reference_ids': ['room'],
                                 'image_prompt': {'text': text}}]},
    }}


class LocationActivityTests(unittest.TestCase):
    def test_rest_everywhere(self):
        for role in ('physical_therapy', 'dining', 'lobby'):
            for text in ('잠시 앉아 쉰다.', '미소를 지으며 대화한다.', '물리치료사가 옆에서 미소 짓는다.'):
                with self.subTest(role=role, text=text):
                    validate_location_activity_policy(candidate(role, text))

    def test_meals_allowed_in_dining_and_lobby(self):
        for role in ('dining', 'lobby'):
            validate_location_activity_policy(candidate(role, '어르신이 식사한다.'))

    def test_negative_and_context_not_actions(self):
        for text in (
            '관절 운동을 한다. 식사 장면 금지.',
            '관절 운동을 한다. No eating.',
            '식사 후에도 편안하게 앉아 미소 짓는다.',
            '이전 장면은 식사하는 모습. 현재는 관절 운동을 한다.',
            '다음 장면에서 식사한다. 현재는 쉰다.',
            '물리치료사가 식판 옆에서 미소를 짓는다.',
        ):
            with self.subTest(text=text):
                validate_location_activity_policy(candidate('physical_therapy', text))

    def test_real_conflicts_have_field_evidence(self):
        for role, text in (('physical_therapy', '어르신이 식사한다.'),
                           ('dining', '어르신이 관절 운동을 한다.'),
                           ('physical_therapy', '꽃꽂이 문화 프로그램을 한다.')):
            with self.subTest(role=role, text=text):
                with self.assertRaises(StoryboardIssue) as caught:
                    validate_location_activity_policy(candidate(role, text))
                self.assertEqual('LOCATION_ACTIVITY_CONFLICT', caught.exception.details['code'])
                self.assertEqual(['image_prompt.text'], caught.exception.details['field_paths'])
                self.assertTrue(caught.exception.details['evidence'])

    def test_negative_does_not_hide_separate_positive_clause(self):
        with self.assertRaises(StoryboardIssue):
            validate_location_activity_policy(candidate(
                'physical_therapy', '식사 장면 금지. 그런데 어르신은 식사한다.'))

    def test_negative_field_not_visible(self):
        value = candidate('physical_therapy', '관절 운동을 한다.')
        value['production']['timeline']['scenes'][0]['image_prompt']['negative_prompt'] = 'eating'
        validate_location_activity_policy(value)

    def test_structured_error_routes_only_editable_fields(self):
        value = candidate('physical_therapy', '식사한다.')
        for path, eligible in (('image_prompt.text', True), ('sequence.entry_action', False)):
            error = StoryboardIssue('LOCATION_ACTIVITY_CONFLICT', '표시 문구가 달라도 동일',
                                    scene_id='scene-01', field_paths=[path])
            self.assertEqual(eligible, target_scene(value, error) is not None)

    def test_same_policy_in_writer_reviewer_and_repair(self):
        import sys
        from pathlib import Path
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '01_app'))
        from render_server import script_plan_request_contract
        from storyboard_scene_reviewer import build_scene_review_prompt
        from tools.scene_validation_repair import repair_prompt
        value = candidate('lobby', '식사한다.')
        scene = value['production']['timeline']['scenes'][0]
        value['production']['timeline']['scenes'] = [dict(scene, id=f'scene-{i:02d}') for i in range(12)]
        for prompt in (script_plan_request_contract(['안심']), build_scene_review_prompt(value, 0),
                       repair_prompt(value, value['production']['timeline']['scenes'][0], '오류', None)):
            self.assertIn('중립 행동은 모든 장소에서 허용', prompt)
            self.assertIn('식사는 식당과 로비에서 허용', prompt)


if __name__ == '__main__':
    unittest.main()
