import sys
import tempfile
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "01_app"))

from final_export_queue import FinalExportConflict, FinalExportNotFound, FinalExportQueue
from final_export_worker import execute_once
import render_server as server
from unittest.mock import patch


class FinalExportCancellationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.queue = FinalExportQueue(Path(self.temp.name) / "queue.sqlite")

    def tearDown(self):
        self.temp.cleanup()

    def enqueue(self, job_id="render-cancel-1"):
        return self.queue.enqueue(job_id, "owner", {"project_id": "project-1"})

    def test_queued_cancel_is_immediately_terminal(self):
        self.enqueue()
        result = self.queue.request_cancel("render-cancel-1", user_id="owner")
        self.assertEqual(result["status"], "cancelled")

    def test_running_cancel_keeps_lease_until_worker_acknowledges(self):
        self.enqueue()
        claimed = self.queue.claim("worker-a")
        requested = self.queue.request_cancel(claimed["job_id"], user_id="owner")
        self.assertEqual(requested["status"], "running")
        self.assertEqual(requested["lease_owner"], "worker-a")
        finished = self.queue.finish_cancel(claimed["job_id"], "worker-a")
        self.assertEqual(finished["status"], "cancelled")

    def test_finalize_boundary_rejects_late_cancel(self):
        self.enqueue()
        claimed = self.queue.claim("worker-a")
        self.queue.begin_finalize(claimed["job_id"], "worker-a")
        with self.assertRaises(FinalExportConflict):
            self.queue.request_cancel(claimed["job_id"], user_id="owner")

    def test_cancel_and_finalize_race_has_exactly_one_winner(self):
        self.enqueue()
        claimed = self.queue.claim("worker-a")
        barrier = threading.Barrier(2)
        outcomes = []

        def run(label, operation):
            barrier.wait()
            try:
                operation()
                outcomes.append((label, "won"))
            except FinalExportConflict:
                outcomes.append((label, "conflict"))

        cancel = threading.Thread(target=run, args=(
            "cancel", lambda: self.queue.request_cancel(claimed["job_id"], user_id="owner"),
        ))
        finalize = threading.Thread(target=run, args=(
            "finalize", lambda: self.queue.begin_finalize(claimed["job_id"], "worker-a"),
        ))
        cancel.start(); finalize.start(); cancel.join(); finalize.join()
        self.assertEqual(sorted(value for _, value in outcomes), ["conflict", "won"])

    def test_other_owner_cannot_discover_or_cancel_job(self):
        self.enqueue()
        with self.assertRaises(FinalExportNotFound):
            self.queue.request_cancel("render-cancel-1", user_id="other")

    def test_worker_observes_cancel_marker_and_finishes_cancel(self):
        self.enqueue()

        def executor(user_id, payload, *, progress_callback, cancel_callback):
            self.queue.request_cancel("render-cancel-1", user_id=user_id)
            self.assertTrue(cancel_callback())
            raise RuntimeError("cancelled internally")

        result = execute_once(self.queue, executor, "worker-a", heartbeat_seconds=0.01)
        self.assertEqual(result["status"], "cancelled")

    def test_authenticated_cancel_api_returns_202(self):
        self.enqueue()
        handler = server.Handler.__new__(server.Handler)
        handler.path = "/api/render/cancel"
        handler.current_user = lambda: {"user_id": "owner"}
        handler.read_json = lambda: {"job_id": "render-cancel-1"}
        captured = {}
        handler.send_json = lambda status, body: captured.update(status=status, body=body)
        with patch.object(server, "get_final_export_queue", return_value=self.queue):
            handler.do_POST()
        self.assertEqual(captured["status"], 202)
        self.assertEqual(captured["body"]["status"], "cancelled")

    def test_cancel_api_returns_409_after_finalize_boundary(self):
        self.enqueue()
        claimed = self.queue.claim("worker-a")
        self.queue.begin_finalize(claimed["job_id"], "worker-a")
        handler = server.Handler.__new__(server.Handler)
        handler.path = "/api/render/cancel"
        handler.current_user = lambda: {"user_id": "owner"}
        handler.read_json = lambda: {"job_id": claimed["job_id"]}
        captured = {}
        handler.send_json = lambda status, body: captured.update(status=status, body=body)
        with patch.object(server, "get_final_export_queue", return_value=self.queue):
            handler.do_POST()
        self.assertEqual(captured["status"], 409)


if __name__ == "__main__":
    unittest.main()
