import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "01_app"))

from final_export_progress import ProgressThrottle


class FinalExportProgressTests(unittest.TestCase):
    def test_throttles_same_phase_but_never_hides_phase_or_terminal_change(self):
        writes = []
        with patch("final_export_progress.time.monotonic", side_effect=[1, 1.1, 1.2, 1.3]):
            progress = ProgressThrottle(writes.append, interval_seconds=0.25)
            self.assertTrue(progress({"phase": "scene", "progress": 0.1}))
            self.assertFalse(progress({"phase": "scene", "progress": 0.2}))
            self.assertTrue(progress({"phase": "mux", "progress": 0.3}))
            self.assertTrue(progress({"phase": "mux", "progress": 1.0}))
        self.assertEqual([item["progress"] for item in writes], [0.1, 0.3, 1.0])


if __name__ == "__main__":
    unittest.main()
