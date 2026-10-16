import sqlite3
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "01_app"))

from final_export_queue import FinalExportQueue


class FinalExportQueueIdempotencyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "queue.sqlite"
        self.queue = FinalExportQueue(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def enqueue(self, job_id):
        return FinalExportQueue(self.path).enqueue(
            job_id, "user-1", {"job_id": job_id, "project_id": "project-1"},
            project_id="project-1", idempotency_key="sha256:same-input",
        )

    def test_concurrent_distinct_job_ids_converge_on_one_active_job(self):
        with ThreadPoolExecutor(max_workers=8) as pool:
            rows = list(pool.map(self.enqueue, [f"render-job-{index}" for index in range(16)]))
        self.assertEqual(1, len({row["job_id"] for row in rows}))
        with sqlite3.connect(self.path) as db:
            count = db.execute("SELECT COUNT(*) FROM final_export_jobs").fetchone()[0]
        self.assertEqual(1, count)

    def test_terminal_job_allows_a_new_execution_for_same_input(self):
        first = self.enqueue("render-job-first")
        claimed = self.queue.claim("worker-1")
        self.queue.succeed(claimed["job_id"], "worker-1", {"ok": True})
        second = self.enqueue("render-job-second")
        self.assertNotEqual(first["job_id"], second["job_id"])

    def test_queue_position_is_stable_and_hidden_after_claim(self):
        first = self.queue.enqueue("render-position-1", "user-1", {"project_id": "project-1"})
        second = self.queue.enqueue("render-position-2", "user-1", {"project_id": "project-2"})
        self.assertEqual(self.queue.position(first["job_id"], user_id="user-1"), 1)
        self.assertEqual(self.queue.position(second["job_id"], user_id="user-1"), 2)
        self.queue.claim("worker-a")
        self.assertEqual(self.queue.position(first["job_id"], user_id="user-1"), 0)
        self.assertEqual(self.queue.position(second["job_id"], user_id="user-1"), 1)

    def test_existing_database_gets_additive_idempotency_column(self):
        columns = {
            row[1] for row in sqlite3.connect(self.path).execute(
                "PRAGMA table_info(final_export_jobs)"
            )
        }
        self.assertIn("idempotency_key", columns)


if __name__ == "__main__":
    unittest.main()
