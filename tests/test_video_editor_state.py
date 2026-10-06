import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class VideoEditorStateTests(unittest.TestCase):
    def test_video_editor_pure_state_modules(self):
        node = shutil.which('node')
        self.assertIsNotNone(node, 'Node.js is required for video editor pure state tests')
        result = subprocess.run(
            [node, 'tests/test_video_editor_state.js'],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=20
        )
        self.assertEqual(result.returncode, 0, f"Test failure details:\n{result.stdout}\n{result.stderr}")


if __name__ == '__main__':
    unittest.main()
