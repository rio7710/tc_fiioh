import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "01_app"))

import render_server as server
from final_export_queue import FinalExportQueue


class FinalExportSubmissionAPITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.queue = FinalExportQueue(Path(self.temp.name) / "queue.sqlite")

    def tearDown(self):
        self.temp.cleanup()

    @staticmethod
    def snapshot(job_id):
        return {
            "job_id": job_id, "project_id": "project-1", "user_id": "user-1",
            "idempotency_key": "sha256:same-input",
        }

    def submit(self, job_id):
        handler = server.Handler.__new__(server.Handler)
        handler.path = "/render"
        handler.current_user = lambda: {"user_id": "user-1"}
        handler.read_json = lambda: {"job_id": job_id, "project_id": "project-1"}
        captured = {}
        handler.send_json = lambda status, body: captured.update(status=status, body=body)
        with (
            patch.object(server, "IS_RENDER_HOSTED", False),
            patch.object(server, "get_auth_store", return_value=object()),
            patch.object(server, "get_final_export_queue", return_value=self.queue),
            patch.object(
                server, "build_final_export_snapshot",
                side_effect=lambda **kwargs: self.snapshot(kwargs["job_id"]),
            ),
            patch.object(server, "validate_json_schema_file", return_value=None),
            patch.object(server, "verify_snapshot", side_effect=lambda value: value),
            patch.object(server.time, "sleep", side_effect=AssertionError("submission must not wait")),
        ):
            handler.do_POST()
        return captured

    def test_render_returns_202_and_distinct_request_reuses_active_job(self):
        first = self.submit("render-request-1")
        second = self.submit("render-request-2")
        self.assertEqual(202, first["status"])
        self.assertEqual("render-request-1", first["body"]["job_id"])
        self.assertFalse(first["body"]["deduplicated"])
        self.assertEqual("render-request-1", second["body"]["job_id"])
        self.assertTrue(second["body"]["deduplicated"])
        self.assertEqual(
            "/api/render/status?job_id=render-request-1", second["body"]["status_url"],
        )


if __name__ == "__main__":
    unittest.main()
