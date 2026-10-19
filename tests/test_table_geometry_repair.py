"""Synthetic reproduction of the logged geometry failure (raw candidate unavailable)."""
import copy
import json
import unittest

from test_unified_content_prompt_harness import document
from tools.unified_content_prompt_harness import validate_visual_continuity, run_generation_harness
from tools.table_geometry_repair import table_target, apply_table_response
from tools.storyboard_issue import StoryboardIssue


def candidate():
    value = document(['안심'])
    value['production']['reference_assets'][1].update(kind='location', usage='식당의 원형 테이블 기준')
    value['production']['continuity'] = {'props': [{'text': '식당의 직사각형 테이블'},
                                                {'text': '로비의 사각 테이블'}]}
    value['production']['timeline']['scenes'][0]['image_prompt']['text'] = '식당의 원형 테이블에서 식사한다.'
    return value


class TableRepairTests(unittest.TestCase):
    def issue(self, value):
        with self.assertRaises(StoryboardIssue) as caught:
            validate_visual_continuity(value)
        return caught.exception

    def test_error_identifies_scene_and_scoped_props(self):
        issue = self.issue(candidate())
        self.assertEqual('TABLE_GEOMETRY_CONFLICT', issue.details['code'])
        self.assertEqual('scene-01', issue.details['scene_id'])
        self.assertIn('production.continuity.props.0', issue.details['field_paths'])
        self.assertNotIn('production.continuity.props.1', issue.details['field_paths'])

    def test_other_location_ledger_does_not_override_current_reference(self):
        value = candidate()
        value['production']['continuity']['props'] = [{'text': '로비의 사각 테이블'}]
        value['production']['timeline']['scenes'][0]['image_prompt']['text'] += ' 기준 레퍼런스대로 유지한다.'
        validate_visual_continuity(value)

    def test_patch_preserves_reference_and_unrelated_fields(self):
        value = candidate()
        original = copy.deepcopy(value)
        issue = self.issue(value)
        paths = table_target(value, issue)
        patched = apply_table_response(value, issue, paths, json.dumps(dict(scene_id='scene-01',
            edits={'production.continuity.props.0.text': '식당의 원형 테이블'})))
        expected = copy.deepcopy(original)
        expected['production']['continuity']['props'][0]['text'] = '식당의 원형 테이블'
        self.assertEqual(expected, patched)
        self.assertEqual(original, value)
        validate_visual_continuity(patched)

    def test_arbitrary_fields_rejected(self):
        value = candidate()
        issue = self.issue(value)
        for key in ('production.reference_assets.1.usage', 'production.continuity.props.1.text',
                    'production.timeline.scenes.0.narration.text'):
            with self.subTest(key=key), self.assertRaises(ValueError):
                apply_table_response(value, issue, table_target(value, issue),
                    json.dumps(dict(scene_id='scene-01', edits={key: '변경'})))

    def test_harness_rejects_invalid_then_accepts_scoped_repair(self):
        value = candidate()
        calls, diagnostics = [], []
        def generate(prompt):
            calls.append(prompt)
            if len(calls) == 1:
                return json.dumps(value)
            shape = '직사각형' if len(calls) == 2 else '원형'
            return json.dumps(dict(scene_id='scene-01', edits={
                'production.continuity.props.0.text': f'식당의 {shape} 테이블'}))
        result = run_generation_harness(generate, ['안심'], '자료', diagnostic_callback=diagnostics.append,
                                         max_fresh_regenerations=0)
        self.assertEqual(3, len(calls))
        self.assertTrue(any(r['event'] == 'table_patch_rejected' for r in diagnostics))
        self.assertTrue(any(r['event'] == 'table_patch_accepted' for r in diagnostics))
        self.assertEqual('로비의 사각 테이블', result['document']['production']['continuity']['props'][1]['text'])


if __name__ == '__main__':
    unittest.main()
