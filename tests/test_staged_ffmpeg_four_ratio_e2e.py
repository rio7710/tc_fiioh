import json
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "01_app"))
from staged_ffmpeg_renderer import StagedRenderDependencies, render_video_staged


FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")
RATIOS = {
    "youtube": (1280, 720, "16x9"),
    "square": (1080, 1080, "1x1"),
    "instagram": (720, 1280, "9x16"),
    "facebook": (720, 900, "4x5"),
}


def make_png(path, color, size):
    subprocess.run([
        FFMPEG, "-y", "-loglevel", "error", "-f", "lavfi", "-i",
        f"color=c={color}:s={size}", "-frames:v", "1", "-update", "1",
        "-threads", "1", str(path),
    ], check=True, timeout=20)


def probe(path):
    result = subprocess.run([
        FFPROBE, "-v", "error", "-show_entries",
        "format=duration:stream=codec_type,codec_name,pix_fmt,width,height,r_frame_rate",
        "-of", "json", str(path),
    ], check=True, capture_output=True, text=True, timeout=20)
    return json.loads(result.stdout)


def assert_faststart(testcase, path):
    atoms, offset, size = [], 0, path.stat().st_size
    with path.open("rb") as source:
        while offset + 8 <= size:
            source.seek(offset)
            atom_size, atom_type = struct.unpack(">I4s", source.read(8))
            if atom_size == 1:
                atom_size = struct.unpack(">Q", source.read(8))[0]
            elif atom_size == 0:
                atom_size = size - offset
            if atom_size < 8 or offset + atom_size > size:
                break
            atoms.append(atom_type)
            offset += atom_size
    testcase.assertLess(atoms.index(b"moov"), atoms.index(b"mdat"))


@unittest.skipUnless(FFMPEG and FFPROBE, "FFmpeg and FFprobe are required")
class StagedFfmpegFourRatioE2E(unittest.TestCase):
    def test_real_ffmpeg_outputs_all_ratios(self):
        with tempfile.TemporaryDirectory(prefix="tc-staged-4ratio-") as directory:
            root = Path(directory)
            source = root / "source.png"
            caption = root / "caption.png"
            watermark = root / "watermark.png"
            make_png(source, "0x315c49", "640x360")
            make_png(caption, "0xf0dfbd@0.8", "120x40")
            make_png(watermark, "0xe97836@0.8", "80x32")
            outros = {}
            for index, (_, _, ratio) in enumerate(RATIOS.values()):
                path = root / f"outro-{ratio}.png"
                make_png(path, ("red", "green", "blue", "yellow")[index], "160x80")
                outros[ratio] = path
            exports = root / "exports"
            assets = {path.name: path for path in [watermark, *outros.values()]}
            scenes = [
                {"id": "s1", "start": 0.0, "end": 0.45, "media_type": "image",
                 "cue_start": 0.0, "cue_end": 0.45},
                {"id": "s2", "start": 0.45, "end": 0.9, "media_type": "image",
                 "cue_start": 0.45, "cue_end": 0.9},
            ]

            def duration(path):
                return float(probe(path)["format"]["duration"])

            deps = StagedRenderDependencies(
                ffmpeg=FFMPEG, root=root, exports_dir=exports,
                platform_formats=RATIOS, music={"none": None},
                render_defaults={"scene_dissolve_seconds": 0.3,
                                 "still_image_pan_enabled": True,
                                 "still_image_pan_travel_ratio": 0.175},
                timeline_from_data=lambda data: data["timeline"]["scenes"],
                timed_script_scenes=lambda data: data["timeline"]["scenes"],
                storyboard_image_path=lambda uri: source,
                scene_video_path=lambda *_args: root / "unused.mp4",
                voice_audio_path=lambda _uri: None,
                brand_asset_path=lambda uri: assets.get(Path(str(uri)).name),
                media_duration=duration,
                prepare_caption_overlays=lambda *_args: [(caption, 0.0, 0.9)],
                update_progress=lambda _job, **_values: None,
                ffmpeg_threads=1, render_preset="ultrafast",
                minimum_output_bytes=100,
            )
            profiles = {
                ratio: {"uri": path.name, "media_type": "image", "width_ratio": 0.65,
                        "background": "black", "background_opacity": 0.5}
                for ratio, path in outros.items()
            }
            for platform, (width, height, ratio) in RATIOS.items():
                with self.subTest(ratio=ratio):
                    config = {
                        "type": "editorial", "music": "none", "volume": 0.2,
                        "narration": False, "video_pan_x": 0.5, "caption_size": 0,
                        "preview_platform": platform, "scene_dissolve_seconds": 0.3,
                        "content_data": {"timeline": {"scenes": scenes}},
                        "scene_images": {"s1": {"uri": "a"}, "s2": {"uri": "b"}},
                        "brand_selections": [
                            {"role": "watermark", "enabled": True,
                             "uri": watermark.name, "media_type": "image"},
                            {"role": "outro", "enabled": True, "uri": outros[ratio].name,
                             "media_type": "image", "settings": {"profiles": profiles}},
                        ],
                    }
                    result = render_video_staged(config, f"e2e-{ratio}", dependencies=deps)
                    metadata = probe(result["path"])
                    video = next(s for s in metadata["streams"] if s["codec_type"] == "video")
                    audio = next(s for s in metadata["streams"] if s["codec_type"] == "audio")
                    self.assertEqual((width, height), (video["width"], video["height"]))
                    self.assertEqual(("h264", "yuv420p", "30/1"),
                                     (video["codec_name"], video["pix_fmt"], video["r_frame_rate"]))
                    self.assertEqual("aac", audio["codec_name"])
                    self.assertLessEqual(abs(float(metadata["format"]["duration"]) - 2.9), 1 / 30 + 0.001)
                    assert_faststart(self, result["path"])
                    self.assertFalse(list((exports / ".render_work").glob("staged-*")))
                    print(f"{ratio}: {result['path']} ({metadata['format']['duration']}s)")


if __name__ == "__main__":
    unittest.main()
