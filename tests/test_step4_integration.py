import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class Step4IntegrationTests(unittest.TestCase):
    def test_step4_partial_and_video_editor_integration(self):
        node = shutil.which('node')
        self.assertIsNotNone(node, 'Node.js is required for Step 4 integration tests')
        result = subprocess.run(
            [node, 'tests/test_step4_integration.js'],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=20
        )
        self.assertEqual(result.returncode, 0, f"Test failure:\n{result.stdout}\n{result.stderr}")


if __name__ == '__main__':
    unittest.main()
