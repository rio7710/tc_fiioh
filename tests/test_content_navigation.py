import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class ContentNavigationTests(unittest.TestCase):
    def test_browser_history_and_identity(self):
        node = shutil.which('node')
        self.assertIsNotNone(node, 'Node.js is required for navigation contract tests')
        result = subprocess.run([node, 'tests/test_content_navigation.js'], cwd=ROOT,
                                capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
