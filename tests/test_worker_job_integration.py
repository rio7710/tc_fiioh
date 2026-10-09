import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "01_app"))

from auth_store import AuthStore
from automation_runner import AdapterFailure, AutomationRunner, _FinalExportAdapter, _render_settings
from automation_store import AutomationStore
from worker_core import ConfigurationError, JobStore, WorkerRuntimeSettings
from worker import create_job_store


NOW = "2026-10-06T00:00:00+00:00"


def config():
    return {
        "schema_version": "1.0.0",
        "endpoint": "5",
        "repeat": {"unit": "month", "interval": 1},
        "keywords": {"count": 2, "ai": False, "month": ""},
        "video": {"scene_count": 0, "crop": "default"},
        "brand": {"intro": False, "outro": False, "watermark": False},
        "channels": ["youtube", "instagram"],
    }


class FixtureAPI:
    calls = []

    def __init__(self, auth, user):
        self.auth, self.user = auth, user

    def close(self):
        pass

    def call(self, path, payload):
        self.calls.append((path, payload))
        project = payload.get("project_id") if payload else None
        if path == "/api/script/generate":
            self.auth.save_stage_draft(
                self.user,
                project,
                3,
                {
                    "document": {
                        "production": {
                            "narration_cues": [{"id": "cue-a"}, {"id": "cue-b"}],
                            "timeline": {
                                "scenes": [
                                    {"id": "scene-a", "narration_cue_ids": ["cue-a"]},
                                    {"id": "scene-b", "narration_cue_ids": ["cue-b"]},
                                ]
                            },
                        }
                    }
                },
            )
        if path == "/api/season-keywords/preview":
            return {"ok": True, "keywords": [{"id": "1", "label": "첫 키워드"}, {"id": "2", "label": "둘째 키워드"}]}
        if path == "/render":
            return {"ok": True, "job_id": payload["job_id"], "outputs": [{"url": "memory://final.mp4"}]}
        return {"ok": True}


class WorkerJobIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.auth = AuthStore(self.root / "test.sqlite")
        self.user = self.auth.create_user("worker_integration", "strong-test-password")["user_id"]
        self.store = AutomationStore(self.auth)
        self.store.configure(
            self.user,
            "start",
            {"action": "start", "request_id": "integration-request", "version": 0, "config": config()},
            NOW,
        )
        self.store.enqueue_due(NOW)
        self.run = self.store.claim("integration-worker", NOW)
        FixtureAPI.calls = []

    def tearDown(self):
        self.temp.cleanup()

    def test_runtime_settings_keep_defaults_and_reject_unsafe_environment(self):
        defaults = WorkerRuntimeSettings.from_env({})
        self.assertEqual(defaults.api_timeout_seconds, 7200.0)
        self.assertEqual(defaults.api_retry_count, 3)
        tuned = WorkerRuntimeSettings.from_env({
            "WORKER_IDLE_POLL_SECONDS": "1.5",
            "AUTOMATION_API_RETRY_COUNT": "4",
            "AUTOMATION_IMAGE_MODEL": "fixture-image-model",
            "AUTOMATION_RENDER_VOLUME": "0.25",
        })
        self.assertEqual(tuned.idle_poll_seconds, 1.5)
        self.assertEqual(tuned.api_retry_count, 4)
        self.assertEqual(tuned.image_model, "fixture-image-model")
        self.assertEqual(tuned.render_volume, 0.25)
        for env in ({"AUTOMATION_API_TIMEOUT_SECONDS": "nope"}, {"AUTOMATION_RENDER_PAN_X": "nan"}, {"WORKER_JOB_LEASE_SECONDS": "0"}):
            with self.assertRaises(ConfigurationError):
                WorkerRuntimeSettings.from_env(env)

    def test_deployment_examples_list_all_runtime_settings(self):
        names = (
            "WORKER_HEARTBEAT_INTERVAL_SECONDS", "WORKER_IDLE_POLL_SECONDS",
            "AUTOMATION_API_TIMEOUT_SECONDS", "AUTOMATION_API_RETRY_COUNT",
            "AUTOMATION_API_RETRY_BACKOFF_SECONDS", "AUTOMATION_HEARTBEAT_INTERVAL_SECONDS",
            "AUTOMATION_I2V_POLL_INTERVAL_SECONDS", "AUTOMATION_I2V_TIMEOUT_SECONDS",
            "WORKER_JOB_LEASE_SECONDS", "AUTOMATION_RENDER_TYPE", "AUTOMATION_RENDER_MUSIC",
            "AUTOMATION_RENDER_VOLUME", "AUTOMATION_RENDER_PAN_X",
        )
        dotenv = (ROOT / ".env.example").read_text(encoding="utf-8")
        dockerfile = (ROOT / "Dockerfile.worker").read_text(encoding="utf-8")
        for name in names:
            self.assertIn(name, dotenv)
            self.assertIn(name, dockerfile)

    def test_invalid_render_config_uses_safe_environment_fallback(self):
        settings = WorkerRuntimeSettings.from_env({
            "AUTOMATION_RENDER_TYPE": "env-type",
            "AUTOMATION_RENDER_MUSIC": "env-music",
            "AUTOMATION_RENDER_VOLUME": "0.1",
            "AUTOMATION_RENDER_PAN_X": "0.1",
        })
        self.assertEqual(
            _render_settings({"render": {"type": "", "music": None, "volume": "bad", "pan_x": 2}}, settings),
            ("env-type", "env-music", 0.1, 0.1),
        )

    def test_render_config_overrides_environment_fallback(self):
        job_store = JobStore(self.root / "worker_jobs.json")
        self.run["config"]["render"] = {"type": "social", "music": "custom", "volume": 0.25, "pan_x": 0.75}
        settings = WorkerRuntimeSettings.from_env({
            "AUTOMATION_RENDER_TYPE": "env-type",
            "AUTOMATION_RENDER_MUSIC": "env-music",
            "AUTOMATION_RENDER_VOLUME": "0.1",
            "AUTOMATION_RENDER_PAN_X": "0.1",
        })

        AutomationRunner(self.store, FixtureAPI, job_store=job_store, worker_id="fixture-worker", settings=settings).execute(self.run)

        render = next(payload for path, payload in FixtureAPI.calls if path == "/render")
        self.assertEqual(render["type"], "social")
        self.assertEqual(render["music"], "custom")
        self.assertEqual(render["volume"], 0.25)
        self.assertEqual(render["video_pan_x"], 0.75)

    def test_image_model_uses_settings_single_environment_path(self):
        job_store = JobStore(self.root / "worker_jobs.json")
        settings = WorkerRuntimeSettings.from_env({"AUTOMATION_IMAGE_MODEL": "fixture-image-model"})
        AutomationRunner(self.store, FixtureAPI, job_store=job_store, worker_id="fixture-worker", settings=settings).execute(self.run)

        image_calls = [payload for path, payload in FixtureAPI.calls if path == "/api/storyboard/image-generate"]
        self.assertTrue(image_calls)
        self.assertTrue(all(payload["model"] == "fixture-image-model" for payload in image_calls))

    def test_scene_and_final_export_dispatch_through_job_store_without_provider_calls(self):
        job_store = JobStore(self.root / "worker_jobs.json")
        runner = AutomationRunner(self.store, FixtureAPI, job_store=job_store, worker_id="fixture-worker")

        runner.execute(self.run)

        self.assertEqual(self.store.snapshot(self.user)["runs"][0]["status"], "succeeded")
        scene_jobs = job_store.list(status="succeeded")
        self.assertEqual(sorted(job["stage"] for job in scene_jobs), ["final_composite", "scene_image", "scene_image"])
        render_calls = [payload for path, payload in FixtureAPI.calls if path == "/render"]
        self.assertEqual(len(render_calls), 1)
        self.assertEqual(render_calls[0]["platforms"], ["youtube", "instagram"])
        self.assertEqual(render_calls[0]["job_id"], "automation-" + self.run["run_id"])
        self.assertFalse(any(path.startswith("ffmpeg") for path, _ in FixtureAPI.calls))

    def test_same_scene_dispatch_reuses_succeeded_job_and_does_not_call_adapter_again(self):
        job_store = JobStore(self.root / "worker_jobs.json")
        calls = []

        class FixtureAdapter:
            def run(self, job):
                calls.append(job["idempotency_key"])
                return {"artifact_uri": "memory://scene-a"}

        first = job_store.dispatch("project-1", "scene_image", {"scene_id": "scene-a"}, FixtureAdapter(), worker_id="w1")
        second = job_store.dispatch("project-1", "scene_image", {"scene_id": "scene-a"}, FixtureAdapter(), worker_id="w2")

        self.assertEqual(first["job_id"], second["job_id"])
        self.assertEqual(first["input_hash"], second["input_hash"])
        self.assertEqual(calls, [first["idempotency_key"]])

    def test_final_export_recovers_dropped_response_without_duplicate_submit(self):
        submits = []
        statuses = [
            {"ok": True},
            {"ok": True, "status": "running"},
            {"ok": True, "status": "succeeded", "response": {"ok": True, "url": "memory://final.mp4"}},
        ]

        def submit():
            submits.append("render")
            raise AdapterFailure("connection dropped")

        adapter = _FinalExportAdapter(
            submit, lambda: statuses.pop(0), poll_interval_seconds=0.001, recovery_timeout_seconds=1,
        )
        job = {"attempt": 1}

        self.assertEqual(adapter.run(job)["value"]["url"], "memory://final.mp4")
        self.assertEqual(submits, ["render"])

    def test_final_export_retry_never_resubmits_when_status_is_missing(self):
        submits = []
        adapter = _FinalExportAdapter(
            lambda: submits.append("render"), lambda: {"ok": True},
            poll_interval_seconds=0.001, recovery_timeout_seconds=0.001,
        )

        with self.assertRaises(AdapterFailure):
            adapter.run({"attempt": 2})
        self.assertEqual(submits, [])

    def test_worker_startup_recovers_expired_job_to_stale(self):
        path = self.root / "worker_jobs.json"
        jobs = JobStore(path)
        job = jobs.create("project-1", "final_composite", {"render_job_id": "render-1"}, now=NOW)
        jobs.claim(job["job_id"], "dead-worker", now=NOW, lease_seconds=10)

        recovered_store = create_job_store(path)

        recovered = recovered_store.get(job["job_id"])
        self.assertEqual(recovered["status"], "stale")
        self.assertEqual(recovered["error"]["code"], "lease_expired")

    def test_cancellation_during_provider_call_finishes_job_and_run_as_cancelled(self):
        job_store = JobStore(self.root / "worker_jobs.json")
        automation_store = self.store

        class CancellingAPI(FixtureAPI):
            def call(self, path, payload):
                if path == "/api/storyboard/image-generate":
                    automation_store.configure(
                        self.user,
                        "cancel",
                        {"action": "cancel", "request_id": "late-cancel-request", "version": 0, "run_id": self.run_id},
                        NOW,
                    )
                return super().call(path, payload)

        def factory(auth, user):
            api = CancellingAPI(auth, user)
            api.run_id = self.run["run_id"]
            api.user = self.user
            return api

        AutomationRunner(self.store, factory, job_store=job_store, worker_id="fixture-worker").execute(self.run)

        self.assertEqual(job_store.list(status="cancelled")[0]["error"]["code"], "cancelled")
        self.assertEqual(self.store.snapshot(self.user)["runs"][0]["status"], "cancelled")

    def test_project_delete_during_provider_call_tombstones_job(self):
        job_store = JobStore(self.root / "worker_jobs.json")
        auth = self.auth

        class DeletingAPI(FixtureAPI):
            def call(self, path, payload):
                if path == "/api/storyboard/image-generate":
                    auth.delete_project(self.user, self.run_id)
                return super().call(path, payload)

        def factory(auth_store, user):
            api = DeletingAPI(auth_store, user)
            api.run_id = self.run["project_id"]
            return api

        AutomationRunner(self.store, factory, job_store=job_store, worker_id="fixture-worker").execute(self.run)

        self.assertTrue(job_store.is_project_tombstoned(self.run["project_id"]))
        self.assertEqual(job_store.list(status="cancelled")[0]["error"]["code"], "project_deleted")

    def test_provider_failure_is_safe_and_persisted_as_failed_job(self):
        job_store = JobStore(self.root / "worker_jobs.json")

        class FailingAPI(FixtureAPI):
            def call(self, path, payload):
                if path == "/api/storyboard/image-generate":
                    raise RuntimeError("local secret path /private/provider-token")
                return super().call(path, payload)

        runner = AutomationRunner(self.store, FailingAPI, job_store=job_store, worker_id="fixture-worker")
        runner.execute(self.run)

        failed = job_store.list(status="failed")
        self.assertTrue(failed)
        self.assertEqual(failed[0]["error"]["message"], "작업 실행을 완료하지 못했습니다. 결과를 확인한 뒤 다시 시도해 주세요.")
        run = self.store.snapshot(self.user)["runs"][0]
        self.assertNotIn("private/provider-token", run["error_message"] or "")


if __name__ == "__main__":
    unittest.main()
