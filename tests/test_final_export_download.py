import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "01_app"))

import render_server as server
from auth_store import AuthStore


class FinalExportDownloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.store = AuthStore(root / "auth.sqlite")
        self.owner = self.store.create_user("download-owner", "password-123")
        self.other = self.store.create_user("download-other", "password-123")
        self.project = self.store.create_project(self.owner["user_id"], "private export")
        self.token = self.store.create_session(self.owner["user_id"])
        self.other_token = self.store.create_session(self.other["user_id"])
        self.exports = root / "exports"
        self.exports.mkdir()
        (self.exports / "private video.mp4").write_bytes(b"0123456789")
        self.store.register_artifact(
            self.owner["user_id"], self.project["project_id"], None, None,
            "final_video", "/04_exports/private%20video.mp4", "checksum", {},
        )
        self.old_store, self.old_exports = server._auth_store, server.EXPORTS
        server._auth_store, server.EXPORTS = self.store, self.exports
        self.http = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.http.server_port}"

    def tearDown(self):
        self.http.shutdown(); self.http.server_close(); self.thread.join()
        server._auth_store, server.EXPORTS = self.old_store, self.old_exports
        self.temp.cleanup()

    def fetch(self, token=None, range_value=None, path="/04_exports/private%20video.mp4"):
        headers = {}
        if token:
            headers["Cookie"] = f"thinkcast_session={token}"
        if range_value:
            headers["Range"] = range_value
        return urlopen(Request(self.base + path, headers=headers), timeout=5)

    def status(self, token=None, path="/04_exports/private%20video.mp4"):
        try:
            with self.fetch(token, path=path) as response:
                return response.status
        except HTTPError as error:
            return error.code

    def test_login_ownership_range_and_path_guards(self):
        self.assertEqual(self.status(), 401)
        self.assertEqual(self.status(self.other_token), 404)
        with self.fetch(self.token) as response:
            self.assertEqual((response.status, response.read()), (200, b"0123456789"))
        with self.fetch(self.token, "bytes=2-5") as response:
            self.assertEqual(response.status, 206)
            self.assertEqual(response.headers["Content-Range"], "bytes 2-5/10")
            self.assertEqual(response.read(), b"2345")
        self.assertEqual(self.status(self.token, "/04_exports/%2e%2e/private%20video.mp4"), 404)
        self.assertEqual(self.status(self.token, "/04_exports/.render_work"), 404)


if __name__ == "__main__":
    unittest.main()
