import hashlib
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "01_app"))

from final_export_preflight import preflight_final_export_snapshot
from final_export_snapshot import narration_text_hash
from final_export_snapshot_builder import build_final_export_snapshot


class FakeStore:
    def __init__(self, text_hash):
        self.text_hash = text_hash
        self.image_selected = True

    def latest_stage_data(self, user_id, project_id, stage):
        return {
            "revision_id": "revision-1", "status": "confirmed",
            "data": {"document": {"fixture": True}, "voice_profile": "warm"},
        }

    def list_scene_voice_clips(self, *args):
        return [{
            "artifact_id": "voice-1", "scene_id": "scene-1", "cue_id": "cue-1",
            "profile_id": "warm", "text_hash": self.text_hash, "uri": "voice.wav",
        }]

    def list_scene_image_candidates(self, *args):
        return [
            {
                "artifact_id": "image-selected", "scene_id": "scene-1",
                "uri": "selected.png", "selected": self.image_selected,
            },
            {
                "artifact_id": "image-fallback", "scene_id": "scene-1",
                "uri": "fallback.png", "selected": False,
            },
        ]

    def list_scene_video_candidates(self, *args):
        return [{
            "artifact_id": "video-selected", "scene_id": "scene-2",
            "uri": "selected.mp4", "selected": True,
        }]

    def scene_crop_positions(self, *args):
        return {"scene-2": {"9x16": 60, "4x5": 40}}

    def content_brand_selections(self, *args):
        return []


class FinalExportSnapshotBuilderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        for name in ("selected.png", "fallback.png", "selected.mp4", "voice.wav"):
            (self.root / name).write_bytes((name + "-fixture").encode())
        self.lines = ["고정된 첫 문장"]
        self.store = FakeStore(narration_text_hash(self.lines[0]))

    def tearDown(self):
        self.temp.cleanup()

    def document_view(self, _document):
        return (
            {"headline": "제목", "lines": self.lines},
            {"scenes": [
                {
                    "id": "scene-1", "media_type": "image", "start": 0.0, "end": 1.0,
                    "script_line_index": 0, "narration_cue_id": "cue-1",
                },
                {
                    "id": "scene-2", "media_type": "video", "start": 1.0, "end": 2.0,
                    "script_line_index": None, "narration_cue_id": None,
                },
            ]},
        )

    def path(self, uri):
        path = self.root / str(uri)
        return path if path.is_file() else None

    @staticmethod
    def sha(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def build(self):
        return build_final_export_snapshot(
            job_id="render-job-1", user_id="user-1", project_id="project-1",
            payload={"revision_id": "revision-1", "platforms": ["youtube"], "narration": True},
            store=self.store, document_view=self.document_view,
            retime_timeline=lambda timeline, _voices: timeline,
            resolve_settings=lambda _user, explicit: {"narration": explicit.get("narration", True), "platforms": ["youtube"]},
            image_path=self.path,
            video_path=lambda _scene, _index, artifacts: self.path(next(iter(artifacts.values()))["uri"]),
            voice_path=self.path, brand_path=self.path, sha256_file=self.sha,
            platform_formats={"youtube": (1280, 720, "16x9")},
            render_setting_keys={"narration", "platforms"},
        )

    def test_builder_freezes_only_explicitly_selected_assets(self):
        snapshot = self.build()
        self.assertEqual("revision-1", snapshot["revision_id"])
        self.assertEqual(["image-selected", "video-selected"], [item["artifact_id"] for item in snapshot["scene_assets"]])
        self.assertEqual({"9x16": 0.6, "4x5": 0.4}, snapshot["scene_crop_positions"]["scene-2"])
        self.assertTrue(snapshot["input_hash"].startswith("sha256:"))

    def test_preflight_rechecks_all_frozen_files_and_video_probe(self):
        snapshot = self.build()
        checked = preflight_final_export_snapshot(
            snapshot, image_path=self.path,
            video_path=lambda _scene, _index, artifacts: self.path(next(iter(artifacts.values()))["uri"]),
            voice_path=self.path, brand_path=self.path, sha256_file=self.sha,
            probe_video=lambda _path: 2.0,
        )
        self.assertEqual(snapshot["input_hash"], checked["input_hash"])
        (self.root / "selected.mp4").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            preflight_final_export_snapshot(
                snapshot, image_path=self.path,
                video_path=lambda _scene, _index, artifacts: self.path(next(iter(artifacts.values()))["uri"]),
                voice_path=self.path, brand_path=self.path, sha256_file=self.sha,
                probe_video=lambda _path: 2.0,
            )

    def test_unselected_candidate_never_becomes_a_fallback(self):
        self.store.image_selected = False
        with self.assertRaisesRegex(FileNotFoundError, "선택된 image 자산"):
            self.build()

    def test_revision_mismatch_is_rejected_before_asset_work(self):
        with self.assertRaisesRegex(ValueError, "리비전"):
            build_final_export_snapshot(
                job_id="render-job-1", user_id="user-1", project_id="project-1",
                payload={"revision_id": "stale", "platforms": ["youtube"]}, store=self.store,
                document_view=self.document_view, retime_timeline=lambda timeline, _voices: timeline,
                resolve_settings=lambda *_args: {}, image_path=self.path, video_path=lambda *_args: None,
                voice_path=self.path, brand_path=self.path, sha256_file=self.sha,
                platform_formats={"youtube": (1280, 720, "16x9")}, render_setting_keys=set(),
            )


if __name__ == "__main__":
    unittest.main()
