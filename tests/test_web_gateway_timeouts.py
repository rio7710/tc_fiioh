import sys
import unittest
from pathlib import Path


APP = Path(__file__).resolve().parents[1] / "01_app"
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

from web_gateway import api_timeout_for_path


class WebGatewayTimeoutTests(unittest.TestCase):
    def test_render_wait_matches_durable_worker_contract(self):
        self.assertEqual(7200, api_timeout_for_path("/render"))
        self.assertEqual(7200, api_timeout_for_path("/render?retry=1"))

    def test_other_routes_keep_existing_limits(self):
        self.assertEqual(660, api_timeout_for_path("/api/script/generate"))
        self.assertEqual(120, api_timeout_for_path("/api/projects"))


if __name__ == "__main__":
    unittest.main()
