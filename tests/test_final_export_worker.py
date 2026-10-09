import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "01_app"))

from final_export_queue import FinalExportQueue
from final_export_worker import RetryableFinalExportError, execute_once


class FinalExportWorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.queue = FinalExportQueue(Path(self.temp.name) / "queue.sqlite")
        self.payload = {"project_id": "project-1", "platforms": ["youtube"]}

    def tearDown(self):
        self.temp.cleanup()

    def test_worker_executes_claimed_job_and_persists_progress_and_result(self):
        self.queue.enqueue("render-job-1", "user-1", self.payload)
        calls = []

        def executor(user_id, payload, *, progress_callback):
            calls.append((user_id, payload))
            progress_callback({"phase": "scene", "progress": 0.5})
            return {"ok": True, "job_id": "render-job-1", "url": "/final.mp4"}

        result = execute_once(self.queue, executor, "worker-a", heartbeat_seconds=0.01)
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(result["result"]["url"], "/final.mp4")
        self.assertEqual(calls, [("user-1", self.payload)])
        self.assertIsNone(execute_once(self.queue, executor, "worker-a", heartbeat_seconds=0.01))

    def test_only_explicit_retryable_error_consumes_bounded_retry(self):
        self.queue.enqueue("render-job-1", "user-1", self.payload, max_attempts=2)

        def retryable(*args, **kwargs):
            raise RetryableFinalExportError("temporary")

        queued = execute_once(self.queue, retryable, "worker-a", heartbeat_seconds=0.01)
        self.assertEqual((queued["status"], queued["attempt"]), ("queued", 2))
        failed = execute_once(self.queue, retryable, "worker-b", heartbeat_seconds=0.01)
        self.assertEqual(failed["status"], "failed")
        self.assertNotIn("temporary", failed["error"]["message"])

    def test_generic_executor_failure_is_terminal_and_safe(self):
        self.queue.enqueue("render-job-1", "user-1", self.payload)

        def broken(*args, **kwargs):
            raise RuntimeError("secret /private/token")

        failed = execute_once(self.queue, broken, "worker-a", heartbeat_seconds=0.01)
        self.assertEqual(failed["status"], "failed")
        self.assertNotIn("private/token", failed["error"]["message"])

    def test_late_executor_result_cannot_resurrect_cancelled_job(self):
        self.queue.enqueue("render-job-1", "user-1", self.payload)

        def cancelled(user_id, payload, *, progress_callback):
            self.queue.cancel("render-job-1", user_id=user_id)
            return {"ok": True, "url": "/must-not-register.mp4"}

        result = execute_once(self.queue, cancelled, "worker-a", heartbeat_seconds=0.01)
        self.assertEqual(result["status"], "cancelled")
        self.assertIsNone(result["result"])


if __name__ == "__main__":
    unittest.main()
