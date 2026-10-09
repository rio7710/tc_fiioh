import json
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "01_app"))

from worker_core import JobConflict, JobStore, JobValidationError, compute_input_hash


NOW = "2026-10-06T00:00:00+00:00"


class FixtureAdapter:
    def __init__(self, result=None, failure=None):
        self.calls = []
        self.result = result or {"artifact_uri": "memory://scene-1"}
        self.failure = failure

    def run(self, job):
        self.calls.append(job)
        if self.failure:
            raise self.failure
        return self.result


class WorkerJobCoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "jobs.json"
        self.store = JobStore(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def create(self, input=None):
        return self.store.create("project-1", "scene_image", input or {"scene_id": "scene-1"}, now=NOW)

    def test_input_hash_is_canonical_and_duplicate_create_reuses_job(self):
        first = self.store.create("project-1", "final_composite", {"scenes": [1], "voice": "a"}, now=NOW)
        duplicate = self.store.create("project-1", "final_composite", {"voice": "a", "scenes": [1]}, now=NOW)
        other_stage = self.store.create("project-1", "scene_image", {"scenes": [1], "voice": "a"}, now=NOW)

        self.assertEqual(first["job_id"], duplicate["job_id"])
        self.assertNotEqual(first["job_id"], other_stage["job_id"])
        self.assertEqual(first["input_hash"], compute_input_hash({"voice": "a", "scenes": [1]}))
        self.assertEqual(len(self.store.list()), 2)

    def test_separate_store_instances_cannot_create_duplicate_job(self):
        def create_once():
            return JobStore(self.path).create("project-1", "scene_image", {"scene_id": "same"})

        with ThreadPoolExecutor(max_workers=8) as pool:
            jobs = list(pool.map(lambda _: create_once(), range(8)))
        self.assertEqual(len({job["job_id"] for job in jobs}), 1)
        self.assertEqual(len(JobStore(self.path).list()), 1)

    def test_claim_and_transition_enforce_single_execution_and_states(self):
        job = self.create()
        claimed = self.store.claim(job["job_id"], "worker-a", now=NOW, lease_seconds=60)
        self.assertEqual(claimed["status"], "running")
        self.assertEqual(claimed["worker_id"], "worker-a")
        with self.assertRaises(JobConflict):
            self.store.claim(job["job_id"], "worker-b", now=NOW)

        finished = self.store.transition(
            job["job_id"], "succeeded", result={"artifact_uri": "memory://scene-1"}, now=NOW
        )
        self.assertEqual(finished["status"], "succeeded")
        self.assertIsNone(finished["lease_expires_at"])
        with self.assertRaises(JobConflict):
            self.store.transition(job["job_id"], "queued", now=NOW)

    def test_failed_job_retry_keeps_idempotency_and_increments_attempt(self):
        job = self.create()
        self.store.claim(job["job_id"], "worker-a", now=NOW)
        failed = self.store.transition(
            job["job_id"], "failed", error={"code": "provider_timeout"}, now=NOW
        )
        retried = self.store.retry(job["job_id"], now=NOW)
        self.assertEqual(retried["status"], "queued")
        self.assertEqual(retried["attempt"], 2)
        self.assertEqual(retried["idempotency_key"], failed["idempotency_key"])
        self.assertEqual(retried["input_hash"], failed["input_hash"])

    def test_dispatch_stops_at_bounded_attempt_limit_without_adapter_replay(self):
        adapter = FixtureAdapter(failure=RuntimeError("retryable failure"))
        first = self.store.dispatch(
            "project-1", "final_composite", {"render_job_id": "render-1"}, adapter,
            worker_id="worker-a", max_attempts=2,
        )
        second = self.store.dispatch(
            "project-1", "final_composite", {"render_job_id": "render-1"}, adapter,
            worker_id="worker-b", max_attempts=2,
        )
        exhausted = self.store.dispatch(
            "project-1", "final_composite", {"render_job_id": "render-1"}, adapter,
            worker_id="worker-c", max_attempts=2,
        )

        self.assertEqual(first["attempt"], 1)
        self.assertEqual(second["attempt"], 2)
        self.assertEqual(exhausted["attempt"], 2)
        self.assertEqual(exhausted["status"], "failed")
        self.assertEqual(len(adapter.calls), 2)

    def test_expired_running_job_becomes_stale_and_can_restart(self):
        job = self.create()
        self.store.claim(job["job_id"], "dead-worker", now=NOW, lease_seconds=30)
        stale = self.store.recover_stale(now="2026-10-06T00:01:00+00:00")
        self.assertEqual(len(stale), 1)
        self.assertEqual(stale[0]["status"], "stale")
        self.assertEqual(stale[0]["error"]["code"], "lease_expired")
        restarted = self.store.retry(job["job_id"], now="2026-10-06T00:01:01+00:00")
        self.assertEqual(restarted["status"], "queued")
        self.assertEqual(restarted["attempt"], 2)

    def test_cancelled_job_is_terminal(self):
        job = self.create()
        self.store.claim(job["job_id"], "worker-a", now=NOW)
        cancelled = self.store.transition(job["job_id"], "cancelled", now=NOW)
        self.assertEqual(cancelled["status"], "cancelled")
        with self.assertRaises(JobConflict):
            self.store.retry(job["job_id"], now=NOW)

    def test_project_tombstone_cancels_work_and_blocks_recreation(self):
        queued = self.create({"scene_id": "queued"})
        running = self.store.create("project-1", "final_composite", {"render": "running"})
        self.store.claim(running["job_id"], "worker-a", now=NOW)

        tombstone = self.store.tombstone_project("project-1", now=NOW)

        self.assertEqual(tombstone["reason"], "project_deleted")
        self.assertEqual(self.store.get(queued["job_id"])["status"], "cancelled")
        self.assertEqual(self.store.get(running["job_id"])["status"], "cancelled")
        with self.assertRaises(JobConflict):
            self.store.create("project-1", "scene_image", {"scene_id": "new"})
        with self.assertRaises(JobConflict):
            self.store.retry(running["job_id"])

    def test_late_adapter_completion_cannot_resurrect_tombstoned_project(self):
        job = self.create({"scene_id": "late"})

        class LateAdapter:
            def run(self, snapshot):
                self.store.tombstone_project(snapshot["project_id"], now=NOW)
                return {"artifact_uri": "memory://must-not-complete"}

            def __init__(self, store):
                self.store = store

        result = self.store.execute(
            job["job_id"],
            "worker-a",
            LateAdapter(self.store),
            cancellation_check=lambda: self.store.is_project_tombstoned("project-1"),
        )

        self.assertEqual(result["status"], "cancelled")
        self.assertIsNone(result["result"])

    def test_late_success_without_cancellation_callback_is_cancelled(self):
        job = self.create({"scene_id": "late-without-callback"})

        class LateAdapter:
            def run(self, snapshot):
                self.store.tombstone_project(snapshot["project_id"], now=NOW)
                return {"artifact_uri": "memory://must-not-persist"}

            def __init__(self, store):
                self.store = store

        result = self.store.execute(job["job_id"], "worker-a", LateAdapter(self.store))

        self.assertEqual(result["status"], "cancelled")
        self.assertIsNone(result["result"])
        self.assertEqual(self.store.get(job["job_id"])["status"], "cancelled")

    def test_tombstone_then_adapter_interrupted_error_keeps_cancelled_state(self):
        job = self.create({"scene_id": "interrupted-after-delete"})

        class InterruptedAdapter:
            def run(self, snapshot):
                self.store.tombstone_project(snapshot["project_id"], now=NOW)
                raise InterruptedError("provider stopped")

            def __init__(self, store):
                self.store = store

        result = self.store.execute(job["job_id"], "worker-a", InterruptedAdapter(self.store))

        self.assertEqual(result["status"], "cancelled")
        self.assertIsNone(result["result"])
        self.assertEqual(self.store.get(job["job_id"])["status"], "cancelled")

    def test_tombstone_then_adapter_generic_error_keeps_cancelled_state(self):
        job = self.create({"scene_id": "generic-after-delete"})

        class GenericAdapter:
            def run(self, snapshot):
                self.store.tombstone_project(snapshot["project_id"], now=NOW)
                raise RuntimeError("provider failed after delete")

            def __init__(self, store):
                self.store = store

        result = self.store.execute(job["job_id"], "worker-a", GenericAdapter(self.store))

        self.assertEqual(result["status"], "cancelled")
        self.assertIsNone(result["result"])
        self.assertEqual(self.store.get(job["job_id"])["status"], "cancelled")

    def test_execute_persists_adapter_result_and_safe_failure(self):
        job = self.create()
        adapter = FixtureAdapter()
        succeeded = self.store.execute(job["job_id"], "worker-a", adapter)
        self.assertEqual(succeeded["status"], "succeeded")
        self.assertEqual(len(adapter.calls), 1)
        self.assertEqual(adapter.calls[0]["idempotency_key"], job["idempotency_key"])

        failed_job = self.store.create("project-2", "final_composite", {"scene_ids": ["scene-1"]})
        failed = self.store.execute(failed_job["job_id"], "worker-a", FixtureAdapter(failure=RuntimeError("no ffmpeg here")))
        self.assertEqual(failed["status"], "failed")
        self.assertEqual(failed["error"]["code"], "RuntimeError")

    def test_persisted_document_is_json_serializable_and_reloads(self):
        job = self.create({"nested": {"한글": True}, "values": [1, 2]})
        self.assertEqual(json.loads(self.path.read_text(encoding="utf-8"))["jobs"][job["job_id"]]["input"], job["input"])
        reloaded = JobStore(self.path)
        self.assertEqual(reloaded.get(job["job_id"]), job)

    def test_rejects_non_json_input_and_missing_terminal_payload(self):
        with self.assertRaises(JobValidationError):
            self.create({"bad": object()})
        job = self.create()
        self.store.claim(job["job_id"], "worker-a", now=NOW)
        with self.assertRaises(JobValidationError):
            self.store.transition(job["job_id"], "succeeded", now=NOW)


if __name__ == "__main__":
    unittest.main()
