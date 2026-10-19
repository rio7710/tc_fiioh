import copy
import json
import unittest

from tools.location_reference_validation import validate_location_references
from tools.scene_structure_repair import structure_target, apply_structure_response
from tools.storyboard_issue import StoryboardIssue
from tools.scene_activity_repair import activity_target, apply_activity_response


class StructureRepairTests(unittest.TestCase):
    def setUp(self):
        self.assets = {key: dict(id=key, kind='location', status='ready', uri=key+'.png')
                       for key in ('room-a', 'room-b')}
        self.scene = dict(id='scene-01', reference_ids=['person', 'room-a', 'room-b'],
                          start=0, end=3, narration={'text': '그대로'}, sequence={'entry_action': '쉰다'})
        self.document = dict(production=dict(reference_assets=list(self.assets.values()),
                                             timeline=dict(scenes=[self.scene, dict(id='scene-02')])))

    def issue(self):
        with self.assertRaises(StoryboardIssue) as caught:
            validate_location_references(self.document, self.assets)
        return caught.exception

    def test_multiple_locations_detected_without_corridor(self):
        issue = self.issue()
        self.assertEqual('LOCATION_REFERENCE_MULTIPLE', issue.details['code'])
        self.assertEqual(['reference_ids'], issue.details['field_paths'])

    def test_selection_preserves_other_fields_and_scenes(self):
        original = copy.deepcopy(self.document)
        scene, choices = structure_target(self.document, self.issue(), self.assets)
        result = apply_structure_response(self.document, scene, choices, self.assets,
                                          json.dumps(dict(scene_id='scene-01', location_id='room-a')))
        expected = copy.deepcopy(original)
        expected['production']['timeline']['scenes'][0]['reference_ids'] = ['person', 'room-a']
        self.assertEqual(expected, result)
        self.assertEqual(original, self.document)
        validate_location_references(result, self.assets)

    def test_ambiguous_unknown_and_extra_fields_rejected(self):
        scene, choices = structure_target(self.document, self.issue(), self.assets)
        for response in (dict(scene_id='scene-01', location_id=None),
                         dict(scene_id='scene-01', location_id='unknown'),
                         dict(scene_id='scene-02', location_id='room-a'),
                         dict(scene_id='scene-01', location_id='room-a', narration='변경')):
            with self.subTest(response=response), self.assertRaises(ValueError):
                apply_structure_response(self.document, scene, choices, self.assets, json.dumps(response))

    def test_missing_registered_candidates_do_not_allow_structure_patch(self):
        issue = self.issue()
        self.assertIsNone(structure_target(self.document, issue, {}))
        self.assets['room-b']['status'] = 'pending'
        self.assertIsNone(structure_target(self.document, issue, self.assets))

    def test_activity_patch_only_changes_evidence_field(self):
        issue = StoryboardIssue('LOCATION_ACTIVITY_CONFLICT', '충돌', scene_id='scene-01',
                                field_paths=['sequence.entry_action'])
        scene, paths = activity_target(self.document, issue)
        original = copy.deepcopy(self.document)
        result = apply_activity_response(self.document, scene, paths,
            json.dumps(dict(scene_id='scene-01', edits={'sequence.entry_action': '관절 운동을 한다'})))
        expected = copy.deepcopy(original)
        expected['production']['timeline']['scenes'][0]['sequence']['entry_action'] = '관절 운동을 한다'
        self.assertEqual(expected, result)
        self.assertEqual(original, self.document)
        with self.assertRaises(ValueError):
            apply_activity_response(self.document, scene, paths,
                json.dumps(dict(scene_id='scene-01', edits={'narration.text': '변경'})))

    def test_harness_revalidates_patch_and_logs_rejection(self):
        from test_unified_content_prompt_harness import document
        from tools.unified_content_prompt_harness import run_generation_harness
        value = document(['안심'])
        value['production']['reference_assets'][1].update(kind='location', uri='물리치료실.png')
        calls, diagnostics = [], []
        def generate(prompt):
            calls.append(prompt)
            if len(calls) == 1:
                return json.dumps(value)
            return json.dumps(dict(scene_id='scene-01', edits={
                'image_prompt.text': '식사한다.' if len(calls) == 2 else '잠시 앉아 쉰다.'}))
        result = run_generation_harness(generate, ['안심'], '자료', diagnostic_callback=diagnostics.append,
                                         max_fresh_regenerations=0)
        self.assertEqual(3, len(calls))
        self.assertTrue(any(d['event'] == 'activity_patch_rejected' for d in diagnostics))
        self.assertTrue(any(d['event'] == 'activity_patch_accepted' for d in diagnostics))
        self.assertIn('document', result)


if __name__ == '__main__':
    unittest.main()
