import importlib.util
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "01_app"
sys.path.insert(0, str(APP))
from staged_ffmpeg_renderer import _narration_sources


def load_server():
    path = APP / "render_server.py"
    spec = importlib.util.spec_from_file_location("no_demo_render_server", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class FinalExportDemoFallbackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = load_server()

    def test_missing_scene_video_never_uses_demo_video(self):
        scene = {"id": "scene-missing"}
        with mock.patch.object(self.server, "SOURCE_CLIPS", ROOT / "missing-clips"):
            with self.assertRaisesRegex(ValueError, "원본 MP4"):
                self.server.scene_video_path(scene, 0)

    def test_missing_voice_clips_never_use_demo_narration(self):
        dependencies = SimpleNamespace(voice_audio_path=lambda _uri: None)
        config = {"narration": True, "voice_clips": []}
        scenes = [{"id": "scene-1", "name": "1번", "cue_start": 0.0}]
        with self.assertRaisesRegex(ValueError, "모든 장면의 음성"):
            _narration_sources(dependencies, config, scenes)

    def test_final_export_image_excludes_demo_media(self):
        dockerfile = (ROOT / "Dockerfile.final-export").read_text(encoding="utf-8")
        self.assertNotIn("P1_merged.mp4", dockerfile)
        self.assertNotIn("02_media/narration", dockerfile)


if __name__ == "__main__":
    unittest.main()
