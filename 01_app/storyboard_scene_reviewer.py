"""Scene-scoped storyboard review orchestration.

The writer owns the complete document. Review workers may only return one
scene and cannot change identifiers, timing, narration, captions, or cue links.
This keeps parallel reviews from corrupting the global timeline contract.
"""
from __future__ import annotations

import copy
import json
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable


IMMUTABLE_SCENE_FIELDS = (
    "id", "start", "end", "media_type", "source_media",
    "narration_cue_ids", "narration", "caption",
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
        "문제가 없으면 {\"status\":\"pass\",\"issues\":[]}만 반환한다. "
        "문제가 있으면 {\"status\":\"repair\",\"issues\":[...],\"scene\":{수정된 전체 scene}}를 반환한다.\n"
        "repair에서도 id/start/end/media_type/source_media/narration_cue_ids/narration/caption은 입력과 완전히 같아야 한다. "
        "오류와 직접 관계없는 필드는 바꾸지 않는다. JSON 객체 외 텍스트는 출력하지 않는다."
        f"{retry}\n검수 컨텍스트:\n{json.dumps(context, ensure_ascii=False)}"
    )


def parse_scene_review(candidate: str, original: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    try:
        value = json.loads(str(candidate or ""))
    except json.JSONDecodeError as exc:
        raise ValueError(f"씬 검수 JSON 오류: {exc.msg}") from None
    if not isinstance(value, dict) or value.get("status") not in {"pass", "repair"}:
        raise ValueError("씬 검수 상태가 올바르지 않습니다.")
    issues = value.get("issues") or []
    if not isinstance(issues, list) or any(not isinstance(item, str) for item in issues):
        raise ValueError("씬 검수 이슈 형식이 올바르지 않습니다.")
    if value["status"] == "pass":
        if issues:
            raise ValueError("통과 응답에는 검수 이슈가 없어야 합니다.")
        return copy.deepcopy(original), []
    repaired = value.get("scene")
    if not isinstance(repaired, dict) or not issues:
        raise ValueError("보정 응답에는 이슈와 수정된 전체 씬이 필요합니다.")
    if set(repaired) != set(original):
        raise ValueError("씬 보정은 필드를 추가하거나 제거할 수 없습니다.")
    for field in IMMUTABLE_SCENE_FIELDS:
        if repaired.get(field) != original.get(field):
            raise ValueError(f"씬 보정이 불변 필드 {field}를 변경했습니다.")
    return copy.deepcopy(repaired), list(issues)


def review_storyboard_scenes(
    document: dict[str, Any],
    request_review: Callable[[str], str],
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
    *,
    concurrency: int = 3,
    max_attempts: int = 3,
) -> dict[str, Any]:
    scenes = _scene_list(document)
    total = len(scenes)
    worker_count = max(1, min(int(concurrency), total))
    report_lock = threading.Lock()
    completed = 0
    failed = 0
    repaired_count = 0

    def report(detail: str) -> None:
        if progress_callback:
            progress_callback({
                "phase": "scene_review", "percent": 58 + int(30 * completed / total),
                "detail": detail, "completed_scenes": completed,
                "total_scenes": total, "failed_scenes": failed,
            })

    def review_one(index: int) -> tuple[int, dict[str, Any], list[str]]:
        error = ""
        for _attempt in range(1, max_attempts + 1):
            try:
                response = request_review(build_scene_review_prompt(document, index, error))
                reviewed, issues = parse_scene_review(response, scenes[index])
                return index, reviewed, issues
            except Exception as exc:
                error = str(exc)[:500]
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
                    completed += 1
                    if issues:
                        repaired_count += 1
                    report(f"씬 검수 {completed}/{total} 완료")
            except Exception as exc:
                with report_lock:
                    failed += 1
                    failures.append(str(exc))
                    report(f"씬 검수 {completed}/{total} 완료 · 실패 {failed}")
    if failures:
        raise RuntimeError("씬별 검수를 완료하지 못했습니다. " + " / ".join(failures[:3]))
    for index, scene in reviewed_scenes.items():
        scenes[index] = scene
    return {
        "document": document,
        "completed_scenes": completed,
        "total_scenes": total,
        "failed_scenes": failed,
        "repaired_scenes": repaired_count,
    }
