import json
import random
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "01_app"))

from auth_store import AuthStore
from automation_store import AutomationStore
from worker_core import JobConflict, JobStore


SEED = 0xD3E1E
BASE_TIME = datetime(2026, 10, 6, tzinfo=timezone.utc)


def stamp(step):
    return (BASE_TIME + timedelta(seconds=step)).isoformat()


def automation_config():
    return {
        "schema_version": "1.0.0",
        "endpoint": "2",
        "repeat": {"unit": "day", "interval": 1},
        "keywords": {"count": 1, "ai": False, "month": ""},
        "video": {"scene_count": 0, "crop": "default"},
        "brand": {"intro": False, "outro": False, "watermark": False},
        "channels": ["youtube"],
    }


class _LateAdapter:
    def __init__(self, store, mode):
        self.store = store
        self.mode = mode

    def run(self, job):
        self.store.tombstone_project(job["project_id"], now=stamp(9000))
        if self.mode == "error":
            raise RuntimeError("provider completed after deletion")
        return {"artifact_uri": "memory://must-not-persist"}


class RandomWorkerE2ETests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.jobs = JobStore(Path(self.temp.name) / "jobs.json")
        self.auth = AuthStore(Path(self.temp.name) / "auth.sqlite")
        self.automation = AutomationStore(self.auth)
        self.users = [
            self.auth.create_user(f"random-{index}", "strong-test-password")["user_id"]
            for index in range(4)
        ]

    def tearDown(self):
        self.temp.cleanup()

    def _terminal_fingerprint(self, job):
        return (
            job["status"],
            job["attempt"],
            json.dumps(job["result"], sort_keys=True),
            json.dumps(job["error"], sort_keys=True),
            job.get("worker_id"),
        )

    def _assert_job_invariants(self, terminal):
        jobs = self.jobs.list()
        self.assertEqual(len({job["job_id"] for job in jobs}), len(jobs))
        keys = [job["idempotency_key"] for job in jobs]
        self.assertEqual(len(keys), len(set(keys)))
        for job in jobs:
            self.assertIn(job["status"], {"queued", "running", "succeeded", "failed", "cancelled", "stale"})
            if job["status"] in {"succeeded", "cancelled"}:
                self.assertEqual(self._terminal_fingerprint(job), terminal[job["job_id"]])
            if job["status"] == "running":
                self.assertTrue(job["worker_id"])
                self.assertTrue(job["lease_expires_at"])
            if job["status"] in {"succeeded", "cancelled", "stale"}:
                self.assertIsNone(job["lease_expires_at"])

    def test_seeded_job_state_machine_runs_1250_steps(self):
        rng = random.Random(SEED)
        projects = [f"user-{user}-project-{index}" for user in range(4) for index in range(3)]
        known = []
        terminal = {}

        for step in range(1250):
            action = rng.choice(("create", "create", "claim", "expire", "retry", "cancel", "tombstone", "late"))
            project = rng.choice(projects)
            stage = rng.choice(("scene_image", "final_composite", "narration"))
            payload = {"scene": rng.randrange(5), "variant": rng.randrange(3)}
            candidates = self.jobs.list()
            try:
                if action == "create":
                    try:
                        first = self.jobs.create(project, stage, payload, now=stamp(step))
                    except JobConflict:
                        self.assertTrue(self.jobs.is_project_tombstoned(project))
                    else:
                        duplicate = self.jobs.create(project, stage, dict(reversed(list(payload.items()))), now=stamp(step))
                        self.assertEqual(first["job_id"], duplicate["job_id"])
                        if first["job_id"] not in known:
                            known.append(first["job_id"])
                elif not candidates:
                    continue
                else:
                    job = rng.choice(candidates)
                    job_id = job["job_id"]
                    if action == "claim":
                        try:
                            claimed = self.jobs.claim(job_id, f"worker-{rng.randrange(4)}", now=stamp(step), lease_seconds=5)
                            self.assertEqual(claimed["status"], "running")
                        except JobConflict:
                            self.assertNotEqual(job["status"], "queued")
                    elif action == "expire":
                        if job["status"] == "running":
                            recovered = self.jobs.recover_stale(now=stamp(step + 10))
                            self.assertTrue(any(item["job_id"] == job_id for item in recovered))
                    elif action == "retry":
                        if job["status"] in {"failed", "stale"}:
                            retried = self.jobs.retry(job_id, now=stamp(step))
                            self.assertEqual(retried["status"], "queued")
                            self.assertEqual(retried["attempt"], job["attempt"] + 1)
                        else:
                            with self.assertRaises(JobConflict):
                                self.jobs.retry(job_id, now=stamp(step))
                    elif action == "cancel":
                        if job["status"] in {"queued", "running"}:
                            self.jobs.transition(job_id, "cancelled", now=stamp(step))
                        else:
                            with self.assertRaises(JobConflict):
                                self.jobs.transition(job_id, "cancelled", now=stamp(step))
                    elif action == "tombstone":
                        self.jobs.tombstone_project(project, now=stamp(step))
                    elif action == "late" and job["status"] == "queued":
                        result = self.jobs.execute(job_id, "late-worker", _LateAdapter(self.jobs, rng.choice(("success", "error"))))
                        self.assertEqual(result["status"], "cancelled")
            except Exception as exc:
                self.fail(f"seed={SEED} step={step} action={action} project={project} job={job_id if candidates else None}: {exc}")

            for item in self.jobs.list():
                if item["status"] in {"succeeded", "cancelled"} and item["job_id"] not in terminal:
                    terminal[item["job_id"]] = self._terminal_fingerprint(item)
            self._assert_job_invariants(terminal)

        for job in self.jobs.list():
            if job["status"] in {"succeeded", "cancelled"}:
                with self.assertRaises(JobConflict):
                    self.jobs.retry(job["job_id"])

    def test_seeded_automation_state_machine_checks_owners_and_terminals(self):
        rng = random.Random(SEED ^ 0xA11CE)
        terminal = {}
        run_ids = []
        step = 0

        for cycle in range(260):
            user = self.users[rng.randrange(len(self.users))]
            settings = self.automation.snapshot(user)["settings"]
            version = settings["version"] if settings else 0
            request_id = f"random-start-{cycle:04d}"
            payload = {"action": "start", "request_id": request_id, "version": version, "config": automation_config()}
            try:
                self.automation.configure(user, "start", payload, now=stamp(step))
            except Exception:
                pass
            self.automation.enqueue_due(stamp(step + 1))
            run = self.automation.claim(f"owner-{cycle % 4}", stamp(step + 2))
            if run:
                run_ids.append(run["run_id"])
                choice = rng.choice(("heartbeat", "wrong-heartbeat", "cancel", "finish", "expire"))
                if choice == "heartbeat":
                    self.assertTrue(self.automation.heartbeat(run["run_id"], run["lease_owner"]))
                elif choice == "wrong-heartbeat":
                    self.assertFalse(self.automation.heartbeat(run["run_id"], "not-the-owner"))
                    self.assertTrue(self.automation.check_active(run))
                elif choice == "cancel":
                    current = self.automation.snapshot(user)
                    self.automation.configure(user, "cancel", {"action": "cancel", "request_id": f"cancel-{cycle}", "version": current["settings"]["version"], "run_id": run["run_id"]}, now=stamp(step + 3))
                    self.automation.finish(run, "succeeded")
                elif choice == "expire":
                    with sqlite3.connect(self.auth.path) as db:
                        db.execute("UPDATE automation_runs SET lease_until=? WHERE run_id=?", (stamp(step - 1), run["run_id"]))
                    self.assertIsNone(self.automation.claim(f"owner-expiry-{cycle}", stamp(step + 4)))
                else:
                    self.automation.finish(run, rng.choice(("succeeded", "failed")), "random_failure" if rng.random() < 0.3 else None, "safe failure" if rng.random() < 0.3 else None)

            with sqlite3.connect(self.auth.path) as db:
                rows = db.execute("SELECT run_id,status,attempt,lease_owner,lease_until,cancel_requested FROM automation_runs").fetchall()
            for run_id, status, attempt, owner, lease_until, cancel_requested in rows:
                if status in {"succeeded", "cancelled"}:
                    current = (status, attempt, owner, lease_until, cancel_requested)
                    if run_id in terminal:
                        self.assertEqual(current, terminal[run_id], f"seed={SEED ^ 0xA11CE} cycle={cycle}")
                    terminal[run_id] = current
            step += 5


if __name__ == "__main__":
    unittest.main()
