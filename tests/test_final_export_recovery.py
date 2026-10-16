import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "01_app"))

from automation_errors import AdapterFailure, RenderTerminalFailure
from final_export_recovery import FinalExportRecoveryAdapter


class FinalExportRecoveryTests(unittest.TestCase):
    def test_accepted_job_uses_server_deduplicated_identity_until_success(self):
        checked = []
        statuses = [
            {"status": "running"},
            {"status": "succeeded", "response": {"ok": True, "url": "/final.mp4"}},
        ]

        def status(job_id):
            checked.append(job_id)
            if job_id == "requested-job":
                raise AdapterFailure("not submitted yet")
            return statuses.pop(0)

        adapter = FinalExportRecoveryAdapter(
            lambda: {
                "ok": True, "status": "queued", "job_id": "deduplicated-job",
                "status_url": "/api/render/status?job_id=deduplicated-job",
            },
            status, initial_job_id="requested-job",
            poll_interval_seconds=0, recovery_timeout_seconds=1,
        )
        result = adapter.run({"attempt": 1})
        self.assertEqual("/final.mp4", result["value"]["url"])
        self.assertEqual(["requested-job", "deduplicated-job", "deduplicated-job"], checked)

    def test_safe_terminal_message_is_preserved(self):
        adapter = FinalExportRecoveryAdapter(
            lambda: None,
            lambda _job_id: {"status": "failed", "error": {"message": "자산 누락"}},
            initial_job_id="failed-job", poll_interval_seconds=0,
            recovery_timeout_seconds=1,
        )
        with self.assertRaisesRegex(RenderTerminalFailure, "자산 누락"):
            adapter.run({"attempt": 1})


if __name__ == "__main__":
    unittest.main()
