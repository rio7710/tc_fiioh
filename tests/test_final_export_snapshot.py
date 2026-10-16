import copy
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "01_app"))
sys.path.insert(0, str(ROOT))

from final_export_snapshot import narration_text_hash, seal_snapshot, verify_snapshot
from tools.validate_json_schema import validate_json_schema_file


def snapshot_input():
    lines = ["첫 번째 문장", "두 번째 문장"]
    return {
        "job_id": "render-fixture-1",
        "user_id": "user-1",
        "project_id": "project-1",
        "revision_id": "revision-1",
        "voice_profile_id": "warm",
        "render_settings": {"narration": True, "type": "editorial", "music": "none"},
        "content_data": {
            "state": {"script": {"headline": "제목", "lines": lines}},
            "timeline": {"scenes": [
                {
                    "id": "scene-1", "media_type": "image", "script_line_index": 0,
                    "narration_cue_id": "cue-1", "start": 0.0, "end": 1.0,
                },
                {
                    "id": "scene-2", "media_type": "video", "script_line_index": 1,
                    "narration_cue_id": "cue-2", "start": 1.0, "end": 2.0,
                },
            ]},
        },
        "scene_assets": [
            {
                "artifact_id": "image-1", "scene_id": "scene-1", "media_type": "image",
                "selected": True, "uri": "/image-1.png", "checksum": "sha256:image-1",
            },
            {
                "artifact_id": "video-2", "scene_id": "scene-2", "media_type": "video",
                "selected": True, "uri": "/video-2.mp4", "checksum": "sha256:video-2",
            },
        ],
        "voice_assets": [
            {
                "artifact_id": "voice-1", "scene_id": "scene-1", "cue_id": "cue-1",
                "profile_id": "warm", "text_hash": narration_text_hash(lines[0]),
                "uri": "/voice-1.wav", "checksum": "sha256:voice-1",
            },
            {
                "artifact_id": "voice-2", "scene_id": "scene-2", "cue_id": "cue-2",
                "profile_id": "warm", "text_hash": narration_text_hash(lines[1]),
                "uri": "/voice-2.wav", "checksum": "sha256:voice-2",
            },
        ],
        "brand_assets": [],
        "scene_crop_positions": {},
        "requested_platforms": ["youtube", "instagram"],
    }


class FinalExportSnapshotTests(unittest.TestCase):
    def test_sealed_snapshot_is_deterministic_and_matches_schema(self):
        first = seal_snapshot(snapshot_input())
        second = seal_snapshot(copy.deepcopy(snapshot_input()))
        self.assertEqual(first, second)
        validate_json_schema_file(first, ROOT / "contracts" / "final-export-job.schema.json")

    def test_any_nested_change_invalidates_input_hash(self):
        sealed = seal_snapshot(snapshot_input())
        changed = copy.deepcopy(sealed)
        changed["render_settings"]["music"] = "satie"
        with self.assertRaisesRegex(ValueError, "input hash mismatch"):
            verify_snapshot(changed)

    def test_job_id_does_not_change_content_idempotency(self):
        first = seal_snapshot(snapshot_input())
        changed = snapshot_input()
        changed["job_id"] = "render-fixture-2"
        second = seal_snapshot(changed)
        self.assertEqual(first["input_hash"], second["input_hash"])
        self.assertEqual(first["idempotency_key"], second["idempotency_key"])

    def test_timeline_change_invalidates_timeline_hash(self):
        sealed = seal_snapshot(snapshot_input())
        changed = copy.deepcopy(sealed)
        changed["content_data"]["timeline"]["scenes"][0]["end"] = 1.5
        with self.assertRaisesRegex(ValueError, "timeline hash mismatch"):
            verify_snapshot(changed)

    def test_missing_or_wrong_media_is_rejected(self):
        missing = snapshot_input()
        missing["scene_assets"].pop()
        with self.assertRaisesRegex(ValueError, "selected scene asset is missing"):
            seal_snapshot(missing)
        wrong = snapshot_input()
        wrong["scene_assets"][0]["media_type"] = "video"
        with self.assertRaisesRegex(ValueError, "media type mismatch"):
            seal_snapshot(wrong)

    def test_voice_identity_is_cue_profile_text_and_checksum(self):
        for key, value in (
            ("text_hash", "bad"), ("profile_id", ""), ("checksum", ""), ("uri", ""),
        ):
            with self.subTest(key=key):
                changed = snapshot_input()
                changed["voice_assets"][0][key] = value
                with self.assertRaises(ValueError):
                    seal_snapshot(changed)

    def test_duplicate_platform_or_scene_asset_is_rejected(self):
        duplicate_platform = snapshot_input()
        duplicate_platform["requested_platforms"].append("youtube")
        with self.assertRaisesRegex(ValueError, "platforms must be unique"):
            seal_snapshot(duplicate_platform)
        duplicate_asset = snapshot_input()
        duplicate_asset["scene_assets"].append(copy.deepcopy(duplicate_asset["scene_assets"][0]))
        with self.assertRaisesRegex(ValueError, "scene assets must be unique"):
            seal_snapshot(duplicate_asset)

    def test_duplicate_or_wrong_profile_voice_is_rejected(self):
        duplicate = snapshot_input()
        duplicate["voice_assets"].append(copy.deepcopy(duplicate["voice_assets"][0]))
        with self.assertRaisesRegex(ValueError, "voice cues must be unique"):
            seal_snapshot(duplicate)
        wrong = snapshot_input()
        wrong["voice_assets"][0]["profile_id"] = "other"
        with self.assertRaisesRegex(ValueError, "voice profile mismatch"):
            seal_snapshot(wrong)


if __name__ == "__main__":
    unittest.main()
