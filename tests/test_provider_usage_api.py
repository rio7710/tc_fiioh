"""Provider usage endpoint tests without external account calls."""
import unittest
from unittest import mock

from test_pipeline_contracts import load_render_server


class ProviderUsageAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = load_render_server()

    def handler(self, user=True):
        handler = object.__new__(self.server.Handler)
        handler.path = "/api/provider-usage"
        handler.current_user = mock.Mock(
            return_value={"user_id": "owner"} if user else None
        )
        handler.send_json = mock.Mock()
        return handler

    def test_requires_login(self):
        handler = self.handler(False)
        handler.do_GET()
        self.assertEqual(handler.send_json.call_args.args[0], 401)

    def test_returns_openai_and_kling_usage_without_secrets(self):
        store = mock.Mock()
        store.provider_usage_summary.return_value = {
            "month": {"total_tokens": 120},
            "total": {"total_tokens": 340, "requests": 2},
        }
        kling = {
            "summary": {
                "video": {"used": 3, "total": 10},
                "image": {"used": 1, "total": 4},
            }
        }
        with mock.patch.object(self.server, "get_auth_store", return_value=store), \
             mock.patch.object(self.server, "provider_values", return_value={"api_key": "secret"}), \
             mock.patch.object(self.server, "kling_account_usage", return_value=kling):
            handler = self.handler()
            handler.do_GET()
        status, payload, headers = handler.send_json.call_args.args
        self.assertEqual(status, 200)
        self.assertEqual(payload["openai"]["total"]["total_tokens"], 340)
        self.assertTrue(payload["kling"]["available"])
        self.assertNotIn("secret", str(payload))
        self.assertEqual(headers["Cache-Control"], "private, no-store, max-age=0")

    def test_kling_failure_does_not_hide_openai_usage(self):
        store = mock.Mock()
        store.provider_usage_summary.return_value = {"month": {}, "total": {}}
        with mock.patch.object(self.server, "get_auth_store", return_value=store), \
             mock.patch.object(self.server, "provider_values", return_value={"api_key": "secret"}), \
             mock.patch.object(self.server, "kling_account_usage", side_effect=RuntimeError("provider secret")):
            handler = self.handler()
            handler.do_GET()
        status, payload = handler.send_json.call_args.args[:2]
        self.assertEqual(status, 200)
        self.assertFalse(payload["kling"]["available"])
        self.assertNotIn("provider secret", str(payload))


if __name__ == "__main__":
    unittest.main()
