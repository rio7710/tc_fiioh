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


ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "01_app"
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

SPEC = importlib.util.spec_from_file_location("render_settings_server", APP / "render_server.py")
SERVER = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = SERVER
SPEC.loader.exec_module(SERVER)

from automation_store import validate_config


class RenderSettingsIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.auth = SERVER.AuthStore(Path(self.temp.name) / "render-settings.sqlite")
        self.user = self.auth.create_user("render-settings", "password-123")
        self.token = self.auth.create_session(self.user["user_id"])
        SERVER._auth_store = self.auth
        self.http = ThreadingHTTPServer(("127.0.0.1", 0), SERVER.Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.http.server_port}"

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        SERVER._auth_store = None
        self.temp.cleanup()

    def request(self, method="GET", payload=None):
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = Request(
            self.base + "/api/render-settings", data=body, method=method,
            headers={"Cookie": f"thinkcast_session={self.token}", "Content-Type": "application/json"},
        )
        try:
            with urlopen(request, timeout=5) as response:
                return response.status, json.load(response)
        except HTTPError as exc:
            return exc.code, json.load(exc)

    def test_catalog_aliases_and_defaults_are_loaded_from_json(self):
        catalog = SERVER.RENDER_CATALOG
        self.assertEqual(tuple(catalog["styles"]["editorial"]), SERVER.ASS_STYLES["editorial"])
        self.assertEqual(
            (catalog["platforms"]["youtube"]["width"], catalog["platforms"]["youtube"]["height"], "16x9"),
            SERVER.PLATFORM_FORMATS["youtube"],
        )
        self.assertEqual(catalog["defaults"]["music"], "satie")
        self.assertEqual(["youtube", "instagram", "naver"], catalog["defaults"]["platforms"])
        self.assertEqual(0.5, catalog["defaults"]["scene_dissolve_seconds"])
        self.assertEqual("preview-square", catalog["ratio_profiles"]["1x1"]["className"])
        self.assertEqual("9x16", catalog["platform_preview_formats"]["instagram"]["formatKey"])
        self.assertEqual("editorial", SERVER.resolve_render_settings(self.user["user_id"])["type"])

    def test_get_post_patch_are_authenticated_and_owner_scoped(self):
        status, result = self.request()
        self.assertEqual(200, status)
        self.assertIn("catalog", result)
        self.assertEqual({}, result["overrides"])
        status, result = self.request("POST", {
            "schema_version": "render-settings.v1",
            "overrides": {"music": "bach", "volume": 0.7, "caption_size": 2,
                           "platforms": ["youtube", "naver"], "scene_dissolve_seconds": 1.25},
        })
        self.assertEqual(200, status)
        self.assertEqual("bach", result["effective"]["music"])
        status, result = self.request("PATCH", {
            "schema_version": "render-settings.v1",
            "overrides": {"narration": False},
        })
        self.assertEqual(200, status)
        self.assertEqual({"music": "bach", "volume": 0.7, "caption_size": 2,
                          "platforms": ["youtube", "naver"], "scene_dissolve_seconds": 1.25,
                          "narration": False}, result["overrides"])
        self.assertEqual(["youtube", "naver"], result["effective"]["platforms"])
        self.assertEqual(1.25, result["effective"]["scene_dissolve_seconds"])
        self.assertEqual("bach", self.auth.get_render_settings(self.user["user_id"])["music"])

    def test_settings_allowlist_and_catalog_values_are_validated(self):
        status, _ = self.request("POST", {
            "schema_version": "render-settings.v1", "overrides": {"unknown": True},
        })
        self.assertEqual(400, status)
        status, _ = self.request("POST", {
            "schema_version": "render-settings.v1", "overrides": {"music": "not-in-catalog"},
        })
        self.assertEqual(400, status)
        status, _ = self.request("POST", {
            "schema_version": "render-settings.v1", "overrides": {"platforms": ["youtube", "youtube"]},
        })
        self.assertEqual(400, status)
        status, _ = self.request("POST", {
            "schema_version": "render-settings.v1", "overrides": {"platforms": ["unknown"]},
        })
        self.assertEqual(400, status)
        status, _ = self.request("POST", {
            "schema_version": "render-settings.v1", "overrides": {"scene_dissolve_seconds": 5.1},
        })
        self.assertEqual(400, status)

    def test_render_resolver_prefers_explicit_payload_over_db_overrides(self):
        self.auth.save_render_settings(
            self.user["user_id"], {"music": "bach", "volume": 0.2, "scene_dissolve_seconds": 4.0}
        )
        effective = SERVER.resolve_render_settings(
            self.user["user_id"], {"music": "debussy", "volume": 2, "video_pan_x": -1,
                                    "platforms": ["youtube", "naver"], "scene_dissolve_seconds": 0}
        )
        self.assertEqual("debussy", effective["music"])
        self.assertEqual(1.0, effective["volume"])
        self.assertEqual(0.0, effective["video_pan_x"])
        self.assertEqual(["youtube", "naver"], effective["platforms"])
        self.assertEqual(0.0, effective["scene_dissolve_seconds"])

    def test_automation_schema_accepts_optional_render_without_breaking_old_shape(self):
        config = {
            "schema_version": "1.0.0", "endpoint": "2",
            "repeat": {"unit": "month", "interval": 1},
            "keywords": {"count": 3, "ai": False, "month": ""},
            "video": {"scene_count": 0, "crop": "default"},
            "brand": {"intro": False, "outro": False, "watermark": False},
            "channels": ["youtube"],
            "render": {"type": "editorial", "music": "satie", "volume": 0.5,
                        "narration": True, "video_pan_x": 0.5, "caption_size": 0},
        }
        self.assertEqual(config, validate_config(config))
        del config["render"]
        self.assertEqual(config, validate_config(config))


if __name__ == "__main__":
    unittest.main()
