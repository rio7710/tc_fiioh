import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
if str(ROOT / "01_app") not in sys.path:
    sys.path.insert(0, str(ROOT / "01_app"))

from staged_ffmpeg_renderer import StagedRenderDependencies, StagedRenderError, render_video_staged

from staged_render_acceptance import (
    assert_faststart,
    assert_probe_matches,
    ffmpeg_input_count,
    load_acceptance,
)


class StagedRenderAcceptanceContractTests(unittest.TestCase):
    def test_all_four_ratio_outputs_match_the_render_catalog(self):
        acceptance = load_acceptance()
        catalog = json.loads((ROOT / "config" / "render-catalog.json").read_text(encoding="utf-8"))
        self.assertEqual({"16x9", "9x16", "4x5", "1x1"}, set(acceptance["outputs"]))
        for ratio, expected in acceptance["outputs"].items():
            with self.subTest(ratio=ratio):
                platform = catalog["platforms"][expected["platform"]]
                self.assertEqual(ratio, platform["format"])
                self.assertEqual((expected["width"], expected["height"]), (platform["width"], platform["height"]))
                self.assertIn(expected["platform"], catalog["ratio_profiles"][ratio]["platforms"])

    def test_memory_and_process_fan_in_limits_are_explicit(self):
        acceptance = load_acceptance()
        self.assertEqual(768, acceptance["max_ffmpeg_peak_rss_mib"])
        self.assertEqual(2, acceptance["max_scene_inputs_per_process"])
        self.assertEqual(3, acceptance["max_visual_inputs_per_process"])
        self.assertEqual(2, ffmpeg_input_count(["ffmpeg", "-i", "left.mp4", "-i", "right.mp4", "out.mp4"]))

    def test_probe_assertion_accepts_exact_mobile_compatible_output(self):
        probe = {
            "streams": [
                {"codec_type": "video", "codec_name": "h264", "pix_fmt": "yuv420p", "width": 720, "height": 1280},
                {"codec_type": "audio", "codec_name": "aac"},
            ],
            "format": {"duration": "12.033", "format_name": "mov,mp4,m4a,3gp,3g2,mj2"},
        }
        assert_probe_matches(self, probe, "9x16", 12.0)

    def test_probe_assertion_rejects_more_than_one_frame_duration_drift(self):
        probe = {
            "streams": [
                {"codec_type": "video", "codec_name": "h264", "pix_fmt": "yuv420p", "width": 1280, "height": 720},
                {"codec_type": "audio", "codec_name": "aac"},
            ],
            "format": {"duration": "12.040", "format_name": "mp4"},
        }
        with self.assertRaises(AssertionError):
            assert_probe_matches(self, probe, "16x9", 12.0)

    def test_faststart_assertion_requires_moov_before_media_data(self):
        def atom(name, payload):
            return struct.pack(">I4s", len(payload) + 8, name) + payload

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ordered.mp4"
            path.write_bytes(atom(b"ftyp", b"isom") + atom(b"moov", b"metadata") + atom(b"mdat", b"payload"))
            assert_faststart(self, path)
            path.write_bytes(atom(b"ftyp", b"isom") + atom(b"mdat", b"payload") + atom(b"moov", b"metadata"))
            with self.assertRaises(AssertionError):
                assert_faststart(self, path)


class FakeRunner:
    def __init__(self, fail_stage=None):
        self.commands = []
        self.fail_stage = fail_stage

    def __call__(self, args, stage, line_callback):
        command = list(args)
        self.commands.append((stage, command))
        destination = Path(command[-1])
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"fixture-render-output")
        if stage == self.fail_stage:
            raise StagedRenderError(f"fixture failure: {stage}")
        if line_callback:
            line_callback("out_time_ms=6250000")


class StagedRendererUnitTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.exports = self.root / "exports"
        self.sources = self.root / "sources"
        self.sources.mkdir()
        for name in (
            "scene-1.png", "scene-2.png", "watermark.png", "intro.png", "outro-default.png",
            "outro-16x9.png", "outro-9x16.png", "outro-4x5.png", "outro-1x1.png", "caption.png",
        ):
            (self.sources / name).write_bytes(b"fixture")
        self.progress = []

    def tearDown(self):
        self.temp.cleanup()

    def dependencies(self, runner):
        acceptance = load_acceptance()
        platform_formats = {
            profile["platform"]: (profile["width"], profile["height"], ratio)
            for ratio, profile in acceptance["outputs"].items()
        }
        scenes = [
            {"id": "scene-1", "start": 0.0, "end": 1.0},
            {"id": "scene-2", "start": 1.0, "end": 2.25},
        ]
        title_scenes = [
            {"id": "scene-1", "cue_start": 0.0},
            {"id": "scene-2", "cue_start": 1.0},
        ]
        return StagedRenderDependencies(
            ffmpeg="fixture-ffmpeg",
            root=self.root,
            exports_dir=self.exports,
            platform_formats=platform_formats,
            music={"none": None},
            narration_tracks=[],
            render_defaults={"scene_dissolve_seconds": 0.3, "still_image_pan_enabled": True, "still_image_pan_travel_ratio": 0.35},
            timeline_from_data=lambda _data: scenes,
            timed_script_scenes=lambda _data: title_scenes,
            storyboard_image_path=lambda uri: self.sources / Path(str(uri)).name,
            scene_video_path=lambda *_args: self.sources / "unused.mp4",
            voice_audio_path=lambda uri: self.sources / Path(str(uri)).name,
            brand_asset_path=lambda uri: self.sources / Path(str(uri)).name,
            media_duration=lambda path: (
                6.25 if path.name == "final-output.mp4" or path.name.startswith("P1_final_") else 2.0
            ),
            prepare_caption_overlays=lambda *_args: [(self.sources / "caption.png", 0.0, 2.25)],
            update_progress=lambda job_id, **values: self.progress.append((job_id, values)),
            merged_demo_video=self.sources / "merged.mp4",
            command_runner=runner,
            minimum_output_bytes=1,
        )

    def config(self, platform):
        profiles = {
            ratio: {
                "uri": f"outro-{ratio}.png", "media_type": "image", "mime_type": "image/png",
                "width_ratio": 0.6, "position": "center-center", "background": "black",
                "background_opacity": 0.55,
            }
            for ratio in load_acceptance()["outputs"]
        }
        return {
            "type": "editorial", "music": "none", "volume": 0.5, "narration": False,
            "video_pan_x": 0.5, "caption_size": 0, "preview_platform": platform,
            "scene_dissolve_seconds": 0.3, "content_data": {"production": {"timeline": {}}},
            "scene_images": {
                "scene-1": {"uri": "scene-1.png"}, "scene-2": {"uri": "scene-2.png"},
            },
            "brand_selections": [
                {"role": "intro", "enabled": True, "uri": "intro.png", "media_type": "image"},
                {
                    "role": "watermark", "enabled": True, "uri": "watermark.png", "media_type": "image",
                    "settings": {"opacity": 0.7, "width_ratio": 0.2, "position": "top-right"},
                },
                {
                    "role": "outro", "enabled": True, "uri": "outro-default.png", "media_type": "image",
                    "settings": {"profiles": profiles},
                },
            ],
        }

    def test_all_ratios_use_bounded_stages_ratio_outro_and_mobile_mux(self):
        acceptance = load_acceptance()
        for ratio, profile in acceptance["outputs"].items():
            with self.subTest(ratio=ratio):
                runner = FakeRunner()
                dependencies = self.dependencies(runner)
                result = render_video_staged(
                    self.config(profile["platform"]), f"ratio-{ratio}", dependencies=dependencies
                )
                self.assertEqual((profile["width"], profile["height"]), (result["width"], result["height"]))
                self.assertEqual(6.25, result["duration"])
                self.assertEqual(2, result["scene_count"])

                commands = dict(runner.commands)
                scene_commands = [command for stage, command in runner.commands if stage.startswith("scene-")]
                self.assertTrue(scene_commands)
                self.assertTrue(all(ffmpeg_input_count(command) <= 2 for command in scene_commands))
                visual_commands = [
                    command for stage, command in runner.commands
                    if stage != "audio-mux" and stage not in {"body-concat", "body-decoration-concat", "brand-concat"}
                ]
                self.assertTrue(all(ffmpeg_input_count(command) <= 3 for command in visual_commands))

                decoration = next(command for stage, command in runner.commands if stage.startswith("body-decoration-"))
                decoration_graph = decoration[decoration.index("-filter_complex") + 1]
                self.assertLess(decoration_graph.index("[caption]overlay"), decoration_graph.index("[watermark]overlay"))
                self.assertIn("colorchannelmixer=aa=0.700", decoration_graph)

                outro = commands["brand-outro"]
                self.assertIn(str(self.sources / f"outro-{ratio}.png"), outro)
                outro_graph = outro[outro.index("-filter_complex") + 1]
                self.assertIn("drawbox=color=black@0.550", outro_graph)
                self.assertIn("overlay=(W-w)/2:(H-h)/2", outro_graph)

                mux = commands["audio-mux"]
                self.assertIn("-c:v", mux)
                self.assertEqual("copy", mux[mux.index("-c:v") + 1])
                self.assertEqual("aac", mux[mux.index("-c:a") + 1])
                self.assertEqual("+faststart", mux[mux.index("-movflags") + 1])
                self.assertFalse(list((self.exports / ".render_work").glob("staged-*")))

    def test_same_job_reuses_valid_final_without_running_ffmpeg(self):
        runner = FakeRunner()
        dependencies = self.dependencies(runner)
        config = self.config("youtube")
        first = render_video_staged(config, "stable/job", dependencies=dependencies)
        call_count = len(runner.commands)
        second = render_video_staged(config, "stable/job", dependencies=dependencies)
        self.assertEqual(first["path"], second["path"])
        self.assertEqual(call_count, len(runner.commands))
        self.assertIn("job_stable-job", first["filename"])
        self.assertEqual("succeeded", self.progress[-1][1]["status"])
        self.assertIn("재사용", self.progress[-1][1]["detail"])

    def test_failure_removes_partial_final_and_temporary_work(self):
        runner = FakeRunner(fail_stage="audio-mux")
        dependencies = self.dependencies(runner)
        with self.assertRaises(StagedRenderError):
            render_video_staged(self.config("youtube"), "failed-job", dependencies=dependencies)
        expected = self.exports / "P1_final_editorial_youtube_16x9_none_job_failed-job.mp4"
        self.assertFalse(expected.exists())
        self.assertFalse(list((self.exports / ".render_work").glob("staged-*")))
        self.assertEqual("failed", self.progress[-1][1]["status"])


if __name__ == "__main__":
    unittest.main()
