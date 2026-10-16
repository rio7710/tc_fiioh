import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "01_app"))

import render_server as server


class SnapshotOnlyStore:
    def __init__(self):
        self.registered = []

    def latest_stage_data(self, *_args):
        raise AssertionError("snapshot jobs must not query the latest revision")

    def finalize_final_exports(self, *args):
        self.registered.append(args)
        return [{"artifact_id": "artifact-final-1"}]


class FinalExportSnapshotExecutionTests(unittest.TestCase):
    def test_worker_execution_uses_frozen_snapshot_without_latest_db_read(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "final.mp4"
            output.write_bytes(b"final-video")
            snapshot = {
                "job_id": "render-job-1",
                "user_id": "user-1",
                "project_id": "project-1",
                "revision_id": "revision-frozen",
                "render_settings": {
                    "type": "editorial", "music": "none", "volume": 0.2,
                    "narration": False, "caption_size": 0, "video_pan_x": 0.5,
                    "preview_platform": "youtube", "platforms": ["youtube"],
                    "scene_dissolve_seconds": 0.3,
                },
                "content_data": {
                    "state": {"script": {"headline": "제목", "lines": []}},
                    "timeline": {"scenes": [{
                        "id": "scene-1", "media_type": "image", "start": 0.0,
                        "end": 1.0, "script_line_index": None,
                    }]},
                },
                "scene_assets": [{
                    "artifact_id": "image-1", "scene_id": "scene-1",
                    "media_type": "image", "selected": True,
                    "uri": "/image.png", "checksum": "sha256:image",
                }],
                "voice_assets": [], "brand_assets": [],
                "voice_profile_id": "warm",
                "scene_crop_positions": {}, "requested_platforms": ["youtube"],
                "input_hash": "sha256:fixture", "timeline_hash": "sha256:fixture",
                "idempotency_key": "sha256:fixture", "schema_version": "final-export-job.v2",
            }
            store = SnapshotOnlyStore()
            rendered = {
                "filename": output.name, "path": output, "duration": 1.0,
                "width": 1280, "height": 720, "scene_count": 1,
            }
            with (
                patch.object(server, "preflight_final_export_snapshot", return_value=snapshot),
                patch.object(server, "get_auth_store", return_value=store),
                patch.object(server, "prepare_caption_overlays", return_value=[]),
                patch.object(server, "validate_caption_overlays", return_value=None),
                patch.object(server, "render_video", return_value=rendered),
                patch.object(server, "clean_caption_artifacts", return_value=None),
                patch.object(server, "update_render_progress", return_value=None),
            ):
                result = server.execute_render_request(
                    "user-1", {"job_id": "render-job-1", "final_export_snapshot": snapshot}
                )
        self.assertTrue(result["ok"])
        self.assertEqual("revision-frozen", store.registered[0][2])
        self.assertEqual(1, len(result["exports"]))


if __name__ == "__main__":
    unittest.main()
