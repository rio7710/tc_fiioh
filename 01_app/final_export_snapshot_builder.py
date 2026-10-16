"""Build a final-export snapshot from one confirmed project revision."""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any, Callable, Mapping

from final_export_snapshot import seal_snapshot


def _checksum(path: Path, sha256_file: Callable[[Path], str]) -> str:
    if not path.is_file() or path.stat().st_size <= 0:
        raise FileNotFoundError("자산 파일이 아직 준비되지 않았습니다.")
    digest = str(sha256_file(path))
    return digest if digest.startswith("sha256:") else "sha256:" + digest


def _selected(rows: list[dict]) -> dict[str, dict]:
    selected = {}
    for row in rows:
        if row.get("selected") is not True:
            continue
        scene_id = str(row.get("scene_id") or "")
        if not scene_id or scene_id in selected:
            raise ValueError("selected scene artifacts must be unique")
        selected[scene_id] = row
    return selected


def _crop_positions(value: Any) -> dict[str, dict[str, float]]:
    result = {}
    if not isinstance(value, Mapping):
        return result
    for scene_id, formats in list(value.items())[:200]:
        if not isinstance(formats, Mapping):
            continue
        result[str(scene_id)[:100]] = {
            ratio: max(0.0, min(1.0, float(formats.get(ratio, 50)) / 100))
            for ratio in ("9x16", "4x5")
        }
    return result


def _brand_assets(selections, brand_path, sha256_file):
    frozen = []
    for selection in selections:
        if not selection.get("enabled"):
            continue
        item = copy.deepcopy(selection)
        resolved = 0
        if item.get("uri"):
            path = brand_path(item["uri"])
            if not path:
                raise FileNotFoundError(f"brand asset is missing: {item.get('role')}")
            item["checksum"] = _checksum(path, sha256_file)
            resolved += 1
        profiles = (item.get("settings") or {}).get("profiles") or {}
        for ratio, profile in profiles.items():
            if not isinstance(profile, dict) or not profile.get("uri"):
                continue
            path = brand_path(profile["uri"])
            if not path:
                raise FileNotFoundError(f"brand profile is missing: {item.get('role')}:{ratio}")
            profile["checksum"] = _checksum(path, sha256_file)
            resolved += 1
        if not resolved:
            raise FileNotFoundError(f"enabled brand asset has no file: {item.get('role')}")
        frozen.append(item)
    return frozen


def _voice_assets(voices, expected_cues, profile_id, voice_path, sha256_file):
    frozen = []
    seen = set()
    for voice in voices:
        cue_id = str(voice.get("cue_id") or "")
        if cue_id not in expected_cues:
            continue
        if str(voice.get("profile_id") or "") != profile_id:
            continue
        if cue_id in seen:
            raise ValueError(f"나레이션 cue가 중복됩니다: {cue_id}")
        path = voice_path(voice.get("uri"))
        if not path:
            raise FileNotFoundError(f"나레이션 파일이 없습니다: {cue_id}")
        frozen.append({**copy.deepcopy(voice), "checksum": _checksum(path, sha256_file)})
        seen.add(cue_id)
    return frozen


def build_final_export_snapshot(
    *, job_id: str, user_id: str, project_id: str, payload: Mapping[str, Any], store: Any,
    document_view: Callable, retime_timeline: Callable, resolve_settings: Callable,
    image_path: Callable, video_path: Callable, voice_path: Callable, brand_path: Callable,
    sha256_file: Callable, platform_formats: Mapping[str, Any], render_setting_keys: set[str],
) -> dict[str, Any]:
    revision = store.latest_stage_data(user_id, project_id, 3)
    document = (revision or {}).get("data", {}).get("document")
    if not revision or not isinstance(document, dict):
        raise ValueError("최종 출력할 콘텐츠 대본을 찾을 수 없습니다.")
    if revision.get("status") != "confirmed":
        raise ValueError("확정된 대본 리비전만 최종 출력할 수 있습니다.")
    requested_revision = str(payload.get("revision_id") or "")
    if requested_revision and requested_revision != revision["revision_id"]:
        raise ValueError("요청한 대본 리비전이 최신 확정본과 일치하지 않습니다.")
    script, timeline = document_view(document)
    voices = store.list_scene_voice_clips(user_id, project_id, revision["revision_id"])
    profile_id = str(revision["data"].get("voice_profile") or "warm_female")
    expected_cues = {
        str(scene.get("narration_cue_id") or "")
        for scene in timeline.get("scenes") or []
        if scene.get("script_line_index") is not None and scene.get("narration_cue_id")
    }
    eligible_voices = [
        voice for voice in voices
        if str(voice.get("cue_id") or "") in expected_cues
        and str(voice.get("profile_id") or "") == profile_id
    ]
    timeline = copy.deepcopy(retime_timeline(timeline, eligible_voices))
    content_data = {"state": {"script": script}, "timeline": timeline}
    explicit = {key: payload[key] for key in render_setting_keys if key in payload}
    settings = resolve_settings(user_id, explicit)
    requested = payload.get("platforms", settings.get("platforms"))
    if not isinstance(requested, list):
        raise ValueError("플랫폼 선택 정보가 올바르지 않습니다.")
    platforms = list(dict.fromkeys(str(item) for item in requested))
    if not platforms or any(item not in platform_formats for item in platforms):
        raise ValueError("출력할 플랫폼을 한 개 이상 선택해 주세요.")
    images = _selected(store.list_scene_image_candidates(user_id, project_id, revision["revision_id"]))
    videos = _selected(store.list_scene_video_candidates(user_id, project_id, revision["revision_id"]))
    scene_assets = []
    for index, scene in enumerate(timeline.get("scenes") or []):
        scene_id = str(scene.get("id") or "")
        # Script media_type is a production plan, not evidence of a generated
        # clip. Resolve output from selected artifacts, matching preview.
        media_type = "video" if scene_id in videos else "image"
        artifact = (images if media_type == "image" else videos).get(scene_id)
        if not artifact:
            raise FileNotFoundError(f"선택된 {media_type} 자산이 없습니다: {scene_id}")
        path = image_path(artifact.get("uri")) if media_type == "image" else video_path(
            scene, index, {scene_id: artifact},
        )
        if not path:
            raise FileNotFoundError(f"장면 자산 파일이 없습니다: {scene_id}")
        scene["media_type"] = media_type
        scene_assets.append({
            **copy.deepcopy(artifact), "scene_id": scene_id, "media_type": media_type,
            "selected": True, "checksum": _checksum(path, sha256_file),
        })
    voice_assets = []
    if settings.get("narration"):
        voice_assets = _voice_assets(
            eligible_voices, expected_cues, profile_id, voice_path, sha256_file,
        )
    crop_source = payload.get("scene_crop_positions") or store.scene_crop_positions(user_id, project_id)
    return seal_snapshot({
        "job_id": job_id, "user_id": user_id, "project_id": project_id,
        "revision_id": revision["revision_id"], "render_settings": settings,
        "voice_profile_id": profile_id,
        "content_data": content_data, "scene_assets": scene_assets,
        "voice_assets": voice_assets,
        "brand_assets": _brand_assets(store.content_brand_selections(user_id, project_id), brand_path, sha256_file),
        "scene_crop_positions": _crop_positions(crop_source),
        "requested_platforms": platforms,
    })
