from __future__ import annotations

from typing import Any


class UnifiedContentError(ValueError):
    pass


def validate_timeline(document: dict[str, Any]) -> float:
    production = document.get("production")
    if production is None:
        if document.get("selected_variant_id") is not None:
            raise UnifiedContentError("selected_variant_id requires production")
        return 0.0
    scenes = production.get("timeline", {}).get("scenes", [])
    if not scenes:
        raise UnifiedContentError("production timeline requires scenes")
    selected = document.get("selected_variant_id")
    variant_ids = {item.get("id") for item in document.get("concept_variants", [])}
    if selected not in variant_ids:
        raise UnifiedContentError("selected_variant_id must reference a concept variant")
    seen: set[str] = set()
    reference_ids = {item.get("id") for item in production.get("reference_assets", [])}
    scene_by_id: dict[str, dict[str, Any]] = {}
    scene_order: list[str] = []
    expected_start = 0.0
    for index, scene in enumerate(scenes):
        scene_id = scene.get("id")
        if scene_id in seen:
            raise UnifiedContentError(f"duplicate scene id: {scene_id}")
        seen.add(scene_id)
        scene_by_id[scene_id] = scene
        scene_order.append(scene_id)
        if scene.get("media_type") not in {"image", "video"}:
            raise UnifiedContentError(f"invalid media_type: {scene_id}")
        scene_references = scene.get("reference_ids", [])
        if not scene_references or not set(scene_references) <= reference_ids:
            raise UnifiedContentError(f"unknown or missing Greenhill reference: {scene_id}")
        sequence = scene.get("sequence", {})
        expected_previous = None if index == 0 else scenes[index - 1].get("id")
        if sequence.get("continuity_from") != expected_previous:
            raise UnifiedContentError(f"invalid continuity_from: {scene_id}")
        start = float(scene.get("start", -1))
        end = float(scene.get("end", -1))
        if abs(start - expected_start) > 1e-6:
            raise UnifiedContentError(f"timeline gap or overlap before {scene_id}")
        if end <= start:
            raise UnifiedContentError(f"non-positive scene duration: {scene_id}")
        expected_start = end
    cues = production.get("narration_cues", [])
    if not cues:
        raise UnifiedContentError("production requires narration_cues")
    cue_ids: set[str] = set()
    referenced_cues: set[str] = set()
    for scene in scenes:
        values = scene.get("narration_cue_ids", [])
        if not values:
            raise UnifiedContentError(f"scene requires narration cue: {scene['id']}")
        referenced_cues.update(values)
    for cue in cues:
        cue_id = cue.get("id")
        if cue_id in cue_ids:
            raise UnifiedContentError(f"duplicate narration cue: {cue_id}")
        cue_ids.add(cue_id)
        if cue.get("narration", {}).get("text") != cue.get("caption", {}).get("text"):
            raise UnifiedContentError(f"caption must match narration: {cue_id}")
        ids = cue.get("scene_ids", [])
        if not ids or any(scene_id not in scene_by_id for scene_id in ids):
            raise UnifiedContentError(f"unknown scene in narration cue: {cue_id}")
        positions = [scene_order.index(scene_id) for scene_id in ids]
        if positions != list(range(positions[0], positions[-1] + 1)):
            raise UnifiedContentError(f"narration cue scenes must be contiguous: {cue_id}")
        if abs(float(cue.get("start", -1)) - float(scene_by_id[ids[0]]["start"])) > 1e-6 or abs(float(cue.get("end", -1)) - float(scene_by_id[ids[-1]]["end"])) > 1e-6:
            raise UnifiedContentError(f"narration cue must span referenced scenes: {cue_id}")
        if cue.get("timing_source") == "estimated_speech_rate" and (cue.get("measured_duration_seconds") is not None or cue.get("audio_uri") is not None):
            raise UnifiedContentError(f"estimated narration cue cannot have measured audio: {cue_id}")
    if referenced_cues != cue_ids:
        raise UnifiedContentError("scene narration cue references do not match narration_cues")
    return expected_start
