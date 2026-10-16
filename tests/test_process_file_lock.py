import multiprocessing
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "01_app"))

from process_file_lock import process_file_lock


def hold(path, entered, release):
    with process_file_lock(Path(path)):
        entered.set()
        release.wait(5)


class ProcessFileLockTests(unittest.TestCase):
    def test_second_process_waits_for_registry_lock(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "registry.json"
            entered = multiprocessing.Event()
            release = multiprocessing.Event()
            process = multiprocessing.Process(target=hold, args=(str(path), entered, release))
            process.start()
            self.assertTrue(entered.wait(2))
            started = time.monotonic()
            threading.Timer(0.15, release.set).start()
            with process_file_lock(path):
                elapsed = time.monotonic() - started
            process.join(2)
            self.assertFalse(process.is_alive())
            self.assertGreaterEqual(elapsed, 0.1)


if __name__ == "__main__":
    unittest.main()
