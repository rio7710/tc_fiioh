import subprocess
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '01_app'))
from caption_browser_process import run_caption_browser


class CaptionBrowserProcessTests(unittest.TestCase):
    def test_completed_process_preserves_output(self):
        result = run_caption_browser([sys.executable, '-c', 'print("rendered")'], cwd=None, timeout=5)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), 'rendered')

    def test_timeout_terminates_process_without_hanging(self):
        start = time.monotonic()
        with self.assertRaises(subprocess.TimeoutExpired):
            run_caption_browser([sys.executable, '-c', 'import time; time.sleep(60)'], cwd=None, timeout=0.1)
        self.assertLess(time.monotonic() - start, 5)
