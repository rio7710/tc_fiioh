import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "01_app"))

from final_export_queue import FinalExportConflict, FinalExportNotFound, FinalExportQueue


NOW = "2026-10-09T00:00:00+00:00"


class FinalExportQueueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.queue = FinalExportQueue(Path(self.temp.name) / "queue.sqlite")
        self.payload = {"project_id": "project-1", "platforms": ["youtube"]}

    def tearDown(self):
        self.temp.cleanup()

    def test_enqueue_is_idempotent_and_rejects_job_id_reuse(self):
        first = self.queue.enqueue("render-job-1", "user-1", self.payload, now=NOW)
        duplicate = self.queue.enqueue("render-job-1", "user-1", self.payload, now=NOW)
        self.assertEqual(first, duplicate)
        with self.assertRaises(FinalExportConflict):
            self.queue.enqueue("render-job-1", "user-1", {**self.payload, "platforms": ["instagram"]})
        with self.assertRaises(FinalExportNotFound):
            self.queue.get("render-job-1", user_id="other-user")

    def test_concurrent_enqueue_creates_one_logical_job(self):
        def enqueue(_):
            return FinalExportQueue(self.queue.path).enqueue(
                "render-job-1", "user-1", self.payload, now=NOW
            )

        with ThreadPoolExecutor(max_workers=8) as pool:
            jobs = list(pool.map(enqueue, range(16)))
        self.assertEqual({job["job_id"] for job in jobs}, {"render-job-1"})
        self.assertEqual(self.queue.get("render-job-1")["status"], "queued")

    def test_claim_progress_heartbeat_and_success_require_lease_owner(self):
        self.queue.enqueue("render-job-1", "user-1", self.payload, now=NOW)
        job = self.queue.claim("worker-a", now=NOW, lease_seconds=60)
        self.assertEqual(job["status"], "running")
        self.assertIsNone(self.queue.claim("worker-b", now=NOW))
        with self.assertRaises(FinalExportConflict):
            self.queue.update_progress(job["job_id"], "worker-b", {"progress": 0.5})
        progress = self.queue.update_progress(job["job_id"], "worker-a", {"status": "queued", "phase": "composite", "progress": 0.5})
        self.assertEqual(progress["progress"]["phase"], "composite")
        self.assertNotIn("status", progress["progress"])
        heartbeat = self.queue.heartbeat(job["job_id"], "worker-a", now="2026-10-09T00:00:30+00:00", lease_seconds=60)
        self.assertEqual(heartbeat["lease_until"], "2026-10-09T00:01:30+00:00")
        done = self.queue.succeed(job["job_id"], "worker-a", {"ok": True, "url": "/final.mp4"})
        self.assertEqual(done["status"], "succeeded")
        self.assertEqual(done["result"]["url"], "/final.mp4")

    def test_expired_lease_requeues_until_bounded_attempts_are_exhausted(self):
        self.queue.enqueue("render-job-1", "user-1", self.payload, max_attempts=2, now=NOW)
        first = self.queue.claim("worker-a", now=NOW, lease_seconds=10)
        self.assertEqual(first["attempt"], 1)
        recovered = self.queue.recover_expired(now="2026-10-09T00:00:11+00:00")
        self.assertEqual(recovered[0]["status"], "queued")
        self.assertEqual(recovered[0]["attempt"], 2)
        self.queue.claim("worker-b", now="2026-10-09T00:00:12+00:00", lease_seconds=10)
        exhausted = self.queue.recover_expired(now="2026-10-09T00:00:23+00:00")
        self.assertEqual(exhausted[0]["status"], "failed")
        self.assertEqual(exhausted[0]["attempt"], 2)
        self.assertFalse(exhausted[0]["error"]["retryable"])

    def test_retryable_failure_requeues_and_terminal_failure_stops(self):
        self.queue.enqueue("render-job-1", "user-1", self.payload, max_attempts=2, now=NOW)
        self.queue.claim("worker-a", now=NOW)
        retry = self.queue.fail("render-job-1", "worker-a", {"code": "temporary"}, retryable=True)
        self.assertEqual((retry["status"], retry["attempt"]), ("queued", 2))
        self.queue.claim("worker-b", now=NOW)
        failed = self.queue.fail("render-job-1", "worker-b", {"code": "temporary"}, retryable=True)
        self.assertEqual(failed["status"], "failed")
        self.assertFalse(failed["error"]["retryable"])

    def test_terminal_queue_status_cannot_be_overwritten_by_stale_progress_status(self):
        self.queue.enqueue("render-job-1", "user-1", self.payload, now=NOW)
        self.queue.claim("worker-a", now=NOW)
        self.queue.update_progress(
            "render-job-1", "worker-a",
            {"status": "running", "phase": "composite", "progress": 0.9}, now=NOW,
        )
        failed = self.queue.fail(
            "render-job-1", "worker-a", {"code": "ffmpeg_failed"}, now=NOW
        )

        self.assertEqual(failed["status"], "failed")
        self.assertNotIn("status", failed["progress"])
        self.assertEqual(self.queue.get("render-job-1")["status"], "failed")


if __name__ == "__main__":
    unittest.main()
