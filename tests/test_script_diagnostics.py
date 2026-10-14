import json
import stat
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "01_app"))
import render_server as server


class ScriptDiagnosticLogTests(unittest.TestCase):
    def test_jsonl_log_is_private_complete_and_concurrency_safe(self):
        with tempfile.TemporaryDirectory() as temporary:
            original = server.SCRIPT_DIAGNOSTIC_LOG_PATH
            path = Path(temporary) / "script-diagnostics.jsonl"
            server.SCRIPT_DIAGNOSTIC_LOG_PATH = path
            try:
                with ThreadPoolExecutor(max_workers=4) as executor:
                    list(executor.map(
                        lambda index: server.append_script_diagnostic({
                            "event": "test_failure", "project_id": "project-test",
                            "scene_id": f"scene-{index:02d}", "message": "검증 실패",
                        }),
                        range(20),
                    ))
                records = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
                self.assertEqual(20, len(records))
                self.assertEqual(set(range(20)), {
                    int(item["scene_id"].split("-")[-1]) for item in records
                })
                self.assertTrue(all(item["timestamp"] for item in records))
                self.assertEqual(0o600, stat.S_IMODE(path.stat().st_mode))
            finally:
                server.SCRIPT_DIAGNOSTIC_LOG_PATH = original


if __name__ == "__main__":
    unittest.main()
