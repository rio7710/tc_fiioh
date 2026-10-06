import importlib.util
import json
import random
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "01_app"
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))
SPEC = importlib.util.spec_from_file_location("random_api_server", APP / "render_server.py")
SERVER = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = SERVER
SPEC.loader.exec_module(SERVER)


class RandomApiE2ETests(unittest.TestCase):
    SEED = 20261006
    USER_COUNT = 6
    ACTION_COUNT = 120

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.auth = SERVER.AuthStore(root / "e2e.sqlite")
        self.users = []
        for index in range(self.USER_COUNT):
            self.users.append(self.auth.create_user(f"e2e-user-{index}", "password-123"))
        self.original_store = SERVER._auth_store
        self.original_exports = SERVER.EXPORTS
        SERVER._auth_store = self.auth
        SERVER.EXPORTS = root / "exports"
        SERVER.EXPORTS.mkdir(parents=True)
        self.http = ThreadingHTTPServer(("127.0.0.1", 0), SERVER.Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.http.server_port}"
        self.tokens = {}
        self.projects = {user["user_id"]: set() for user in self.users}
        self._login_all()

        self.shared_file = SERVER.EXPORTS / "shared-e2e.mp4"
        self.shared_file.write_bytes(b"shared-e2e")
        self.shared_projects = []
        for index in (0, 1):
            project = self.create_project(index, "shared")
            self.shared_projects.append((self.users[index]["user_id"], project["project_id"]))
            self.auth.register_artifact(
                self.users[index]["user_id"], project["project_id"], None, None,
                "final_video", "/04_exports/shared-e2e.mp4", "shared", {},
            )

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        SERVER._auth_store = self.original_store
        SERVER.EXPORTS = self.original_exports
        self.temp.cleanup()

    def request(self, actor, method, path, payload=None):
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = Request(
            self.base + path, data=body, method=method,
            headers={"Cookie": f"thinkcast_session={self.tokens[actor]}", "Content-Type": "application/json"},
        )
        try:
            with urlopen(request, timeout=5) as response:
                set_cookie = response.headers.get("Set-Cookie", "")
                if "thinkcast_session=" in set_cookie:
                    self.tokens[actor] = set_cookie.split("thinkcast_session=", 1)[1].split(";", 1)[0]
                return response.status, json.load(response)
        except HTTPError as exc:
            try:
                payload = json.load(exc)
            except Exception:
                payload = {}
            return exc.code, payload

    def _login_all(self):
        for index in range(self.USER_COUNT):
            status, result = self.request_without_session(
                "POST", "/api/login", {"username": f"e2e-user-{index}", "password": "password-123"}
            )
            self.assertEqual(200, status, result)
            self.tokens[index] = result["state"]["user"]["id"]
            # Login cookies are returned by the HTTP response; request_without_session stores them.
            self.tokens[index] = self.login_cookies[index]

    def request_without_session(self, method, path, payload=None):
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = Request(self.base + path, data=body, method=method, headers={"Content-Type": "application/json"})
        self.login_cookies = getattr(self, "login_cookies", {})
        try:
            with urlopen(request, timeout=5) as response:
                cookie = response.headers.get("Set-Cookie", "")
                if "thinkcast_session=" in cookie:
                    self.login_cookies[len(self.login_cookies)] = cookie.split("thinkcast_session=", 1)[1].split(";", 1)[0]
                return response.status, json.load(response)
        except HTTPError as exc:
            return exc.code, json.load(exc)

    def create_project(self, actor, label):
        status, result = self.request(actor, "POST", "/api/projects", {"name": f"{label}-{actor}-{self.SEED}"})
        self.assertEqual(201, status, result)
        project_id = result["project"]["project_id"]
        self.projects[self.users[actor]["user_id"]].add(project_id)
        return result["project"]

    def assert_invariants(self):
        with self.auth._connect() as db:
            self.assertEqual([], db.execute("PRAGMA foreign_key_check").fetchall())
            self.assertEqual([], db.execute(
                "SELECT p.project_id FROM projects p LEFT JOIN users u ON u.user_id=p.owner_user_id WHERE u.user_id IS NULL"
            ).fetchall())
            self.assertEqual([], db.execute(
                "SELECT a.artifact_id FROM artifacts a LEFT JOIN projects p ON p.project_id=a.project_id WHERE p.project_id IS NULL"
            ).fetchall())
            self.assertEqual([], db.execute(
                "SELECT user_id FROM user_render_settings WHERE user_id NOT IN (SELECT user_id FROM users)"
            ).fetchall())
            actual = {user_id: set() for user_id in self.projects}
            for row in db.execute("SELECT owner_user_id, project_id FROM projects"):
                actual.setdefault(row["owner_user_id"], set()).add(row["project_id"])
            self.assertEqual(actual, self.projects)
        self.assertTrue(self.shared_file.exists(), "shared file was deleted too early")

    def test_seeded_multi_user_api_lifecycle(self):
        rng = random.Random(self.SEED)
        actions = 0
        for step in range(self.ACTION_COUNT):
            actor = rng.randrange(self.USER_COUNT)
            action = rng.choice(("login", "create", "list", "settings", "cross_get", "cross_delete", "delete", "reconnect"))
            try:
                owner_id = self.users[actor]["user_id"]
                if action in {"login", "reconnect"}:
                    status, result = self.request_without_session(
                        "POST", "/api/login", {"username": f"e2e-user-{actor}", "password": "password-123"}
                    )
                    self.assertEqual(200, status, result)
                    self.tokens[actor] = self.login_cookies[len(self.login_cookies) - 1]
                elif action == "create":
                    self.create_project(actor, "random")
                elif action == "list":
                    status, result = self.request(actor, "GET", "/api/projects")
                    self.assertEqual(200, status, result)
                    self.assertEqual(self.projects[owner_id], {item["project_id"] for item in result["projects"]})
                elif action == "settings":
                    status, _ = self.request(actor, "POST", "/api/render-settings", {
                        "schema_version": "render-settings.v1",
                        "overrides": {"music": rng.choice(["none", "satie"]), "volume": 0.25},
                    })
                    self.assertEqual(200, status)
                    status, result = self.request(actor, "GET", "/api/render-settings")
                    self.assertEqual(200, status, result)
                    self.assertEqual(owner_id, self.auth.session_user(self.tokens[actor])["user_id"])
                    self.assertEqual(0.25, result["effective"]["volume"])
                elif action in {"cross_get", "cross_delete"}:
                    targets = [project for user_id, ids in self.projects.items() if user_id != owner_id for project in ids]
                    if targets:
                        target = rng.choice(targets)
                        if action == "cross_get":
                            status, _ = self.request(actor, "GET", f"/api/usage?project_id={target}")
                        else:
                            status, _ = self.request(actor, "POST", "/api/project/delete", {"project_id": target})
                        self.assertEqual(404, status)
                elif action == "delete":
                    candidates = self.projects[owner_id] - {project_id for _, project_id in self.shared_projects}
                    if candidates:
                        target = rng.choice(sorted(candidates))
                        status, _ = self.request(actor, "POST", "/api/project/delete", {"project_id": target})
                        self.assertEqual(200, status)
                        self.projects[owner_id].remove(target)
                actions += 1
                self.assert_invariants()
            except Exception as exc:
                raise AssertionError(f"seed={self.SEED} step={step} action={action} actions={actions}: {exc}") from exc

        owner, first = self.shared_projects[0]
        status, _ = self.request(next(index for index, user in enumerate(self.users) if user["user_id"] == owner), "POST", "/api/project/delete", {"project_id": first})
        self.assertEqual(200, status)
        self.projects[owner].remove(first)
        self.assertTrue(self.shared_file.exists())
        other_owner, second = self.shared_projects[1]
        actor = next(index for index, user in enumerate(self.users) if user["user_id"] == other_owner)
        status, _ = self.request(actor, "POST", "/api/project/delete", {"project_id": second})
        self.assertEqual(200, status)
        self.projects[other_owner].remove(second)
        self.assertFalse(self.shared_file.exists())
        self.assertGreaterEqual(actions, 100)


if __name__ == "__main__":
    unittest.main()
