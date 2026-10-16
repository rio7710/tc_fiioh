import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "01_app"))

from final_export_errors import (
    RetryableFinalExportError,
    classify_final_export_error,
    public_error,
    sanitize_public_error,
)
from final_export_queue import FinalExportQueue


class FinalExportFixtureContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = ROOT / "tests" / "fixtures" / "final_export_contract.json"
        cls.fixture = json.loads(path.read_text(encoding="utf-8"))

    def test_success_fixture_has_one_selected_asset_and_voice_per_cue(self):
        success = self.fixture["success"]
        scene_cues = {item["cue_id"] for item in success["scenes"]}
        voice_cues = {item["cue_id"] for item in success["voices"]}
        self.assertEqual(scene_cues, voice_cues)
        self.assertTrue(all(item["selected"] for item in success["scenes"]))
        self.assertTrue(all(item["checksum"].startswith("sha256:") for item in success["scenes"]))
        self.assertEqual(
            {"youtube", "square", "instagram", "facebook"},
            set(success["render_settings"]["platforms"]),
        )

    def test_failure_fixtures_cover_media_voice_and_text_identity(self):
        failures = {item["name"]: item["expected_code"] for item in self.fixture["failures"]}
        self.assertEqual(
            {
                "missing_scene_media": "asset_missing",
                "missing_voice": "asset_missing",
                "voice_text_changed": "input_invalid",
            },
            failures,
        )

    def test_fixture_forbids_demo_video_and_narration(self):
        serialized = json.dumps(self.fixture["success"], sort_keys=True)
        for fallback in self.fixture["forbidden_fallbacks"]:
            self.assertNotIn(fallback, serialized)

    def test_observed_success_fixture_preserves_real_output_shape(self):
        observed = self.fixture["observed_success"]
        timeline = observed["timeline"]
        self.assertEqual(17, observed["scene_count"])
        self.assertEqual(17, len(timeline))
        self.assertEqual(0.0, timeline[0]["start"])
        self.assertEqual(observed["timeline_duration"], timeline[-1]["end"])
        for index, scene in enumerate(timeline):
            self.assertEqual(index, scene["script_line_index"])
            self.assertEqual("video", scene["media_type"])
            if index:
                self.assertEqual(timeline[index - 1]["end"], scene["start"])
        self.assertEqual({"16:9", "9:16", "4:5"}, {item["aspect_ratio"] for item in observed["outputs"]})
        self.assertTrue(all(item["video_codec"] == "h264" for item in observed["outputs"]))
        self.assertTrue(all(item["audio_codec"] == "aac" for item in observed["outputs"]))
        self.assertEqual(62.44, observed["final_duration"])


class FinalExportErrorContractTests(unittest.TestCase):
    def test_public_error_is_structured_and_does_not_leak_exception(self):
        secret = RuntimeError("secret /private/token stderr")
        failure = classify_final_export_error(secret)
        error = public_error(failure, job_id="job-1", stage="audio-mux", attempt=2)
        self.assertEqual("internal", error["category"])
        self.assertEqual("audio-mux", error["stage"])
        self.assertEqual(2, error["attempt"])
        self.assertEqual("job-1", error["job_id"])
        self.assertNotIn("private/token", json.dumps(error))

    def test_retryable_categories_are_explicit(self):
        cases = [
            (RetryableFinalExportError("network"), "transient_io", True),
            (sqlite3.OperationalError("database is locked"), "transient_io", True),
            (TimeoutError("late"), "timeout", True),
            (FileNotFoundError("missing"), "asset_missing", False),
            (ValueError("bad"), "input_invalid", False),
        ]
        for exc, category, retryable in cases:
            with self.subTest(exc=type(exc).__name__):
                failure = classify_final_export_error(exc)
                self.assertEqual(category, failure.category)
                self.assertEqual(retryable, failure.retryable)

    def test_queue_sanitizer_only_keeps_safe_bounded_fields(self):
        error = sanitize_public_error(
            {
                "code": "bad" * 100,
                "category": "unknown",
                "message": "safe",
                "stage": "scene" * 100,
                "attempt": 3,
                "job_id": "job" * 100,
                "traceback": "/private/secret",
            },
            retryable=False,
        )
        self.assertEqual("internal", error["category"])
        self.assertEqual(100, len(error["code"]))
        self.assertEqual(100, len(error["stage"]))
        self.assertEqual(200, len(error["job_id"]))
        self.assertNotIn("traceback", error)

    def test_queue_persists_diagnostic_fields_without_traceback(self):
        with tempfile.TemporaryDirectory() as directory:
            queue = FinalExportQueue(Path(directory) / "queue.sqlite")
            queue.enqueue("job-test-1", "user-1", {"project_id": "project-1"})
            queue.claim("worker-1")
            failed = queue.fail(
                "job-test-1",
                "worker-1",
                {
                    "code": "ffmpeg_failed",
                    "category": "ffmpeg_failed",
                    "message": "안전한 메시지",
                    "stage": "audio-mux",
                    "attempt": 1,
                    "job_id": "job-test-1",
                    "traceback": "/private/secret",
                },
            )
        self.assertEqual("failed", failed["status"])
        self.assertEqual("ffmpeg_failed", failed["error"]["category"])
        self.assertEqual("audio-mux", failed["error"]["stage"])
        self.assertEqual("job-test-1", failed["error"]["job_id"])
        self.assertNotIn("traceback", failed["error"])


if __name__ == "__main__":
    unittest.main()
