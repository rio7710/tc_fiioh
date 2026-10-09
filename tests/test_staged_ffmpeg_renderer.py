import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "01_app"
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

from staged_ffmpeg_renderer import StagedRenderDependencies, render_video_staged


class FakeRunner:
    def __init__(self, fail_stage=None):
        self.calls = []
        self.fail_stage = fail_stage

    def __call__(self, args, stage, line_callback):
        self.calls.append((stage, args))
        output = Path(args[-1])
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"x" * 2048)
        if stage == self.fail_stage:
            raise RuntimeError(f"failed: {stage}")
        if line_callback:
            line_callback("out_time_ms=2000000")


class StagedFfmpegRendererTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.exports = self.root / "exports"
        self.image = self.root / "scene.webp"
        self.watermark = self.root / "watermark.png"
        self.outro_wide = self.root / "outro-wide.png"
        self.outro_tall = self.root / "outro-tall.png"
        self.music = self.root / "music.mp3"
        for path in (self.image, self.watermark, self.outro_wide, self.outro_tall, self.music):
            path.write_bytes(b"asset")
        self.progress = []
        self.runner = FakeRunner()

    def tearDown(self):
        self.temporary.cleanup()

    @staticmethod
    def timeline(data):
        return [dict(scene) for scene in data["timeline"]["scenes"]]

    @staticmethod
    def title_scenes(data):
        return [dict(scene) for scene in data["timeline"]["scenes"]]

    def dependencies(self, runner=None):
        assets = {
            "watermark.png": self.watermark,
            "outro-wide.png": self.outro_wide,
            "outro-tall.png": self.outro_tall,
        }
        return StagedRenderDependencies(
            ffmpeg="ffmpeg",
            root=self.root,
            exports_dir=self.exports,
            platform_formats={
                "youtube": (1920, 1080, "16x9"),
                "instagram": (1080, 1920, "9x16"),
            },
            music={"none": None, "satie": self.music},
            narration_tracks=[],
            render_defaults={"scene_dissolve_seconds": 0.3, "music_start_offset_seconds": 3.0, "music_fade_in_seconds": 2.0, "music_fade_out_seconds": 2.0},
            timeline_from_data=self.timeline,
            timed_script_scenes=self.title_scenes,
            storyboard_image_path=lambda uri: self.image if uri else None,
            scene_video_path=lambda scene, index, artifacts: self.root / "missing.mp4",
            voice_audio_path=lambda uri: None,
            brand_asset_path=lambda uri: assets.get(Path(str(uri)).name),
            media_duration=lambda path: 4.0 if path.name.startswith("P1_final_") or path.name == "final-output.mp4" else 2.0,
            prepare_caption_overlays=lambda config, job, width, height, data: [],
            update_progress=lambda job, **changes: self.progress.append((job, changes)),
            merged_demo_video=self.root / "merged.mp4",
            ffmpeg_threads=2,
            render_preset="veryfast",
            command_runner=runner or self.runner,
            minimum_output_bytes=1024,
        )

    def config(self, platform="youtube"):
        return {
            "type": "editorial",
            "music": "none",
            "volume": 0.2,
            "narration": False,
            "video_pan_x": 0.5,
            "caption_size": 0,
            "preview_platform": platform,
            "scene_dissolve_seconds": 0.3,
            "content_data": {
                "timeline": {"scenes": [
                    {"id": "scene-1", "start": 0.0, "end": 1.0,
                     "media_type": "image", "cue_start": 0.0, "cue_end": 1.0},
                    {"id": "scene-2", "start": 1.0, "end": 2.0,
                     "media_type": "image", "cue_start": 1.0, "cue_end": 2.0},
                ]},
            },
            "scene_images": {
                "scene-1": {"uri": "image-1"},
                "scene-2": {"uri": "image-2"},
            },
            "brand_selections": [
                {"role": "watermark", "enabled": True, "uri": "watermark.png",
                 "media_type": "image", "settings": {"opacity": 0.6, "width_ratio": 0.2}},
                {"role": "outro", "enabled": True, "uri": "outro-wide.png",
                 "media_type": "image", "settings": {"profiles": {
                    "16x9": {"uri": "outro-wide.png", "width_ratio": 0.8,
                             "background": "black", "background_opacity": 0.5},
                    "9x16": {"uri": "outro-tall.png", "width_ratio": 0.7,
                             "background": "white", "background_opacity": 0.4},
                 }}},
            ],
        }

    def test_stages_bound_visual_input_fan_in_and_preserve_duration(self):
        result = render_video_staged(self.config(), "job-1", dependencies=self.dependencies())
        self.assertEqual(4.0, result["duration"])
        self.assertEqual((1920, 1080), (result["width"], result["height"]))
        self.assertEqual(2, result["scene_count"])
        stages = [stage for stage, _ in self.runner.calls]
        self.assertEqual(2, stages.count("scene-001") + stages.count("scene-002"))
        self.assertIn("scene-transition-frame", stages)
        self.assertIn("scene-transition", stages)
        self.assertIn("body-decoration-concat", stages)
        self.assertIn("brand-outro", stages)
        self.assertEqual("audio-mux", stages[-1])
        visual_calls = [(stage, args) for stage, args in self.runner.calls if stage != "audio-mux"]
        self.assertTrue(all(args.count("-i") <= 2 for _, args in visual_calls))
        transition = next(args for stage, args in self.runner.calls if stage == "scene-transition")
        freeze = next(args for stage, args in self.runner.calls if stage == "scene-transition-frame")
        self.assertIn("-sseof", freeze)
        self.assertIn("reverse", freeze)
        self.assertIn("-loop", transition)
        self.assertEqual("1", transition[transition.index("-loop") + 1])
        transition_graph = transition[transition.index("-filter_complex") + 1]
        self.assertEqual(2, transition_graph.count("fps=30"))
        self.assertIn("settb=AVTB", transition_graph)
        self.assertIn("xfade=transition=fade:duration=0.300000:offset=0", transition_graph)
        audio = self.runner.calls[-1][1]
        self.assertIn("4.000000", audio)
        self.assertIn("+faststart", audio)
        self.assertIn("aac", audio)

    def test_ratio_specific_outro_is_selected(self):
        result = render_video_staged(self.config("instagram"), "vertical", dependencies=self.dependencies())
        self.assertEqual((1080, 1920), (result["width"], result["height"]))
        outro = next(args for stage, args in self.runner.calls if stage == "brand-outro")
        self.assertIn(str(self.outro_tall), outro)
        graph = outro[outro.index("-filter_complex") + 1]
        self.assertIn("scale=756:-1", graph)
        self.assertIn("color=white@0.400", graph)

    def test_music_skips_silent_head_and_keeps_fade_in(self):
        config = self.config()
        config["music"] = "satie"
        render_video_staged(config, "music-offset", dependencies=self.dependencies())
        audio = next(args for stage, args in self.runner.calls if stage == "audio-mux")
        graph = audio[audio.index("-filter_complex") + 1]
        self.assertIn("atrim=start=3.000000", graph)
        self.assertIn("afade=t=in:st=0:d=2.000000", graph)

    def test_job_output_is_idempotent_and_work_directory_is_cleaned(self):
        dependencies = self.dependencies()
        first = render_video_staged(self.config(), "same-job", dependencies=dependencies)
        call_count = len(self.runner.calls)
        second = render_video_staged(self.config(), "same-job", dependencies=dependencies)
        self.assertEqual(first["path"], second["path"])
        self.assertEqual(call_count, len(self.runner.calls))
        self.assertIn("job_same-job", first["filename"])
        work = self.exports / ".render_work"
        self.assertEqual([], list(work.iterdir()))
        self.assertIn("재사용", self.progress[-1][1]["detail"])

    def test_failure_removes_partial_final_and_temporary_files(self):
        runner = FakeRunner(fail_stage="audio-mux")
        with self.assertRaisesRegex(RuntimeError, "audio-mux"):
            render_video_staged(self.config(), "failed-job", dependencies=self.dependencies(runner))
        finals = list(self.exports.glob("*.mp4"))
        self.assertEqual([], finals)
        self.assertEqual([], list((self.exports / ".render_work").iterdir()))
        self.assertEqual("failed", self.progress[-1][1]["status"])

    def test_corrupt_existing_output_is_not_reused(self):
        dependencies = self.dependencies()
        expected = self.exports / "P1_final_editorial_youtube_16x9_none_job_corrupt.mp4"
        expected.parent.mkdir(parents=True, exist_ok=True)
        expected.write_bytes(b"x" * 2048)
        invalid_dependencies = StagedRenderDependencies(
            **{
                **dependencies.__dict__,
                "media_duration": lambda path: (
                    0.0 if path == expected and not self.runner.calls else 4.0
                ),
            }
        )
        render_video_staged(self.config(), "corrupt", dependencies=invalid_dependencies)
        self.assertGreater(len(self.runner.calls), 0)


if __name__ == "__main__":
    unittest.main()
