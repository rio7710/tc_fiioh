"""Scene-scoped storyboard review orchestration.

The writer owns the complete document. Review workers may only return one
scene and cannot change identifiers, timing, narration, captions, or cue links.
This keeps parallel reviews from corrupting the global timeline contract.
"""
from __future__ import annotations

import copy
import hashlib
import json
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable
from tools.location_activity_validation import location_policy_context


IMMUTABLE_SCENE_FIELDS = (
    "id", "title", "start", "end", "media_type", "source_media",
    "reference_ids", "characters", "narration_cue_ids", "sequence",
    "narration", "caption",
)
MUTABLE_PROMPT_FIELDS = (
    "image_prompt", "camera", "lighting", "motion_prompt", "transition",
)


def _scene_list(document: dict[str, Any]) -> list[dict[str, Any]]:
    scenes = (((document.get("production") or {}).get("timeline") or {}).get("scenes"))
    if not isinstance(scenes, list) or not 12 <= len(scenes) <= 20:
        raise ValueError("씬 검수 전 전체 씬은 12~20개여야 합니다.")
    if any(not isinstance(scene, dict) for scene in scenes):
        raise ValueError("씬 검수 대상 형식이 올바르지 않습니다.")
    return scenes


def build_scene_review_prompt(
    document: dict[str, Any], index: int, validation_error: str = ""
) -> str:
    scenes = _scene_list(document)
    scene = scenes[index]
    production = document.get("production") or {}
    context = {
        "scene_index": index + 1,
        "scene_total": len(scenes),
        "location_activity_policy": json.loads(location_policy_context()),
        "previous_scene": scenes[index - 1] if index else None,
        "scene": scene,
        "next_scene": scenes[index + 1] if index + 1 < len(scenes) else None,
        "reference_assets": production.get("reference_assets") or [],
        "continuity": production.get("continuity") or {},
        "global_prompts": production.get("global_prompts") or {},
    }
    retry = f"\n이전 검수 응답 오류: {validation_error}" if validation_error else ""
    return (
        "너는 영상 제작용 콘티의 단일 씬 검수 API다. 작성 API 역할을 대신하지 말고 현재 scene 하나만 검수한다.\n"
        "검수 기준: 실제로 가능한 인물·사물 움직임, 인접 씬과 장소/동선/시선/카메라축 연속성, "
        "인물 수와 정체성 및 V2 우선 캐릭터 참조 일관성, 시설 참조 이미지 준수, 인접 구도 중복 방지, "
        "이미지와 영상 프롬프트의 자연스러움, 자막과 내레이션 불변, 계약 정책 준수.\n"
        "물리적으로 불가능한 동작, 정체성·장소·소품·카메라축 연속성 위반, 제작 실패를 유발할 명백한 계약 위반만 repair한다. "
        "취향 차이, 더 나은 표현 제안, 경미한 문체 개선은 pass로 처리해 불필요한 재작성을 만들지 않는다.\n"
        "문제가 없으면 {\"status\":\"pass\",\"issues\":[]}만 반환한다. "
        "문제가 있으면 {\"status\":\"repair\",\"issues\":[...],\"patch\":{\"image_prompt\":{\"text\":\"...\"}}}처럼 "
        "수정할 필드만 반환한다. 전체 scene을 다시 출력하지 않는다.\n"
        "patch에서는 image_prompt/camera/lighting/motion_prompt/transition의 text만 수정할 수 있다. "
        "id/title/start/end/media_type/source_media/reference_ids/characters/narration_cue_ids/sequence/narration/caption은 반환하거나 변경하지 않는다. "
        "reference_ids와 sequence는 확정된 구조이므로 이를 바꾸지 말고, 편집 가능한 프롬프트가 그 구조를 따르도록 고친다. "
        "오류와 직접 관계없는 필드는 바꾸지 않는다. JSON 객체 외 텍스트는 출력하지 않는다."
        f"{retry}\n검수 컨텍스트:\n{json.dumps(context, ensure_ascii=False)}"
    )


def _normalize_issues(value: Any) -> list[str]:
    """Accept common provider variations without weakening scene validation."""
    if value is None:
        return []
    if isinstance(value, str):
        text = value.strip()
        return [text[:500]] if text else []
    if isinstance(value, list):
        normalized: list[str] = []
        for item in value:
            normalized.extend(_normalize_issues(item))
        return normalized[:20]
    if isinstance(value, dict):
        for key in ("issues", "message", "detail", "reason", "issue", "description"):
            if key in value:
                normalized = _normalize_issues(value.get(key))
                if normalized:
                    return normalized
        text = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return [text[:500]] if text != "{}" else []
    text = str(value).strip()
    return [text[:500]] if text else []


def parse_scene_review(candidate: str, original: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    try:
        value = json.loads(str(candidate or ""))
    except json.JSONDecodeError as exc:
        raise ValueError(f"씬 검수 JSON 오류: {exc.msg}") from None
    if not isinstance(value, dict) or value.get("status") not in {"pass", "repair"}:
        raise ValueError("씬 검수 상태가 올바르지 않습니다.")
    issues = _normalize_issues(value.get("issues"))
    if value["status"] == "pass":
        return copy.deepcopy(original), []
    patch = value.get("patch")
    legacy_scene = value.get("scene")
    if patch is None and isinstance(legacy_scene, dict):
        # Backward compatibility for an in-flight response from the old
        # prompt: extract only editable prompt fields and ignore structural
        # rewrites instead of retrying the same useful review three times.
        if set(legacy_scene) - set(original):
            raise ValueError("씬 보정은 필드를 추가할 수 없습니다.")
        patch = {
            field: legacy_scene[field]
            for field in MUTABLE_PROMPT_FIELDS
            if field in legacy_scene and legacy_scene.get(field) != original.get(field)
        }
    if not isinstance(patch, dict) or not patch:
        raise ValueError("보정 응답에는 수정할 prompt patch가 필요합니다.")
    if not issues:
        issues = ["검수 API가 씬 보정을 요청했습니다."]
    invalid_fields = set(patch) - set(MUTABLE_PROMPT_FIELDS)
    if invalid_fields:
        raise ValueError(f"씬 보정 patch가 허용되지 않은 필드를 포함합니다: {sorted(invalid_fields)}")
    repaired = copy.deepcopy(original)
    for field, proposed in patch.items():
        current = repaired.get(field)
        if isinstance(proposed, str):
            proposed_text = proposed.strip()
        elif isinstance(proposed, dict) and set(proposed) == {"text"}:
            proposed_text = str(proposed.get("text") or "").strip()
        elif isinstance(proposed, dict) and set(proposed).issubset({"text", "source"}):
            proposed_text = str(proposed.get("text") or "").strip()
        else:
            raise ValueError(f"씬 보정 patch.{field}는 text만 수정할 수 있습니다.")
        if not proposed_text:
            raise ValueError(f"씬 보정 patch.{field}.text는 비어 있을 수 없습니다.")
        if isinstance(current, dict):
            updated = copy.deepcopy(current)
            updated["text"] = proposed_text
            repaired[field] = updated
        else:
            repaired[field] = proposed_text
    return repaired, list(issues)


def review_storyboard_scenes(
    document: dict[str, Any],
    request_review: Callable[[str], str],
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
    diagnostic_callback: Callable[[dict[str, Any]], None] | None = None,
    validate_reviewed_scene: Callable[[int, dict[str, Any]], None] | None = None,
    *,
    concurrency: int = 3,
    max_attempts: int = 3,
) -> dict[str, Any]:
    scenes = _scene_list(document)
    total = len(scenes)
    worker_count = max(1, min(int(concurrency), total))
    report_lock = threading.Lock()
    completed = 0
    reviewed_count = 0
    failed = 0
    repaired_count = 0

    def report(detail: str) -> None:
        if progress_callback:
            progress_callback({
                "phase": "scene_review", "percent": 58 + int(30 * completed / total),
                "detail": detail, "completed_scenes": completed,
                "total_scenes": total, "written_scenes": total,
                "reviewed_scenes": reviewed_count, "failed_scenes": failed,
            })

    def review_one(index: int) -> tuple[int, dict[str, Any], list[str]]:
        error = ""
        for attempt in range(1, max_attempts + 1):
            response = ""
            try:
                if attempt > 1:
                    with report_lock:
                        report(f"검증·보완 중 · {attempt}/{max_attempts}회 · {scenes[index].get('id', index + 1)}")
                response = request_review(build_scene_review_prompt(document, index, error))
                reviewed, issues = parse_scene_review(response, scenes[index])
                if validate_reviewed_scene:
                    validate_reviewed_scene(index, reviewed)
                if issues and diagnostic_callback:
                    diagnostic_callback({'event': 'scene_review_repaired',
                        'scene_id': scenes[index].get('id'), 'attempt': attempt,
                        'before_scene': scenes[index], 'after_scene': reviewed, 'issues': issues})
                return index, reviewed, issues
            except Exception as exc:
                error = str(exc)[:500]
                if diagnostic_callback:
                    encoded = str(response or "").encode("utf-8", errors="replace")
                    diagnostic_callback({
                        "event": "scene_review_attempt_failed",
                        "scene_id": str(scenes[index].get("id", index + 1)),
                        "scene_index": index + 1,
                        "attempt": attempt,
                        "error_type": type(exc).__name__,
                        "message": error,
                        "response_length": len(encoded),
                        "response_sha256": hashlib.sha256(encoded).hexdigest(),
                        "response_excerpt": str(response or "")[:2000],
                    })
        raise RuntimeError(f"{scenes[index].get('id', index + 1)} 씬 검수를 {max_attempts}회 완료하지 못했습니다: {error}")

    report(f"씬별 검수를 시작합니다. 완료 0/{total}")
    reviewed_scenes: dict[int, dict[str, Any]] = {}
    failures: list[str] = []
    with ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="scene-review") as executor:
        futures = {executor.submit(review_one, index): index for index in range(total)}
        for future in as_completed(futures):
            index = futures[future]
            try:
                resolved_index, reviewed, issues = future.result()
                reviewed_scenes[resolved_index] = reviewed
                with report_lock:
                    reviewed_count += 1
                    completed += 1
                    if issues:
                        repaired_count += 1
                    report(f"씬 검수 {completed}/{total} 완료")
            except Exception as exc:
                with report_lock:
                    reviewed_count += 1
                    failed += 1
                    failures.append(str(exc))
                    report(f"씬 검수 {completed}/{total} 완료 · 실패 {failed}")
    if failures:
        raise RuntimeError("씬별 검수를 완료하지 못했습니다. " + " / ".join(failures[:3]))
    for index, scene in reviewed_scenes.items():
        scenes[index] = scene
    return {
        "document": document,
        "written_scenes": total,
        "reviewed_scenes": reviewed_count,
        "completed_scenes": completed,
        "total_scenes": total,
        "failed_scenes": failed,
        "repaired_scenes": repaired_count,
    }
