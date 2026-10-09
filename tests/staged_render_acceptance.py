"""Shared assertions for the staged FFmpeg renderer unit and isolated E2E tests."""

from __future__ import annotations

import json
import struct
import subprocess
from pathlib import Path


HERE = Path(__file__).resolve().parent
ACCEPTANCE_PATH = HERE / "fixtures" / "staged_render_acceptance.json"


def load_acceptance() -> dict:
    return json.loads(ACCEPTANCE_PATH.read_text(encoding="utf-8"))


def probe_media(path: Path, ffprobe: str = "ffprobe") -> dict:
    completed = subprocess.run(
        [
            ffprobe,
            "-v", "error",
            "-show_entries",
            "format=duration,format_name:stream=index,codec_type,codec_name,pix_fmt,width,height,r_frame_rate",
            "-of", "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    return json.loads(completed.stdout)


def assert_probe_matches(testcase, probe: dict, ratio: str, expected_duration: float) -> None:
    acceptance = load_acceptance()
    profile = acceptance["outputs"][ratio]
    streams = probe.get("streams") or []
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    testcase.assertIsNotNone(video, "final output must contain a video stream")
    testcase.assertIsNotNone(audio, "final output must contain an audio stream")
    testcase.assertEqual(acceptance["video"]["codec_name"], video.get("codec_name"))
    testcase.assertEqual(acceptance["video"]["pix_fmt"], video.get("pix_fmt"))
    testcase.assertEqual((profile["width"], profile["height"]), (video.get("width"), video.get("height")))
    testcase.assertEqual(acceptance["audio"]["codec_name"], audio.get("codec_name"))
    testcase.assertIn(acceptance["container"]["format_name_contains"], probe.get("format", {}).get("format_name", ""))
    tolerance = acceptance["duration_tolerance_frames"] / acceptance["fps"]
    actual_duration = float(probe.get("format", {}).get("duration", 0))
    testcase.assertLessEqual(
        abs(actual_duration - expected_duration),
        tolerance + 0.001,
        f"duration drift {actual_duration - expected_duration:+.6f}s exceeds one frame",
    )


def assert_faststart(testcase, path: Path) -> None:
    atoms = []
    file_size = path.stat().st_size
    with path.open("rb") as source:
        offset = 0
        while offset + 8 <= file_size:
            source.seek(offset)
            header = source.read(8)
            size, atom_type = struct.unpack(">I4s", header)
            header_size = 8
            if size == 1:
                extended = source.read(8)
                if len(extended) != 8:
                    break
                size = struct.unpack(">Q", extended)[0]
                header_size = 16
            elif size == 0:
                size = file_size - offset
            if size < header_size or offset + size > file_size:
                break
            atoms.append(atom_type)
            offset += size
    testcase.assertIn(b"moov", atoms, "MP4 moov atom is missing")
    testcase.assertIn(b"mdat", atoms, "MP4 mdat atom is missing")
    testcase.assertLess(atoms.index(b"moov"), atoms.index(b"mdat"), "MP4 must place moov before mdat (+faststart)")


def ffmpeg_input_count(command: list[str]) -> int:
    return sum(argument == "-i" for argument in command)
