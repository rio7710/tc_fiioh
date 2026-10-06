import importlib.util
import json
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "01_app"
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))
SPEC = importlib.util.spec_from_file_location("delete_server", APP / "render_server.py")
SERVER = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = SERVER
SPEC.loader.exec_module(SERVER)

from automation_store import AutomationStore


class ProjectDeleteIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.auth = SERVER.AuthStore(root / "delete.sqlite")
        self.user = self.auth.create_user("delete-owner", "password-123")
        self.other = self.auth.create_user("delete-other", "password-123")
        self.project = self.auth.create_project(self.user["user_id"], "삭제 대상")
        self.other_project = self.auth.create_project(self.other["user_id"], "보존 대상")
        self.revision = self.auth.save_stage_draft(
            self.user["user_id"], self.project["project_id"], 3, {"document": {}}
        )
        self.other_revision = self.auth.save_stage_draft(
            self.other["user_id"], self.other_project["project_id"], 3, {"document": {}}
        )
        self.paths = {
            "images": root / "images",
            "voice": root / "voice",
            "kling": root / "kling",
            "exports": root / "exports",
            "jobs": root / "project_kling_jobs.json",
        }
        for path in self.paths.values():
            if path.suffix == ".json":
                continue
            path.mkdir(parents=True, exist_ok=True)
        self.patches = [
            ("STORYBOARD_IMAGE_DIR", self.paths["images"]),
            ("VOICE_ARTIFACT_DIR", self.paths["voice"]),
            ("KLING_ARTIFACT_DIR", self.paths["kling"]),
            ("EXPORTS", self.paths["exports"]),
            ("PROJECT_KLING_JOBS_FILE", self.paths["jobs"]),
        ]
        self.originals = {name: getattr(SERVER, name) for name, _ in self.patches}
        for name, value in self.patches:
            setattr(SERVER, name, value)
        self.token = self.auth.create_session(self.user["user_id"])
        SERVER._auth_store = self.auth
        SERVER.render_jobs.clear()

    def tearDown(self):
        SERVER.render_jobs.clear()
        SERVER._auth_store = None
        for name, value in self.originals.items():
            setattr(SERVER, name, value)
        self.temp.cleanup()

    def request_delete(self, token, project_id):
        request = Request(
            "http://127.0.0.1:%d/api/project/delete" % self.http.server_port,
            data=json.dumps({"project_id": project_id}).encode(),
            method="POST",
            headers={"Cookie": f"thinkcast_session={token}", "Content-Type": "application/json"},
        )
        with urlopen(request, timeout=5) as response:
            return response.status, json.load(response)

    def test_delete_removes_owned_rows_files_jobs_and_keeps_shared_or_foreign_files(self):
        project_id = self.project["project_id"]
        revision_id = self.revision["revision_id"]
        image = self.paths["images"] / project_id / revision_id / "scene-1" / "image.webp"
        voice = self.paths["voice"] / project_id / revision_id / "warm_female" / "voice.wav"
        private_export = self.paths["exports"] / "private.mp4"
        shared_export = self.paths["exports"] / "shared.mp4"
        for path in (image, voice, private_export, shared_export):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"owned-file")
        image_uri = f"/api/storyboard/image?project_id={project_id}&revision_id={revision_id}&scene_id=scene-1&file=image.webp"
        voice_uri = f"/api/voice/audio?project_id={project_id}&revision_id={revision_id}&profile=warm_female&file=voice.wav"
        self.auth.register_artifact(self.user["user_id"], project_id, revision_id, "scene-1", "scene_image_candidate", image_uri, "image", {})
        self.auth.register_artifact(self.user["user_id"], project_id, revision_id, "scene-1", "narration_wav", voice_uri, "voice", {})
        self.auth.register_artifact(self.user["user_id"], project_id, revision_id, None, "final_video", "/04_exports/private.mp4", "private", {})
        self.auth.register_artifact(self.user["user_id"], project_id, revision_id, None, "final_video", "/04_exports/shared.mp4", "shared", {})
        self.auth.register_artifact(self.other["user_id"], self.other_project["project_id"], self.other_revision["revision_id"], None, "final_video", "/04_exports/shared.mp4", "shared", {})
        AutomationStore(self.auth)
        with self.auth._connect() as db:
            db.execute(
                "INSERT INTO automation_runs(run_id,user_id,settings_version,scheduled_for,project_id,config_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
                ("run-delete", self.user["user_id"], 1, "2026-10-06T00:00:00+00:00", project_id, "{}", "queued", "now", "now"),
            )
            db.commit()
        self.paths["jobs"].write_text(json.dumps({"task-delete": {"project_id": project_id}, "task-keep": {"project_id": "other"}}), encoding="utf-8")
        SERVER.render_jobs["render-delete"] = {"project_id": project_id, "status": "queued"}
        self.http = ThreadingHTTPServer(("127.0.0.1", 0), SERVER.Handler)
        thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        thread.start()
        try:
            status, result = self.request_delete(self.token, project_id)
        finally:
            self.http.shutdown()
            self.http.server_close()
            thread.join()
        self.assertEqual(200, status)
        self.assertTrue(result["ok"])
        self.assertFalse(image.exists())
        self.assertFalse(voice.exists())
        self.assertFalse(private_export.exists())
        self.assertTrue(shared_export.exists())
        self.assertIsNone(self.auth.get_project(self.user["user_id"], project_id))
        self.assertIsNotNone(self.auth.get_project(self.other["user_id"], self.other_project["project_id"]))
        with self.auth._connect() as db:
            self.assertIsNone(db.execute("SELECT 1 FROM automation_runs WHERE run_id='run-delete'").fetchone())
        self.assertNotIn("render-delete", SERVER.render_jobs)
        self.assertEqual({"task-keep": {"project_id": "other"}}, json.loads(self.paths["jobs"].read_text(encoding="utf-8")))
        SERVER.save_project_kling_job("task-delete", {"status": "succeeded", "updated_at": "late"})
        self.assertNotIn("task-delete", json.loads(self.paths["jobs"].read_text(encoding="utf-8")))

    def test_foreign_delete_is_rejected_without_touching_file(self):
        project_id = self.project["project_id"]
        protected = self.paths["exports"] / "protected.mp4"
        protected.write_bytes(b"protected")
        revision_id = self.revision["revision_id"]
        self.auth.register_artifact(self.user["user_id"], project_id, revision_id, None, "final_video", "/04_exports/protected.mp4", "protected", {})
        self.http = ThreadingHTTPServer(("127.0.0.1", 0), SERVER.Handler)
        thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        thread.start()
        try:
            with self.assertRaises(Exception) as raised:
                self.request_delete(self.auth.create_session(self.other["user_id"]), project_id)
            self.assertIn("404", str(raised.exception))
        finally:
            self.http.shutdown()
            self.http.server_close()
            thread.join()
        self.assertTrue(protected.exists())
        self.assertIsNotNone(self.auth.get_project(self.user["user_id"], project_id))

    def test_kling_job_update_waits_for_delete_lock_and_cannot_resurrect_deleted_project(self):
        project_id = self.project["project_id"]
        AutomationStore(self.auth)
        self.paths["jobs"].write_text(json.dumps({"task-delete": {"project_id": project_id}}), encoding="utf-8")
        entered = threading.Event()
        release = threading.Event()

        def delete_sequence():
            with SERVER.project_kling_job_lock:
                SERVER.stage_project_kling_jobs(project_id)
                entered.set()
                release.wait(timeout=5)
                self.auth.delete_project(self.user["user_id"], project_id)

        deletion = threading.Thread(target=delete_sequence)
        deletion.start()
        self.assertTrue(entered.wait(timeout=5))
        update = threading.Thread(target=SERVER.save_project_kling_job, args=("task-late", {
            "user_id": self.user["user_id"], "project_id": project_id, "status": "running",
        }))
        update.start()
        self.assertTrue(update.is_alive())
        release.set()
        deletion.join(timeout=5)
        update.join(timeout=5)
        self.assertFalse(update.is_alive())
        self.assertNotIn("task-late", json.loads(self.paths["jobs"].read_text(encoding="utf-8")))

    def test_delete_failure_restores_files_jobs_and_project_db(self):
        project_id = self.project["project_id"]
        revision_id = self.revision["revision_id"]
        export = self.paths["exports"] / "rollback.mp4"
        export.write_bytes(b"rollback-content")
        self.auth.register_artifact(
            self.user["user_id"], project_id, revision_id, None,
            "final_video", "/04_exports/rollback.mp4", "rollback", {},
        )
        original_jobs = json.dumps(
            {"task-delete": {"project_id": project_id}, "task-keep": {"project_id": "other"}},
            ensure_ascii=False, sort_keys=True,
        ).encode("utf-8")
        self.paths["jobs"].write_bytes(original_jobs)
        self.http = ThreadingHTTPServer(("127.0.0.1", 0), SERVER.Handler)
        thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        thread.start()
        try:
            with mock.patch.object(self.auth, "delete_project", side_effect=ValueError("db failure")):
                with self.assertRaises(HTTPError) as raised:
                    self.request_delete(self.token, project_id)
            self.assertIn(raised.exception.code, (400, 500))
        finally:
            self.http.shutdown()
            self.http.server_close()
            thread.join()
        self.assertEqual(b"rollback-content", export.read_bytes())
        self.assertEqual(original_jobs, self.paths["jobs"].read_bytes())
        self.assertIsNotNone(self.auth.get_project(self.user["user_id"], project_id))


if __name__ == "__main__":
    unittest.main()
