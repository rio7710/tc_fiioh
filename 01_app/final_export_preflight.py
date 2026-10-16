"""Revalidate immutable final-export assets immediately before rendering."""

from __future__ import annotations

from pathlib import Path
from typing import Callable, Mapping

from final_export_snapshot import verify_snapshot


def _expected_checksum(path: Path, expected: str, sha256_file: Callable[[Path], str]) -> None:
    if not path.is_file() or path.stat().st_size <= 0:
        raise FileNotFoundError(str(path))
    actual = str(sha256_file(path))
    if not actual.startswith("sha256:"):
        actual = "sha256:" + actual
    if actual != expected:
        raise ValueError(f"asset checksum mismatch: {path.name}")


def _brand_files(items, brand_path, sha256_file):
    for item in items:
        if item.get("uri"):
            path = brand_path(item["uri"])
            if not path:
                raise FileNotFoundError(f"brand asset is missing: {item.get('role')}")
            _expected_checksum(path, item.get("checksum"), sha256_file)
        profiles = (item.get("settings") or {}).get("profiles") or {}
        for ratio, profile in profiles.items():
            if not isinstance(profile, dict) or not profile.get("uri"):
                continue
            path = brand_path(profile["uri"])
            if not path:
                raise FileNotFoundError(f"brand profile is missing: {item.get('role')}:{ratio}")
            _expected_checksum(path, profile.get("checksum"), sha256_file)


def preflight_final_export_snapshot(
    value: Mapping,
    *, image_path: Callable, video_path: Callable, voice_path: Callable,
    brand_path: Callable, sha256_file: Callable, probe_video: Callable,
) -> dict:
    snapshot = verify_snapshot(value)
    scenes = snapshot["content_data"]["timeline"]["scenes"]
    by_scene = {item["scene_id"]: item for item in snapshot["scene_assets"]}
    for index, scene in enumerate(scenes):
        asset = by_scene[scene["id"]]
        if asset["media_type"] == "image":
            path = image_path(asset["uri"])
        else:
            path = video_path(scene, index, {scene["id"]: asset})
        if not path:
            raise FileNotFoundError(f"scene asset is missing: {scene['id']}")
        _expected_checksum(path, asset["checksum"], sha256_file)
        if asset["media_type"] == "video" and float(probe_video(path)) <= 0:
            raise ValueError(f"video duration is invalid: {scene['id']}")
    for voice in snapshot["voice_assets"]:
        path = voice_path(voice["uri"])
        if not path:
            raise FileNotFoundError(f"voice asset is missing: {voice['cue_id']}")
        _expected_checksum(path, voice["checksum"], sha256_file)
    _brand_files(snapshot["brand_assets"], brand_path, sha256_file)
    return snapshot
