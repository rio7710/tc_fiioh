from __future__ import annotations

import json
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Callable

from tools.validate_unified_content import UnifiedContentError, validate_timeline
from tools.validate_json_schema import JsonSchemaError, validate_json_schema_file


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "contracts" / "unified-content-production.schema.json"
PROMPT_PATH = ROOT / "prompts" / "unified_content_production_v1.md"
REFERENCE_DIR = ROOT / "docs" / "reference_samples"
PRODUCTION_SECTION_KEYS = (
    "reference_assets", "continuity", "global_prompts", "timing_policy",
    "timeline", "narration_cues", "postproduction", "output",
)
MAX_VALIDATION_REPAIRS = 3


def parse_json_document(candidate: str) -> dict[str, Any]:
    text = str(candidate or "").strip()
    decoder = json.JSONDecoder()
    try:
        value, end = decoder.raw_decode(text)
    except json.JSONDecodeError as exc:
        raise UnifiedContentError(f"invalid JSON: {exc.msg}") from None
    if text[end:].strip():
        raise UnifiedContentError("model output contains prose outside the JSON document")
    if not isinstance(value, dict):
        raise UnifiedContentError("model output must be one JSON object")
    return value


def _complete_missing_source(value: Any) -> None:
    """Label unsourced generated text as inferred instead of guessing provenance."""
    if isinstance(value, dict):
        if "text" in value and "source" not in value:
            value["source"] = "ai_inferred"
        for child in value.values():
            _complete_missing_source(child)
    elif isinstance(value, list):
        for child in value:
            _complete_missing_source(child)


def normalize_document_shape(document: dict[str, Any]) -> dict[str, Any]:
    """Repair a common provider error without changing generated content.

    The schema places all production data inside production, but models
    occasionally emit complete sections (especially timeline and timing_policy)
    at the document root. Move misplaced sections without losing conflicts.
    """
    # The only version accepted by this harness is the contract it validates
    # below. Models occasionally echo a model/version label here instead.
    document["schema_version"] = "1.0.0"
    project = document.get("project") if isinstance(document.get("project"), dict) else {}
    selected_keywords = project.get("selected_keywords")
    if not isinstance(selected_keywords, list):
        selected_keywords = []
    concepts = document.get("concept_variants")
    if not isinstance(concepts, list):
        concepts = []
    normalized_concepts = []
    for index, item in enumerate(concepts):
        concept = item if isinstance(item, dict) else {}
        keywords = concept.get("keywords")
        if not isinstance(keywords, list) or not keywords:
            keywords = list(selected_keywords)
        title = str(concept.get("title") or project.get("title") or f"콘셉트 {index + 1}").strip()
        normalized_concepts.append({
            "id": f"concept-{index + 1:02d}",
            "title": title,
            "theme": str(concept.get("theme") or "선택 키워드를 일상의 장면으로 전달한다.").strip(),
            "lead": str(concept.get("lead") or "인물의 자연스러운 하루를 따라간다.").strip(),
            "story_method": str(concept.get("story_method") or "연속된 관찰형 장면으로 전개한다.").strip(),
            "visual_tone": str(concept.get("visual_tone") or "따뜻하고 절제된 실사 시네마틱 톤").strip(),
            "core_message": str(concept.get("core_message") or title).strip(),
            "keywords": keywords,
            "source": concept.get("source") if concept.get("source") in {"provided", "ai_inferred"} else "ai_inferred",
        })
    if normalized_concepts:
        document["concept_variants"] = normalized_concepts
        selected_variant_id = document.get("selected_variant_id")
        valid_concept_ids = {item["id"] for item in normalized_concepts}
        if selected_variant_id not in valid_concept_ids:
            document["selected_variant_id"] = normalized_concepts[0]["id"]
    production = document.get("production")
    if not isinstance(production, dict):
        return document
    for key in PRODUCTION_SECTION_KEYS:
        if key not in document:
            continue
        if key in production and production[key] != document[key]:
            raise UnifiedContentError(
                f"root {key} conflicts with production.{key}; refusing to discard either value"
            )
        if key not in production:
            production[key] = document[key]
        del document[key]
    _complete_missing_source(production)
    continuity = production.get("continuity")
    if not isinstance(continuity, dict):
        continuity = {}
    production["continuity"] = {
        key: continuity.get(key) if isinstance(continuity.get(key), list) else []
        for key in ("characters", "locations", "props")
    }
    global_prompts = production.get("global_prompts")
    if not isinstance(global_prompts, dict):
        global_prompts = {}
    prompt_defaults = {
        "style": "참조 자산의 인물·장소 정체성을 유지하는 자연스러운 실사 시네마틱 스타일.",
        "negative": "글자, 로고, 워터마크, 왜곡, 중복 인물, 공간 순간이동, 반복 입장을 금지한다.",
    }
    production["global_prompts"] = {
        key: (
            value if isinstance((value := global_prompts.get(key)), dict)
            else {"text": value.strip(), "source": "ai_inferred"}
            if isinstance(value, str) and value.strip()
            else {"text": text, "source": "ai_inferred"}
        )
        for key, text in prompt_defaults.items()
    }
    timing_policy = production.get("timing_policy")
    if not isinstance(timing_policy, dict):
        timing_policy = {}
    characters_per_second = timing_policy.get("estimated_characters_per_second")
    if (
        isinstance(characters_per_second, bool)
        or not isinstance(characters_per_second, (int, float))
        or not 3 <= characters_per_second <= 8
    ):
        characters_per_second = 4.5
    production["timing_policy"] = {
        "planning_source": "estimated_speech_rate",
        "final_source": "tts_measured_duration",
        "estimated_characters_per_second": characters_per_second,
        "reconciliation": "retime_timeline_narration_captions_transitions_and_export",
    }
    production["output"] = {
        "video_codec": "h264",
        "audio_codec": "aac",
        "pixel_format": "yuv420p",
        "faststart": True,
    }
    timeline = production.get("timeline")
    if isinstance(timeline, list):
        timeline = {"scenes": timeline}
        production["timeline"] = timeline
    if not isinstance(timeline, dict):
        return document
    timeline.setdefault("duration_source", "timeline.scenes[-1].end")
    scenes = timeline.get("scenes", [])
    if not isinstance(scenes, list):
        return document
    narration_cues = production.get("narration_cues", [])
    if not isinstance(narration_cues, list):
        narration_cues = []
        production["narration_cues"] = narration_cues
    reference_ids = [
        item.get("id") for item in production.get("reference_assets", [])
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    ]
    postproduction = production.get("postproduction")
    if not isinstance(postproduction, dict):
        postproduction = {}
        production["postproduction"] = postproduction
    postproduction_defaults = {
        "captions": "나레이션 문장을 그대로 사용하고 화면 안전영역 안에 배치한다.",
        "voice": "저장된 사용자 음성 프로필과 측정된 오디오 길이를 사용한다.",
        "bgm": "나레이션을 방해하지 않도록 낮은 음량으로 유지한다.",
        "transitions": "장면 연결은 짧은 컷 또는 디졸브로 처리한다.",
    }
    production["postproduction"] = {
        key: (
            value if isinstance((value := postproduction.get(key)), dict)
            else {"text": value.strip(), "source": "ai_inferred"}
            if isinstance(value, str) and value.strip()
            else {"text": text, "source": "ai_inferred"}
        )
        for key, text in postproduction_defaults.items()
    }
    for index, scene in enumerate(scenes):
        if not isinstance(scene, dict):
            continue
        title = str(scene.get("title") or f"장면 {index + 1}").strip()
        scene["title"] = title
        scene.setdefault("media_type", "image")
        scene.setdefault("source_media", None)
        if not isinstance(scene.get("reference_ids"), list) or not scene.get("reference_ids"):
            scene["reference_ids"] = list(reference_ids)
        if not isinstance(scene.get("characters"), list):
            scene["characters"] = []
        if not isinstance(scene.get("narration_cue_ids"), list) or not scene.get("narration_cue_ids"):
            scene_start, scene_end = scene.get("start"), scene.get("end")
            matching_cues = [
                cue.get("id") for cue in narration_cues
                if isinstance(cue, dict)
                and isinstance(cue.get("id"), str)
                and (
                    scene.get("id") in (cue.get("scene_ids") or [])
                    or (
                        isinstance(scene_start, (int, float))
                        and isinstance(scene_end, (int, float))
                        and isinstance(cue.get("start"), (int, float))
                        and isinstance(cue.get("end"), (int, float))
                        and scene_start < cue["end"]
                        and scene_end > cue["start"]
                    )
                )
            ]
            if not matching_cues and narration_cues:
                fallback_cue = narration_cues[min(index, len(narration_cues) - 1)]
                if isinstance(fallback_cue, dict) and isinstance(fallback_cue.get("id"), str):
                    matching_cues = [fallback_cue["id"]]
            scene["narration_cue_ids"] = matching_cues
        previous_id = scenes[index - 1].get("id") if index else None
        sequence = scene.get("sequence")
        if not isinstance(sequence, dict):
            sequence = {}
        allowed_camera_motions = {
            "fixed", "zoom_in", "zoom_out", "dolly_in", "dolly_out",
            "pan", "tilt", "tracking", "match_cut", "cutaway",
        }
        if sequence.get("camera_motion") not in allowed_camera_motions:
            sequence["camera_motion"] = "fixed"
        if sequence.get("camera_axis_transition") not in {"establish", "same_side", "motivated_cross"}:
            sequence["camera_axis_transition"] = "establish" if index == 0 else "same_side"
        sequence.setdefault("continuity_from", previous_id)
        sequence.setdefault("entry_action", "직전 씬의 위치와 동작을 자연스럽게 이어받는다." if index else "확정된 첫 위치에서 자연스럽게 시작한다.")
        sequence.setdefault("exit_action", "현재 진행 방향을 유지하며 다음 동작으로 이어진다.")
        sequence.setdefault("camera_bridge", "직전 씬의 화면 축·인물 위치·시선 방향을 유지한다.")
        sequence.setdefault("continuity_anchor", "인물의 현재 구역, 이미 통과한 경계, 이동 방향과 소품 상태를 직전 씬에서 상속한다.")
        sequence.setdefault("character_blocking", "인물의 좌우 배치와 이동 방향을 유지하고 문 앞 왕복·반복 입장을 금지한다.")
        scene["sequence"] = {
            key: sequence[key] for key in (
                "continuity_from", "entry_action", "exit_action", "camera_motion",
                "camera_bridge", "continuity_anchor", "character_blocking",
                "camera_axis_transition",
            )
        }

        references = ", ".join(str(item) for item in scene.get("reference_ids", []))
        camera_palette = (
            ("24mm 눈높이 공간 확립 와이드숏, 고정", "fixed"),
            ("70mm 손과 핵심 소품 디테일 클로즈업, 아주 느린 돌리인", "dolly_in"),
            ("35mm 3/4 측면 미디엄숏, 행동 방향을 따르는 짧은 트래킹", "tracking"),
            ("85mm 표정 반응 클로즈업, 고정", "fixed"),
            ("28mm 주인공 어깨너머로 다음 행동과 공간을 여는 오버숄더 와이드", "pan"),
            ("50mm 두 인물의 시선과 손을 함께 담는 미디엄 투숏, 느린 돌리아웃", "dolly_out"),
            ("90mm 손·소품의 결과를 보여주는 매크로 인서트, 고정", "fixed"),
            ("40mm 상대의 반응을 분리해 보여주는 3/4 리액션숏, 짧은 팬", "pan"),
            ("32mm 이동 방향과 공간 깊이를 함께 담는 측면 와이드, 느린 트래킹", "tracking"),
            ("55mm 주인공 중심 엔딩 미디엄 클로즈업, 아주 느린 줌인", "zoom_in"),
        )
        camera_text, camera_motion = camera_palette[index % len(camera_palette)]
        previous_camera = _text(scenes[index - 1].get("camera")) if index else ""
        current_camera = _text(scene.get("camera"))
        camera_is_missing_or_repeated = not current_camera.strip() or current_camera.strip() == previous_camera.strip()
        if camera_is_missing_or_repeated:
            scene["camera"] = {
                "text": f"{camera_text}. 직전 씬과 화면 크기·각도·주 피사체가 분명히 다르다.",
                "source": "ai_inferred",
            }
            scene["sequence"]["camera_motion"] = camera_motion
        motion_is_missing_or_repeated = not _text(scene.get("motion_prompt")).strip()
        if index and _text(scene.get("motion_prompt")).strip() == _text(scenes[index - 1].get("motion_prompt")).strip():
            motion_is_missing_or_repeated = True
        defaults = {
            "image_prompt": f"{title}. 참조 자산({references})의 인물 정체성·의상·공간 구조·조명을 유지하고, 직전 씬의 현재 위치와 진행 방향을 이어받는 실사 시네마틱 씬. 문 앞 왕복, 반복 입장, 공간 순간이동, 글자와 로고 금지.",
            "camera": f"{camera_text}. 직전 씬과 화면 크기·각도·주 피사체가 분명히 다르다.",
            "lighting": "참조 장소와 직전 씬의 광원 방향·노출·색온도를 그대로 유지한다.",
            "motion_prompt": f"현재 승인 이미지의 인물·공간·소품을 고정하고, '{title}' 장면의 핵심 행동 하나만 작고 자연스럽게 이어간다. {scene['sequence']['exit_action']} 프리즈·루프·장소 변경·립싱크 금지.",
            "transition": "장면 전환은 생성 후 편집 단계에서 짧은 디졸브 또는 컷으로 처리한다.",
        }
        for key, text in defaults.items():
            if not isinstance(scene.get(key), dict) or (key == "motion_prompt" and motion_is_missing_or_repeated):
                scene[key] = {"text": text, "source": "ai_inferred"}
    scene_by_id = {scene.get("id"): scene for scene in scenes if isinstance(scene, dict)}
    for cue in production.get("narration_cues", []):
        if not isinstance(cue, dict):
            continue
        # A provider sometimes emits the shorthand {"text": ..., "source": ...}
        # at cue level. ``_complete_missing_source`` may also complete that pair
        # before the text is promoted into narration. Neither shorthand key is
        # part of the canonical narrationCue contract.
        cue_source = cue.pop("source", None)
        cue_id = cue.get("id")
        linked_scenes = [
            scene for scene in scenes
            if isinstance(scene, dict) and cue_id in (scene.get("narration_cue_ids") or [])
        ]
        if not isinstance(cue.get("scene_ids"), list) or not cue.get("scene_ids"):
            explicit_scene = cue.pop("scene_id", None)
            cue["scene_ids"] = (
                [explicit_scene] if explicit_scene in scene_by_id
                else [scene.get("id") for scene in linked_scenes if scene.get("id")]
            )
        for field in ("narration", "caption"):
            current = cue.get(field)
            if isinstance(current, str) and current.strip():
                cue[field] = {"text": current.strip(), "source": "ai_inferred"}
                continue
            if isinstance(current, dict) and str(current.get("text", "")).strip():
                continue
            alias = cue.pop("text", None) if field == "narration" else None
            candidates = [alias] if alias else [scene.get(field) for scene in linked_scenes]
            normalized = [_text(item).strip() for item in candidates if _text(item).strip()]
            if normalized and len(set(normalized)) == 1:
                cue[field] = {
                    "text": normalized[0],
                    "source": cue_source if cue_source in {"provided", "ai_inferred"} else "ai_inferred",
                }
        if not isinstance(cue.get("caption"), dict) and isinstance(cue.get("narration"), dict):
            cue["caption"] = json.loads(json.dumps(cue["narration"], ensure_ascii=False))
        cue.setdefault("timing_source", "estimated_speech_rate")
        cue.setdefault("measured_duration_seconds", None)
        cue.setdefault("audio_uri", None)
        cue_start, cue_end = cue.get("start"), cue.get("end")
        if (
            "estimated_duration_seconds" not in cue
            and isinstance(cue_start, (int, float))
            and isinstance(cue_end, (int, float))
            and cue_end > cue_start
        ):
            cue["estimated_duration_seconds"] = round(cue_end - cue_start, 3)
        ids = cue.get("scene_ids", [])
        if not isinstance(ids, list) or not ids or any(scene_id not in scene_by_id for scene_id in ids):
            continue
        if any(cue.get("id") not in scene_by_id[scene_id].get("narration_cue_ids", []) for scene_id in ids):
            continue
        positions = [next(i for i, scene in enumerate(scenes) if scene.get("id") == scene_id) for scene_id in ids]
        if positions != list(range(positions[0], positions[-1] + 1)):
            continue
        start, end = scene_by_id[ids[0]].get("start"), scene_by_id[ids[-1]].get("end")
        if isinstance(start, (int, float)) and isinstance(end, (int, float)) and end > start:
            cue["start"], cue["end"] = start, end
            if cue.get("timing_source") == "estimated_speech_rate":
                cue["estimated_duration_seconds"] = round(end - start, 3)
    return document


def reference_context(limit: int = 4) -> str:
    summaries = []
    for path in sorted(REFERENCE_DIR.glob("*_STANDARD_v1.md"))[:limit]:
        text = path.read_text(encoding="utf-8")
        title = text.splitlines()[0].removeprefix("# ")
        keywords = next((line for line in text.splitlines() if "selected_keywords" in line), "")
        summaries.append(f"- {title}\n  {keywords}")
    return "\n".join(summaries)


def narrative_fingerprint(document: dict[str, Any]) -> str:
    production = document.get("production") or {}
    scenes = production.get("timeline", {}).get("scenes", [])
    cues = production.get("narration_cues", [])
    concepts = document.get("concept_variants", [])
    parts = [
        " / ".join(str(item.get("story_method", "")) for item in concepts),
        " / ".join(str(scene.get("title", "")) for scene in scenes),
        " / ".join(str(cue.get("narration", {}).get("text", "")) for cue in cues),
    ]
    return "\n".join(parts).strip()


def prior_output_context(documents: list[dict[str, Any]], limit: int = 5) -> str:
    if not documents:
        return "과거 동일 키워드 결과 없음"
    summaries = []
    for item in documents[-limit:]:
        summaries.append(f"- document_id={item.get('document_id', 'unknown')}\n  {narrative_fingerprint(item)}")
    return "\n".join(summaries)


def build_prompt(
    selected_keywords: list[str], source_material: str,
    previous_documents: list[dict[str, Any]] | None = None,
    reference_material: str | None = None,
) -> str:
    if not 1 <= len(selected_keywords) <= 5 or len(set(selected_keywords)) != len(selected_keywords):
        raise UnifiedContentError("selected_keywords must contain 1 to 5 unique values")
    if any(not str(item).strip() for item in selected_keywords):
        raise UnifiedContentError("selected_keywords cannot contain blanks")
    template = PROMPT_PATH.read_text(encoding="utf-8")
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    return (template
        .replace("{{SELECTED_KEYWORDS_JSON}}", json.dumps(selected_keywords, ensure_ascii=False))
        .replace("{{SOURCE_MATERIAL}}", str(source_material).strip())
        .replace("{{REFERENCE_CONTEXT}}", reference_material if reference_material is not None else reference_context())
        .replace("{{PRIOR_OUTPUT_CONTEXT}}", prior_output_context(previous_documents or []))
        .replace("{{JSON_SCHEMA}}", json.dumps(schema, ensure_ascii=False)))


def _text(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("text", ""))
    return str(value or "")


def _has_visible_axis_crossing(scene: dict[str, Any]) -> bool:
    sequence = scene.get("sequence") or {}
    bridge = " ".join(_text(sequence.get(key)) for key in
                       ("camera_bridge", "entry_action", "exit_action"))
    bridge_lower = bridge.lower()
    crossing_terms = (
        "축을 넘", "반대편으로 이동", "반대쪽으로 이동", "카메라가 이동", "인물이 이동", "함께 이동",
        "카메라가 테이블을 돌아", "카메라가 돌아가", "반대편까지 따라",
        "crosses the axis", "cross the axis", "camera crosses", "camera moves across",
        "camera tracks around", "tracks around the table", "moves to the opposite side",
        "move to the opposite side", "travels around", "moves behind", "character crosses",
    )
    return any(term in bridge_lower for term in crossing_terms)


def normalize_unmotivated_axis_crossings(document: dict[str, Any]) -> dict[str, Any]:
    """Use the safe same-side default when a generated cross has no visible bridge."""
    scenes = ((document.get("production") or {}).get("timeline") or {}).get("scenes", [])
    for index, scene in enumerate(scenes):
        if not isinstance(scene, dict):
            continue
        sequence = scene.get("sequence") or {}
        if index > 0 and sequence.get("camera_axis_transition") == "establish":
            sequence["camera_axis_transition"] = "same_side"
        if sequence.get("camera_axis_transition") == "motivated_cross" and not _has_visible_axis_crossing(scene):
            sequence["camera_axis_transition"] = "same_side"
    return document


def normalize_unknown_table_reference_locks(document: dict[str, Any]) -> dict[str, Any]:
    """Resolve location-scoped prop geometry, otherwise lock unknown shapes to the reference."""
    production = document.get("production") or {}
    scenes = (production.get("timeline") or {}).get("scenes", [])
    assets = production.get("reference_assets") or []
    continuity = production.get("continuity") or {}
    property_text = " ".join(_text(item) for item in continuity.get("props", [])
                              if isinstance(item, (dict, str)))
    def shapes(text: str) -> set[str]:
        found = {shape for shape, terms in {
            "round": ("원형", "둥근"),
            "square": ("정사각", "사각형", "사각 테이블", "사각 상판", "네모난"),
            "rectangular": ("직사각", "긴 사각"),
        }.items() if any(term in text for term in terms)}
        if "직사각" in text or "긴 사각" in text:
            found.discard("square")
        return found
    labels = {"round": "원형", "square": "사각형", "rectangular": "직사각형"}
    location_terms = ("휴게실", "가족상담실", "상담실", "식당", "로비", "옥상정원",
                      "활동실", "침실", "복도", "정원", "라운지", "카페")
    location_assets = {
        str(asset.get("id")): " ".join(str(asset.get(key, "")) for key in
                                       ("usage", "appearance_lock", "description"))
        for asset in assets if isinstance(asset, dict)
        and (str(asset.get("kind", "")).lower() in {"location", "facility"}
             or str(asset.get("id", "")).startswith(("ref-location-", "ref-facility-")))
    }
    for scene in scenes:
        if not isinstance(scene, dict):
            continue
        image_prompt = scene.get("image_prompt")
        if not isinstance(image_prompt, dict):
            continue
        prompt_text = _text(image_prompt)
        reference_ids = [str(item) for item in scene.get("reference_ids", [])]
        reference_text = " ".join(location_assets.get(item, "") for item in reference_ids)
        sequence = scene.get("sequence") or {}
        scene_context = " ".join((str(scene.get("title", "")), prompt_text, reference_text,
                                   *(_text(sequence.get(key)) for key in ("entry_action", "exit_action", "continuity_anchor"))))
        scene_places = [term for term in location_terms if term in scene_context]
        props = [_text(item) for item in continuity.get("props", []) if isinstance(item, (dict, str))]
        matching_props = [text for text in props if any(term in text for term in scene_places)]
        local_shapes = shapes(" ".join(matching_props)) if matching_props else set()
        reference_shapes = shapes(reference_text)
        context = f"{prompt_text} {property_text} {reference_text}"
        if "테이블" not in context:
            continue
        props_shapes = local_shapes if matching_props else shapes(property_text)
        compatible_shapes = (
            reference_shapes & props_shapes
            if reference_shapes and props_shapes
            else reference_shapes or props_shapes
        )
        prompt_shapes = shapes(prompt_text)
        if len(compatible_shapes) == 1 and not prompt_shapes:
            selected_shape = next(iter(compatible_shapes))
            image_prompt["text"] = f"{prompt_text} {labels[selected_shape]} 테이블 형태와 비율을 해당 장소 기준 레퍼런스대로 유지한다.".strip()
            continue
        if len(compatible_shapes) > 1 and not prompt_shapes:
            lock = "테이블이 보이면 현재 장소의 기준 레퍼런스 실루엣·비율·방향을 그대로 유지하고, 다른 장소의 테이블 형태를 섞지 않는다."
            image_prompt["text"] = f"{prompt_text} {lock}".strip()
            continue
        if compatible_shapes:
            continue
        lower = prompt_text.lower()
        if any(term in lower for term in (
            "기준 레퍼런스", "레퍼런스대로", "참조 이미지", "참조 레퍼런스",
            "reference silhouette", "match the reference", "as shown in the reference",
        )):
            continue
        lock = "테이블이 보이면 기준 레퍼런스의 실루엣·비율·방향을 그대로 유지하고 형태를 임의로 바꾸지 않는다."
        image_prompt["text"] = f"{prompt_text} {lock}".strip()
    return document


def validate_visual_continuity(document: dict[str, Any]) -> None:
    """Reject storyboard plans that encode an unmotivated location return or lose known furniture geometry."""
    production = document.get("production") or {}
    scenes = (production.get("timeline") or {}).get("scenes") or []
    assets = production.get("reference_assets") or []
    location_ids = {
        str(asset.get("id")) for asset in assets if isinstance(asset, dict)
        and (str(asset.get("kind", "")).lower() in {"location", "facility"}
             or str(asset.get("id", "")).startswith(("ref-location-", "ref-facility-")))
    }

    seen_locations: set[str] = set()
    previous_locations: set[str] = set()
    previous_scene: dict[str, Any] | None = None
    for scene in scenes:
        current_locations = {
            str(item) for item in (scene.get("reference_ids") or []) if str(item) in location_ids
        }
        returned = current_locations & (seen_locations - previous_locations)
        if returned and previous_scene:
            previous_sequence = previous_scene.get("sequence") or {}
            sequence = scene.get("sequence") or {}
            route = " ".join(_text(sequence.get(key)) for key in
                             ("entry_action", "continuity_anchor", "camera_bridge"))
            route += " " + " ".join(_text(previous_sequence.get(key)) for key in
                                   ("exit_action", "camera_bridge"))
            return_terms = ("돌아오", "돌아가", "복귀", "귀환", "재방문", "되돌아")
            travel_terms = ("이동", "걸어", "통과", "문턱", "복도", "계단", "엘리베이터", "도착", "향해")
            if not any(term in route for term in return_terms) or not any(term in route for term in travel_terms):
                returned_ids = ", ".join(sorted(returned))
                raise UnifiedContentError(
                    f"장소가 이전 씬의 {returned_ids}로 되돌아가지만 sequence에 명시적인 귀환 이유와 이동 경로가 없습니다"
                )
        seen_locations.update(current_locations)
        previous_locations = current_locations
        previous_scene = scene

    for index, scene in enumerate(scenes):
        sequence = scene.get("sequence") or {}
        transition = sequence.get("camera_axis_transition", "establish" if index == 0 else "same_side")
        if index == 0 and transition != "establish":
            raise UnifiedContentError("첫 씬은 sequence.camera_axis_transition을 establish로 설정해야 합니다")
        if index > 0 and transition == "establish":
            raise UnifiedContentError(f"{scene.get('id', 'scene')}는 이전 씬의 화면축과 연결되어야 합니다")
        if transition == "motivated_cross":
            if not _has_visible_axis_crossing(scene):
                raise UnifiedContentError(
                    f"{scene.get('id', 'scene')} 화면축 전환은 camera_bridge와 동선에 보이는 계기가 필요합니다"
                )

    # Canonical asset metadata and the continuity ledger are the text model's geometry source of truth.
    # Once a table shape is known, every scene prompt using that location must retain it.
    shape_terms = {
        "round": ("원형", "둥근"),
        "square": ("정사각", "사각형", "사각 테이블", "사각 상판", "네모난"),
        "rectangular": ("직사각", "긴 사각"),
    }

    def shapes_in(value: str) -> set[str]:
        found = {shape for shape, terms in shape_terms.items() if any(term in value for term in terms)}
        if "직사각" in value or "긴 사각" in value:
            found.discard("square")
        return found

    continuity = production.get("continuity") or {}
    property_texts = [_text(item) for item in continuity.get("props", []) if isinstance(item, (dict, str))]
    property_geometry = " ".join(property_texts)
    all_props_shapes = shapes_in(property_geometry)
    location_terms = ("휴게실", "가족상담실", "상담실", "식당", "로비", "옥상정원",
                      "활동실", "침실", "복도", "정원", "라운지", "카페")
    asset_geometry = {
        str(asset.get("id")): shapes_in(" ".join(
            str(asset.get(key, "")) for key in ("usage", "appearance_lock", "description")
        ))
        for asset in assets if isinstance(asset, dict)
        and str(asset.get("kind", "")).lower() in {"location", "facility"}
    }
    for scene in scenes:
        prompt = _text(scene.get("image_prompt"))
        scene_location_ids = [str(item) for item in (scene.get("reference_ids") or [])
                              if str(item) in location_ids]
        reference_shapes = set().union(*(asset_geometry.get(item, set()) for item in scene_location_ids))
        reference_text = " ".join(
            " ".join(str(asset.get(key, "")) for key in ("usage", "appearance_lock", "description"))
            for asset in assets if isinstance(asset, dict) and str(asset.get("id")) in scene_location_ids
        )
        sequence = scene.get("sequence") or {}
        scene_context = " ".join((str(scene.get("title", "")), prompt, reference_text,
                                   *(_text(sequence.get(key)) for key in ("entry_action", "exit_action", "continuity_anchor"))))
        scene_places = [term for term in location_terms if term in scene_context]
        scene_props = [text for text in property_texts
                       if any(term in text for term in scene_places)]
        props_shapes = shapes_in(" ".join(scene_props)) if scene_props else all_props_shapes
        if reference_shapes and props_shapes:
            compatible_shapes = reference_shapes & props_shapes
            if not compatible_shapes:
                raise UnifiedContentError("기준 장소 레퍼런스와 continuity.props의 테이블 형태가 서로 충돌합니다")
        else:
            compatible_shapes = reference_shapes or props_shapes
        table_in_scope = "테이블" in prompt or "테이블" in property_geometry or "테이블" in reference_text
        prompt_lower = prompt.lower()
        reference_lock_terms = (
            "기준 레퍼런스", "레퍼런스대로", "참조 이미지", "참조 레퍼런스",
            "reference silhouette", "match the reference", "as shown in the reference",
        )
        reference_locked = any(term in prompt_lower for term in reference_lock_terms)
        if table_in_scope and not compatible_shapes:
            if not reference_locked:
                raise UnifiedContentError(
                    f"{scene.get('id', 'scene')} 테이블 형태가 메타데이터에 없으므로 image_prompt에 기준 레퍼런스 실루엣·비율·방향을 그대로 유지하라고 명시해야 합니다"
                )
            continue
        if "테이블" in reference_text and not props_shapes and not reference_locked:
            raise UnifiedContentError("기준 레퍼런스의 테이블 형태를 production.continuity.props에 기록해야 합니다")
        known_shapes = compatible_shapes
        if len(known_shapes) > 1:
            prompt_shapes = shapes_in(prompt)
            selected_shapes = known_shapes & prompt_shapes
            if len(selected_shapes) == 1:
                known_shapes = selected_shapes
            elif reference_locked:
                continue
            else:
                raise UnifiedContentError(
                    f"{scene.get('id', 'scene')} 기준 레퍼런스/continuity.props에 복수 테이블 형태가 있어 씬별로 하나를 명시해야 합니다 "
                    f"(reference={sorted(reference_shapes)}, props={sorted(props_shapes)})"
                )
        if known_shapes and table_in_scope:
            expected = next(iter(known_shapes))
            accepted_terms = shape_terms[expected]
            contradictory = shapes_in(prompt) - {expected}
            if contradictory:
                raise UnifiedContentError(
                    f"{scene.get('id', 'scene')} image_prompt가 기준 테이블의 형태와 충돌합니다 ({expected})"
                )
            if not any(term in prompt for term in accepted_terms):
                shape_label = {
                    "round": "원형 또는 둥근 테이블",
                    "square": "사각형 또는 정사각형 테이블",
                    "rectangular": "직사각형 또는 긴 사각 테이블",
                }[expected]
                raise UnifiedContentError(
                    f"{scene.get('id', 'scene')} image_prompt에 기준 테이블의 형태를 명시해야 합니다 ({expected}: {shape_label})"
                )


def validate_document(document: dict[str, Any], selected_keywords: list[str], strict_schema: bool = False,
                      locked_plan: dict[str, Any] | None = None) -> float:
    if strict_schema:
        try:
            validate_json_schema_file(document, SCHEMA_PATH)
        except JsonSchemaError as exc:
            raise UnifiedContentError(f"schema validation failed: {exc}") from None
    if document.get("schema_version") != "1.0.0":
        raise UnifiedContentError("schema_version must be 1.0.0")
    actual = document.get("project", {}).get("selected_keywords")
    if actual != selected_keywords:
        raise UnifiedContentError("project.selected_keywords must exactly preserve the input order and values")
    validate_visual_continuity(document)
    if locked_plan:
        scenes = document.get("production", {}).get("timeline", {}).get("scenes", [])
        if any(float(scene.get("end", 0)) - float(scene.get("start", 0)) < 1.5 - 1e-6
               for scene in scenes):
            raise UnifiedContentError("새 콘티의 모든 시각 씬은 최소 1.5초여야 합니다")
        if document.get("project", {}).get("title") != locked_plan.get("title"):
            raise UnifiedContentError("2차 콘티는 1차 대본 제목을 그대로 유지해야 합니다")
        actual_beats = [cue.get("narration", {}).get("text") for cue in
                        document.get("production", {}).get("narration_cues", [])]
        if actual_beats != locked_plan.get("narration_beats"):
            raise UnifiedContentError("2차 콘티는 1차 나레이션 문장과 순서를 그대로 유지해야 합니다")
        character_names = {str(item.get("display_name", "")).strip() for item in
                           document.get("production", {}).get("reference_assets", [])
                           if item.get("kind") == "character" and item.get("display_name")}
        if any(name in beat for name in character_names for beat in actual_beats):
            raise UnifiedContentError("인물 이름은 나레이션이 아닌 콘티 메타데이터에만 있어야 합니다")
    return validate_timeline(document)


def build_repair_prompt(candidate: str, error: Exception,
                        locked_plan: dict[str, Any] | None = None) -> str:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    sequence = schema.get("$defs", {}).get("sequenceContinuity", {}).get("properties", {})
    enum_hints = []
    for key in ("camera_motion", "camera_axis_transition"):
        allowed = sequence.get(key, {}).get("enum")
        if allowed:
            enum_hints.append(f"sequence.{key}는 다음 값 중 하나만 사용한다: {json.dumps(allowed, ensure_ascii=False)}")
    enum_contract = "\n".join(enum_hints)
    error_text = str(error)
    empty_scene_recovery = ""
    if "timeline.scenes" in error_text and "too few items" in error_text:
        empty_scene_recovery = (
            "production.timeline.scenes가 비어 있다. 이전 빈 배열을 유지하지 말고, 확정 1차 대본의 각 "
            "narration_beats를 화면으로 보여 주는 완전한 씬을 최소 하나씩 새로 작성한다. 모든 씬은 최소 "
            "1.5초이며 시작·종료 시간이 연속되어야 한다. narration_cues도 각 확정 문장과 같은 순서로 "
            "만들고 각 씬을 정확히 연결한다. 아래 전체 JSON 스키마의 scene, sequenceContinuity, "
            "narrationCue 필수 필드를 모두 채운다.\n"
            f"확정 1차 대본:\n{json.dumps(locked_plan or {}, ensure_ascii=False)}\n"
            f"전체 JSON 스키마:\n{json.dumps(schema, ensure_ascii=False)}\n"
        )
    return (
        "이전 JSON 후보가 스키마 또는 장면 연속성 계약 검증에 실패했다. 오류 메시지에 표시된 필드만 최소 변경하고, 그 밖의 모든 값은 이전 JSON에서 정확히 유지하라. 특히 카메라 축, 씬 동선, 장소, 인물, 구도와 프롬프트는 해당 오류가 직접 지적하지 않는 한 절대 바꾸지 않는다.\n"
        "장소 복귀는 이유와 이동 경로를 sequence에 기록하고, 가구 형태는 기준 레퍼런스 및 continuity.props와 모든 씬 프롬프트에서 일치시킨다. 아래 오류를 모두 수정하고 완전한 JSON 객체 하나만 다시 출력하라.\n"
        f"열거형 계약:\n{enum_contract}\n"
        f"{empty_scene_recovery}"
        "화면축 검증 오류라면 camera_bridge·entry_action·exit_action에 실제로 보이는 카메라/인물의 축 횡단 이동이 명시된 경우에만 motivated_cross를 유지한다. 이동 근거가 없으면 해당 씬을 same_side로 고치며, 단순한 샷 크기·각도 변화는 축 횡단으로 취급하지 않는다.\n"
        "테이블 형태 누락 오류라면 오류에 표시된 한국어 형태명을 해당 scene의 image_prompt.text에 직접 넣고, continuity.props 및 기준 레퍼런스와 일치시킨다.\n"
        "기준 metadata에 테이블 형태가 없으면 형태를 추측하지 않는다. 해당 씬의 image_prompt.text에 기준 레퍼런스의 테이블 실루엣·비율·방향을 그대로 유지하라고 명시한다.\n"
        "한 씬의 테이블 후보가 복수라면 오류에 표시된 scene ID의 장소 reference_assets.usage와 그 장소를 이름으로 특정한 continuity.props만 사용해 정확히 하나를 선택하고, 선택한 형태를 그 씬 image_prompt.text에 명시한다. 위치별 정보가 없으면 형태를 추측하지 말고 기준 레퍼런스 잠금을 명시한다.\n"
        f"검증 오류: {type(error).__name__}: {error}\n"
        f"이전 후보:\n{candidate}"
    )


def maximum_similarity(document: dict[str, Any], previous_documents: list[dict[str, Any]]) -> float:
    current = narrative_fingerprint(document)
    if not current or not previous_documents:
        return 0.0
    return max(SequenceMatcher(None, current, narrative_fingerprint(item)).ratio() for item in previous_documents)


def build_novelty_repair_prompt(candidate: str, similarity: float) -> str:
    return (
        "JSON 계약은 유효하지만 동일 키워드 과거 결과와 이야기 흐름 또는 내레이션이 너무 유사하다. "
        "시작 상황, 중심 행동, 인물 관계, 공간 이동 순서, 결말 이미지와 내레이션 비유를 새로 설계하라. "
        "키워드와 사실, JSON 계약은 유지하고 완전한 JSON 객체 하나만 출력하라.\n"
        f"최대 유사도: {similarity:.3f}\n이전 후보:\n{candidate}"
    )


def run_generation_harness(
    generate: Callable[[str], str], selected_keywords: list[str], source_material: str,
    previous_documents: list[dict[str, Any]] | None = None,
    persist: Callable[[dict[str, Any]], None] | None = None,
    similarity_threshold: float = 0.72,
    reference_material: str | None = None,
    strict_schema: bool = False,
    provenance: dict[str, Any] | None = None,
    locked_plan: dict[str, Any] | None = None,
) -> dict[str, Any]:
    def complete_provenance(document: dict[str, Any]) -> dict[str, Any]:
        document = normalize_document_shape(document)
        project = document.get("project")
        if not isinstance(project, dict):
            project = {}
            document["project"] = project
        concepts = document.get("concept_variants") or []
        concept_title = concepts[0].get("title", "") if concepts and isinstance(concepts[0], dict) else ""
        locked_title = (locked_plan or {}).get("title", "")
        if locked_title:
            project["title"] = locked_title
        else:
            project.setdefault("title", concept_title or "요양원 일상의 작은 순간")
        project.setdefault("brand", "생각담 | ThinkCast")
        project.setdefault("purpose", (locked_plan or {}).get("synopsis") or "요양원 일상을 담은 따뜻한 스토리형 숏폼 콘텐츠")
        project.setdefault("audience", ["요양원 입소 어르신", "가족 및 보호자"])
        project["selected_keywords"] = list(selected_keywords)
        project.setdefault("aspect_ratio", "16:9")
        project.setdefault("resolution", {"width": 1920, "height": 1080})
        locked_beats = (locked_plan or {}).get("narration_beats")
        production = document.get("production", {})
        cues = production.get("narration_cues", []) if isinstance(production, dict) else []
        scenes = production.get("timeline", {}).get("scenes", []) if isinstance(production, dict) else []
        if (
            isinstance(locked_beats, list)
            and locked_beats
            and isinstance(scenes, list)
            and scenes
            and len(cues) != len(locked_beats)
        ):
            rebuilt_cues = []
            scene_cue_ids = {scene.get("id"): [] for scene in scenes if isinstance(scene, dict)}
            scene_count, beat_count = len(scenes), len(locked_beats)
            for index, beat in enumerate(locked_beats):
                if scene_count >= beat_count:
                    first = index * scene_count // beat_count
                    last = max(first, ((index + 1) * scene_count // beat_count) - 1)
                else:
                    first = min(index * scene_count // beat_count, scene_count - 1)
                    last = first
                covered = [scene for scene in scenes[first:last + 1] if isinstance(scene, dict)]
                if not covered:
                    continue
                cue_id = f"narration-{index + 1:02d}"
                scene_ids = [scene["id"] for scene in covered]
                for scene_id in scene_ids:
                    scene_cue_ids[scene_id].append(cue_id)
                start, end = covered[0]["start"], covered[-1]["end"]
                text = str(beat).strip()
                rebuilt_cues.append({
                    "id": cue_id,
                    "start": start,
                    "end": end,
                    "scene_ids": scene_ids,
                    "narration": {"text": text, "source": "provided"},
                    "caption": {"text": text, "source": "provided"},
                    "timing_source": "estimated_speech_rate",
                    "estimated_duration_seconds": round(float(end) - float(start), 3),
                    "measured_duration_seconds": None,
                    "audio_uri": None,
                })
            cues = rebuilt_cues
            production["narration_cues"] = cues
            cue_text = {cue["id"]: cue["narration"] for cue in cues}
            for scene in scenes:
                if not isinstance(scene, dict):
                    continue
                ids = scene_cue_ids.get(scene.get("id"), [])
                scene["narration_cue_ids"] = ids
                if ids:
                    scene["narration"] = dict(cue_text[ids[0]])
                    scene["caption"] = dict(cue_text[ids[0]])
        if isinstance(locked_beats, list) and len(cues) == len(locked_beats):
            cue_text_by_id = {}
            for cue, beat in zip(cues, locked_beats):
                if not isinstance(cue, dict) or not isinstance(beat, str) or not beat.strip():
                    continue
                sourced = {"text": beat.strip(), "source": "provided"}
                cue["narration"] = dict(sourced)
                cue["caption"] = dict(sourced)
                if isinstance(cue.get("id"), str):
                    cue_text_by_id[cue["id"]] = sourced
            for scene in scenes if isinstance(scenes, list) else []:
                if not isinstance(scene, dict):
                    continue
                cue_ids = scene.get("narration_cue_ids") or []
                sourced = next((cue_text_by_id[item] for item in cue_ids if item in cue_text_by_id), None)
                if sourced:
                    scene["narration"] = dict(sourced)
                    scene["caption"] = dict(sourced)
        normalize_unmotivated_axis_crossings(document)
        normalize_unknown_table_reference_locks(document)
        if provenance and not isinstance(document.get("provenance"), dict):
            document["provenance"] = json.loads(json.dumps(provenance, ensure_ascii=False))
        return document

    previous_documents = previous_documents or []
    prompt = build_prompt(selected_keywords, source_material, previous_documents, reference_material)
    candidate = generate(prompt)
    repair_count = 0
    while True:
        try:
            document = complete_provenance(parse_json_document(candidate))
            validate_document(document, selected_keywords, strict_schema, locked_plan)
            break
        except (UnifiedContentError, KeyError, TypeError, ValueError) as validation_error:
            if repair_count >= MAX_VALIDATION_REPAIRS:
                raise
            candidate = generate(build_repair_prompt(candidate, validation_error, locked_plan))
            repair_count += 1
    similarity = maximum_similarity(document, previous_documents)
    if similarity >= similarity_threshold:
        revised = generate(build_novelty_repair_prompt(json.dumps(document, ensure_ascii=False), similarity))
        try:
            revised_document = complete_provenance(parse_json_document(revised))
            validate_document(revised_document, selected_keywords, strict_schema, locked_plan)
            revised_similarity = maximum_similarity(revised_document, previous_documents)
            if revised_similarity < similarity:
                document, similarity = revised_document, revised_similarity
            repair_count += 1
        except (UnifiedContentError, KeyError, TypeError, ValueError):
            # Novelty is a quality preference; never discard an already valid document.
            pass
    if persist:
        persist(document)
    return {"document": document, "repair_count": repair_count, "maximum_similarity": similarity}
