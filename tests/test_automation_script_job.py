import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '01_app'))
from automation_script_job import generate_via_script_job
from automation_errors import AdapterFailure, ContentRepairExhausted
from automation_runner import InternalAPI


class ScriptQueueAdapterTests(unittest.TestCase):
    def test_production_client_routes_legacy_operation_to_queue_adapter(self):
        api = object.__new__(InternalAPI)
        with patch('automation_runner.generate_via_script_job', return_value={'ok': True}) as queued:
            self.assertEqual({'ok': True}, api.call('/api/script/generate', {'project_id': 'p'}))
        queued.assert_called_once_with(api, {'project_id': 'p'})

    def api(self, *responses):
        return SimpleNamespace(call=Mock(side_effect=responses),
            settings=SimpleNamespace(api_retry_count=3, api_retry_backoff_seconds=0))

    def test_same_job_polled_until_saved_result(self):
        result = {'ok': True, 'generation': {'repair_count': 2}}
        api = self.api({'job_id': 'a/b'}, {'status': 'queued'},
            {'status': 'running'}, {'status': 'succeeded', 'response': result})
        self.assertEqual(result, generate_via_script_job(api, {'project_id': 'p'}, sleep=lambda _: None))
        self.assertEqual('/api/script/jobs', api.call.call_args_list[0].args[0])
        self.assertTrue(all(c.args == ('/api/script/job-status?job_id=a%2Fb', None)
                            for c in api.call.call_args_list[1:]))

    def test_unknown_submission_is_never_replayed(self):
        api = self.api(AdapterFailure('result unknown'))
        with self.assertRaises(AdapterFailure):
            generate_via_script_job(api, {}, sleep=lambda _: None)
        self.assertEqual(1, api.call.call_count)

    def test_transient_read_failure_does_not_submit_again(self):
        api = self.api({'job_id': 'a'}, AdapterFailure('read timeout'),
            {'status': 'succeeded', 'response': {'ok': True}})
        generate_via_script_job(api, {}, sleep=lambda _: None)
        self.assertEqual(1, sum(c.args[0] == '/api/script/jobs' for c in api.call.call_args_list))

    def test_confirmed_content_failure_keeps_recovery_type(self):
        api = self.api({'job_id': 'a'}, {'status': 'failed', 'error': {'message': 'scene-02 image_prompt 오류'}})
        with self.assertRaises(ContentRepairExhausted):
            generate_via_script_job(api, {}, sleep=lambda _: None)

    def test_missing_asset_failure_is_not_restarted(self):
        api = self.api({'job_id': 'a'}, {'status': 'failed', 'error': {'message': 'scene-02 자산 파일 누락'}})
        with self.assertRaises(AdapterFailure) as error:
            generate_via_script_job(api, {}, sleep=lambda _: None)
        self.assertNotIsInstance(error.exception, ContentRepairExhausted)

    def test_structured_location_failure_does_not_depend_on_message(self):
        api = self.api({'job_id': 'a'}, {'status': 'failed', 'error': {
            'code': 'LOCATION_REFERENCE_MULTIPLE', 'severity': 'repairable',
            'retryable': True, 'message': '장소 레퍼런스 선택 오류'}})
        with self.assertRaises(ContentRepairExhausted):
            generate_via_script_job(api, {}, sleep=lambda _: None)

    def test_structured_hard_failure_never_uses_legacy_message_match(self):
        api = self.api({'job_id': 'a'}, {'status': 'failed', 'error': {
            'code': 'ASSET_FILE_MISSING', 'severity': 'hard',
            'retryable': False, 'message': 'scene-01 오류'}})
        with self.assertRaises(AdapterFailure) as caught:
            generate_via_script_job(api, {}, sleep=lambda _: None)
        self.assertNotIsInstance(caught.exception, ContentRepairExhausted)

    def test_cancelled_job_stops_pipeline(self):
        api = self.api({'job_id': 'a'}, {'status': 'cancelled'})
        with self.assertRaises(InterruptedError):
            generate_via_script_job(api, {}, sleep=lambda _: None)

    def test_missing_result_and_unknown_state_fail_closed(self):
        for job in ({'status': 'succeeded', 'response': None}, {'status': 'stale'}):
            with self.subTest(job=job):
                api = self.api({'job_id': 'a'}, job)
                with self.assertRaises(AdapterFailure):
                    generate_via_script_job(api, {}, sleep=lambda _: None)

    def test_queue_worker_passes_job_identity_into_service(self):
        import render_server
        queue = Mock()
        queue.claim.return_value = {'input': {'user_id': 'u'}, 'project_id': 'p'}
        with patch.object(render_server, 'get_script_job_store', return_value=queue), \
             patch.object(render_server, 'execute_script_generation', return_value={'ok': True}) as execute:
            render_server._run_script_job('job-a')
        self.assertEqual('job-a', execute.call_args.kwargs['job_id'])
        self.assertEqual(('u', 'p'), execute.call_args.args[:2])
        queue.transition.assert_called_once_with('job-a', 'succeeded', result={'ok': True})


if __name__ == '__main__':
    unittest.main()
