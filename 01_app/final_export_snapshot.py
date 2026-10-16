"""Immutable final-export input contract and deterministic hashing."""

from __future__ import annotations

import hashlib
import json
from typing import Any, Mapping


SCHEMA_VERSION = "final-export-job.v2"


def _copy(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))


def canonical_hash(value: Any) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def narration_text_hash(text: str) -> str:
    return hashlib.sha256(str(text).strip().encode("utf-8")).hexdigest()[:16]


def _hashable_input(snapshot: Mapping[str, Any]) -> dict[str, Any]:
    return {
        key: value for key, value in snapshot.items()
        if key not in {"job_id", "input_hash", "idempotency_key"}
    }


def _require_text(value: Any, label: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{label} is required")
    return text


def _validate_assets(snapshot: Mapping[str, Any]) -> None:
    content = snapshot["content_data"]
    script = content.get("state", {}).get("script", {})
    timeline = content.get("timeline", {})
    scenes = timeline.get("scenes") or []
    if not scenes:
        raise ValueError("timeline scenes are required")
    scene_assets = snapshot["scene_assets"]
    assets_by_scene = {str(item.get("scene_id")): item for item in scene_assets}
    if len(assets_by_scene) != len(scene_assets):
        raise ValueError("scene assets must be unique")
    for scene in scenes:
        scene_id = _require_text(scene.get("id"), "scene_id")
        asset = assets_by_scene.get(scene_id)
        if not asset or asset.get("selected") is not True:
            raise ValueError(f"selected scene asset is missing: {scene_id}")
        if asset.get("media_type") != scene.get("media_type"):
            raise ValueError(f"scene media type mismatch: {scene_id}")
        _require_text(asset.get("uri"), f"scene asset uri: {scene_id}")
        _require_text(asset.get("checksum"), f"scene asset checksum: {scene_id}")
    if len(assets_by_scene) != len(scenes):
        raise ValueError("scene asset count does not match timeline")
    if not snapshot["render_settings"].get("narration"):
        return
    voices = {str(item.get("cue_id")): item for item in snapshot["voice_assets"]}
    if len(voices) != len(snapshot["voice_assets"]):
        raise ValueError("voice cues must be unique")
    lines = script.get("lines") or []
    expected = {}
    for scene in scenes:
        index = scene.get("script_line_index")
        cue_id = str(scene.get("narration_cue_id") or "")
        if index is not None and cue_id:
            if not isinstance(index, int) or index < 0 or index >= len(lines):
                raise ValueError(f"invalid script line index: {cue_id}")
            expected[cue_id] = narration_text_hash(lines[index])
    if set(voices) != set(expected):
        raise ValueError("voice cue set does not match timeline")
    profile_id = _require_text(snapshot.get("voice_profile_id"), "voice_profile_id")
    for cue_id, text_hash in expected.items():
        voice = voices[cue_id]
        if voice.get("profile_id") != profile_id:
            raise ValueError(f"voice profile mismatch: {cue_id}")
        if voice.get("text_hash") != text_hash:
            raise ValueError(f"voice text hash mismatch: {cue_id}")
        for key in ("profile_id", "uri", "checksum"):
            _require_text(voice.get(key), f"voice {key}: {cue_id}")


def verify_snapshot(value: Mapping[str, Any]) -> dict[str, Any]:
    snapshot = _copy(value)
    if snapshot.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("unsupported final export snapshot schema")
    for key in ("job_id", "user_id", "project_id", "revision_id"):
        _require_text(snapshot.get(key), key)
    _require_text(snapshot.get("voice_profile_id"), "voice_profile_id")
    if not isinstance(snapshot.get("requested_platforms"), list) or not snapshot["requested_platforms"]:
        raise ValueError("requested platforms are required")
    if len(set(snapshot["requested_platforms"])) != len(snapshot["requested_platforms"]):
        raise ValueError("requested platforms must be unique")
    expected_timeline_hash = canonical_hash(snapshot["content_data"])
    if snapshot.get("timeline_hash") != expected_timeline_hash:
        raise ValueError("timeline hash mismatch")
    _validate_assets(snapshot)
    expected_input_hash = canonical_hash(_hashable_input(snapshot))
    if snapshot.get("input_hash") != expected_input_hash:
        raise ValueError("final export input hash mismatch")
    expected_idempotency = canonical_hash({
        "user_id": snapshot["user_id"],
        "project_id": snapshot["project_id"],
        "revision_id": snapshot["revision_id"],
        "input_hash": expected_input_hash,
    })
    if snapshot.get("idempotency_key") != expected_idempotency:
        raise ValueError("final export idempotency key mismatch")
    return snapshot


def seal_snapshot(value: Mapping[str, Any]) -> dict[str, Any]:
    snapshot = _copy(value)
    snapshot["schema_version"] = SCHEMA_VERSION
    snapshot["timeline_hash"] = canonical_hash(snapshot["content_data"])
    snapshot["input_hash"] = canonical_hash(_hashable_input(snapshot))
    snapshot["idempotency_key"] = canonical_hash({
        "user_id": snapshot.get("user_id"),
        "project_id": snapshot.get("project_id"),
        "revision_id": snapshot.get("revision_id"),
        "input_hash": snapshot["input_hash"],
    })
    return verify_snapshot(snapshot)
