import os
import sys
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "01_app"))

from ffmpeg_process_runner import (
    FfmpegCancelled, FfmpegTimeout, FfmpegTimeoutPolicy, run_ffmpeg_process,
)


class FfmpegProcessRunnerTests(unittest.TestCase):
    def policy(self, timeout=0.3):
        return FfmpegTimeoutPolicy(
            base_seconds=timeout, duration_factor=0.01,
            maximum_seconds=timeout, terminate_grace_seconds=0.2,
        )

    def test_hung_process_times_out_quickly(self):
        started = time.monotonic()
        with self.assertRaises(FfmpegTimeout):
            run_ffmpeg_process(
                [sys.executable, "-c", "import time; time.sleep(30)"],
                "hung", policy=self.policy(),
            )
        self.assertLess(time.monotonic() - started, 2)

    def test_cancel_terminates_the_whole_child_group(self):
        if os.name != "posix":
            self.skipTest("process-group assertion requires POSIX")
        child_pid = []
        cancelled = []
        script = (
            "import subprocess,sys,time;"
            "p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)']);"
            "print(p.pid,flush=True);time.sleep(30)"
        )

        def line(value):
            child_pid.append(int(value))
            cancelled.append(True)

        with self.assertRaises(FfmpegCancelled):
            run_ffmpeg_process(
                [sys.executable, "-c", script], "cancelled", line,
                cancel_requested=lambda: bool(cancelled), policy=self.policy(5),
            )
        self.assertTrue(child_pid)
        for _ in range(20):
            try:
                os.kill(child_pid[0], 0)
                alive = True
            except ProcessLookupError:
                alive = False
            if not alive:
                break
            time.sleep(0.05)
        self.assertFalse(alive)


if __name__ == "__main__":
    unittest.main()
