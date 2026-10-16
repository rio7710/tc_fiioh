import unittest

from tests.test_staged_ffmpeg_renderer import StagedFfmpegRendererTests
from staged_ffmpeg_renderer import render_video_staged


class StagedRenderInputIdentityTests(unittest.TestCase):
    def setUp(self):
        self.fixture = StagedFfmpegRendererTests(methodName="test_job_output_is_idempotent_and_work_directory_is_cleaned")
        self.fixture.setUp()

    def tearDown(self):
        self.fixture.tearDown()

    def test_same_job_reuses_only_matching_input_hash(self):
        dependencies = self.fixture.dependencies()
        first_config = self.fixture.config()
        first_config["input_hash"] = "sha256:" + "a" * 64
        first = render_video_staged(first_config, "stable-job", dependencies=dependencies)
        calls_after_first = len(self.fixture.runner.calls)
        repeated = render_video_staged(first_config, "stable-job", dependencies=dependencies)
        self.assertEqual(first["path"], repeated["path"])
        self.assertEqual(calls_after_first, len(self.fixture.runner.calls))
        self.assertTrue(repeated["reused"])

        changed_config = self.fixture.config()
        changed_config["input_hash"] = "sha256:" + "b" * 64
        changed = render_video_staged(changed_config, "stable-job", dependencies=dependencies)
        self.assertNotEqual(first["path"], changed["path"])
        self.assertGreater(len(self.fixture.runner.calls), calls_after_first)
        self.assertFalse(changed["reused"])


if __name__ == "__main__":
    unittest.main()
