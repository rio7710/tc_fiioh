import json
import sys
import tempfile
import unittest
import uuid
import io
from unittest import mock
from urllib.error import HTTPError
from pathlib import Path
from contextlib import closing

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '01_app'))
from auth_store import AuthStore
from automation_store import AutomationStore, now_iso
from automation_recovery import is_content_repair_failure
from tools.scene_validation_repair import target_scene, apply_patch_response
from automation_runner import InternalAPI, ContentRepairExhausted
from tools import unified_content_prompt_harness as harness


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.auth = AuthStore(Path(self.tmp.name) / 'db.sqlite')
        self.user = self.auth.create_user('recover_user', 'test-password-123')['user_id']
        self.store = AutomationStore(self.auth)
        self.config = {'schema_version': '1.0.0', 'endpoint': '3',
            'repeat': {'unit': 'count', 'interval': 1},
            'keywords': {'count': 1, 'ai': False, 'month': ''},
            'video': {'scene_count': 0, 'crop': 'default'},
            'brand': {'intro': False, 'outro': False, 'watermark': False},
            'channels': ['youtube']}

    def tearDown(self):
        self.tmp.cleanup()

    def start(self):
        self.store.configure(self.user, 'start', {'version': 0,
            'request_id': str(uuid.uuid4()), 'config': self.config})
        self.store.enqueue_due(now_iso())
        return self.store.claim('test', now_iso())

    def test_bounded_fresh_projects_and_durable_failure(self):
        run = self.start()
        projects = {run['project_id']}
        for number in range(3):
            self.store.finish(run, 'failed', 'content_repair_exhausted', 'scene-05 invalid')
            self.store.finish(run, 'failed', 'content_repair_exhausted', 'duplicate completion')
            next_run = self.store.claim('test', now_iso())
            if number < 2:
                self.assertIsNotNone(next_run)
                self.assertNotIn(next_run['project_id'], projects)
                projects.add(next_run['project_id'])
                run = next_run
            else:
                self.assertIsNone(next_run)
        rows = self.store.snapshot(self.user)['runs']
        self.assertEqual(3, len(rows))
        self.assertTrue(all(r['status'] == 'failed' for r in rows))
        with closing(self.auth._connect()) as db:
            self.assertEqual(2, db.execute('SELECT COUNT(*) FROM automation_recovery_links').fetchone()[0])

    def test_stop_prevents_replacement(self):
        run = self.start()
        self.store.configure(self.user, 'stop', {'request_id': str(uuid.uuid4())})
        self.store.finish(run, 'failed', 'content_repair_exhausted', 'scene-05 invalid')
        self.assertIsNone(self.store.claim('test', now_iso()))
        self.assertEqual('cancelled', self.store.snapshot(self.user)['runs'][0]['status'])

    def test_unknown_failure_stops(self):
        run = self.start()
        self.store.finish(run, 'failed', 'adapter_failed', 'timeout')
        self.assertIsNone(self.store.claim('test', now_iso()))

    def test_api_classification_reaches_runner_contract(self):
        api = InternalAPI(self.auth, self.user)
        body = io.BytesIO(json.dumps({'error': 'scene-05 image_prompt 검증 실패'}).encode())
        try:
            with mock.patch('automation_runner.urlopen', side_effect=HTTPError('url', 400, 'invalid', {}, body)):
                with self.assertRaises(ContentRepairExhausted):
                    api.call('/api/script/plan', {})
        finally:
            api.close()

    def test_production_stops_after_three_repairs_without_hidden_regeneration(self):
        candidate = {'project': {}, 'concept_variants': [], 'selected_variant_id': '',
                     'production': {'timeline': {'scenes': []}}}
        generate = mock.Mock(return_value=json.dumps(candidate))
        with mock.patch.object(harness, 'validate_document', side_effect=harness.UnifiedContentError('schema validation')):
            with self.assertRaises(harness.UnifiedContentError):
                harness.run_generation_harness(generate, ['안심'], '자료', max_fresh_regenerations=0)
        self.assertEqual(4, generate.call_count)

    def test_replacement_does_not_consume_next_requested_slot(self):
        self.config['repeat']['interval'] = 2
        original = self.start()
        self.store.finish(original, 'failed', 'content_repair_exhausted', 'scene-05 invalid')
        replacement = self.store.claim('test', now_iso())
        self.store.finish(replacement, 'succeeded')
        self.store.enqueue_due('2099-01-01T00:00:00+00:00')
        second = self.store.claim('test', now_iso())
        self.assertIsNotNone(second)
        self.store.finish(second, 'succeeded')
        self.store.enqueue_due('2099-01-01T00:00:00+00:00')
        self.assertIsNone(self.store.claim('test', now_iso()))
        self.assertEqual(3, len(self.store.snapshot(self.user)['runs']))

    def test_classifier_fails_closed(self):
        self.assertTrue(is_content_repair_failure('/api/script/generate', 400, 'scene-05 image_prompt 오류'))
        for error in ('scene-05 레퍼런스 준비되지 않았습니다', 'scene-05 API 키 인증 실패',
                      'scene-05 quota', 'scene-05 no space', 'scene-05 연결 시간 초과', 'unknown'):
            self.assertFalse(is_content_repair_failure('/api/script/generate', 400, error))
        self.assertFalse(is_content_repair_failure('/api/script/generate', 502, 'scene-05 오류'))
        self.assertFalse(is_content_repair_failure('/api/render', 400, 'scene-05 오류'))

    def test_partial_patch_preserves_other_scene_and_narration(self):
        scene = {'id': 'scene-05', 'narration': {'text': '원문'},
                 'image_prompt': {'text': 'before', 'source': 'provided'}}
        doc = {'production': {'timeline': {'scenes': [scene, {'id': 'scene-06'}]}}}
        self.assertEqual(scene, target_scene(doc, 'scene-05 image_prompt 오류'))
        response = json.dumps({'scene_id': 'scene-05', 'patch': {'image_prompt': {'text': 'after'}}})
        result = json.loads(apply_patch_response(doc, scene, response))
        self.assertEqual('before', scene['image_prompt']['text'])
        self.assertEqual({'text': '원문'}, result['production']['timeline']['scenes'][0]['narration'])
        self.assertEqual({'id': 'scene-06'}, result['production']['timeline']['scenes'][1])
        for patch in ({'start': 0}, {'reference_ids': []}, {'image_prompt': {'text': ''}}):
            with self.assertRaises(ValueError):
                apply_patch_response(doc, scene, json.dumps({'scene_id': 'scene-05', 'patch': patch}))


if __name__ == '__main__':
    unittest.main()
