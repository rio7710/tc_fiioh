import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "01_app"))

import render_server as server


class FailingFinalizeStore:
    def finalize_final_exports(self, *_args):
        raise ValueError("캘린더 finalize 실패")


def snapshot():
    return {
        "job_id": "render-cleanup-1", "user_id": "user-1",
        "project_id": "project-1", "revision_id": "revision-1",
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
        "voice_assets": [], "voice_profile_id": "warm", "brand_assets": [],
        "scene_crop_positions": {}, "requested_platforms": ["youtube"],
        "input_hash": "sha256:" + "a" * 64, "timeline_hash": "sha256:fixture",
        "idempotency_key": "sha256:fixture", "schema_version": "final-export-job.v2",
    }


class FinalExportFailureCleanupTests(unittest.TestCase):
    def test_finalize_failure_removes_only_new_output(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "new-final.mp4"
            output.write_bytes(b"new-final-video")
            rendered = {
                "filename": output.name, "path": output, "duration": 1.0,
                "width": 1280, "height": 720, "scene_count": 1, "reused": False,
            }
            with (
                patch.object(server, "preflight_final_export_snapshot", return_value=snapshot()),
                patch.object(server, "get_auth_store", return_value=FailingFinalizeStore()),
                patch.object(server, "prepare_caption_overlays", return_value=[]),
                patch.object(server, "validate_caption_overlays", return_value=None),
                patch.object(server, "render_video", return_value=rendered),
                patch.object(server, "clean_caption_artifacts", return_value=None),
                patch.object(server, "update_render_progress", return_value=None),
            ):
                with self.assertRaisesRegex(ValueError, "finalize"):
                    server.execute_render_request(
                        "user-1", {"job_id": "render-cleanup-1", "final_export_snapshot": snapshot()}
                    )
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
