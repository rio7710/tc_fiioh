"""Korean script copy rules isolated from the HTTP application server."""

import json
import re


# Recurring malformed combinations that have escaped the writing prompt and
# reached saved scripts. Keep this list narrow so valid poetic fragments are
# not rejected merely for being concise.
COPY_QUALITY_PATTERNS = (
    (re.compile(r"하루(?:가|는|도)?\s*(?:더\s*)?깊어(?:져|집)"),
     "'하루가 깊어지다'처럼 의미가 불분명한 추상 결합을 자연스러운 생활 언어로 고쳐 주세요."),
    (re.compile(r"방향(?:이|을)?\s*놓이"),
     "'방향이 놓이다'처럼 주어와 서술어가 어색한 결합을 고쳐 주세요."),
    (re.compile(r"곁의\s*눈빛(?:이|은)?\s*먼저\s*살피"),
     "눈빛이 사람 대신 행동하는 것처럼 들리는 부자연스러운 표현을 고쳐 주세요."),
    (re.compile(r"(?:나감니다|함니다|됬)"),
     "맞춤법 오류를 고쳐 주세요. '이어 나갑니다'처럼 올바른 종결형을 사용합니다."),
)


def registered_client_name(resources):
    """Resolve an explicitly registered client/facility name without guessing."""
    for resource in resources:
        payload = resource.get("payload", {})
        if not isinstance(payload, dict):
            continue
        for key in ("client_name", "facility_name", "organization_name"):
            value = str(payload.get(key, "")).strip()
            if value:
                return value
    heading_pattern = re.compile(
        r"^#\s+([^\n]{2,40}?(?:요양원|재활실버케어))"
        r"(?=\s+(?:\d+\s*초|홍보|콘텐츠|스토리보드)|\s*$)",
        re.MULTILINE,
    )
    for resource in resources:
        if resource.get("resource_type") not in {
            "prompt_guidance_source", "canonical_storyboard_spec",
            "human_storyboard_reference", "test_content_sample",
        }:
            continue
        payload = resource.get("payload", {})
        content = payload.get("content") if isinstance(payload, dict) else None
        matched = heading_pattern.search(str(content or ""))
        if matched:
            return matched.group(1).strip()
    return ""


def korean_subject_form(name):
    """Attach 이/가 to a registered name so the closing has a clear subject."""
    value = str(name or "").strip()
    if not value:
        return ""
    last = value[-1]
    if "가" <= last <= "힣":
        particle = "이" if (ord(last) - ord("가")) % 28 else "가"
    else:
        particle = "가"
    return value + particle


def script_plan_copy_quality_conflicts(plan):
    """Return concrete Korean copy defects without rejecting poetic brevity."""
    beats = [str(item).strip() for item in plan.get("narration_beats", []) if str(item).strip()]
    issues = []
    for index, beat in enumerate(beats):
        for pattern, message in COPY_QUALITY_PATTERNS:
            if pattern.search(beat):
                issues.append(f"{index + 1}번째 문장 '{beat}': {message}")
    if beats and not re.search(r"(?:요|니다|다)[.!?…]?$", beats[-1]):
        issues.append(
            f"마지막 문장 '{beats[-1]}'은 조사나 서술어를 생략한 구절이 아니라 "
            "자연스럽게 종결되는 문장이어야 합니다."
        )
    if beats and re.search(r"잇습니다[.!?…]?$", beats[-1]):
        issues.append(
            f"마지막 문장 '{beats[-1]}'은 추상적인 '잇습니다'로 끝내지 말고 "
            "'이어 나갑니다', '함께 만들어 갑니다', '곁에서 함께하겠습니다'처럼 "
            "문맥상 행동 주체와 의미가 분명한 표현으로 고쳐 주세요."
        )
    return issues


def script_plan_editorial_review_prompt(plan, request_contract):
    """Build a bounded copy-edit pass that cannot rewrite story metadata."""
    return f"""당신은 한국어 나레이션 카피 검수자다.
아래 1차 대본의 narration_beats 전체를 각각 소리 내어 읽는 기준으로 검수한다.
- 조사 생략, 주어·서술어 불일치, 뜻이 통하지 않는 추상어 결합, 번역투, 같은 표현의 불필요한 반복을 고친다.
- 개별 문장뿐 아니라 앞뒤 문장이 이어질 때 의미와 호흡이 자연스러운지도 확인한다.
- 마지막 1~3개 문장은 앞 장면을 받아 자연스럽게 종결되어야 한다. 기존 결과에 정식 고객사·시설명이 있으면 정확히 유지한다. 마지막을 추상적인 '잇습니다'로 끝내지 말고 '이어 나갑니다', '함께 만들어 갑니다', '곁에서 함께하겠습니다'처럼 주체와 의미가 분명한 표현으로 교정한다.
- 수정할 필요가 없는 문장은 그대로 둔다. 새 사실, 치료 효과, 시설, 인물 이름을 만들지 않는다.
- title, synopsis, cast_choices, location_choices 및 narration beat의 개수와 순서는 바꾸지 않는다.
- narration_beats만 필요한 만큼 교정한 뒤 전체 원본 필드를 갖춘 JSON 객체 하나만 출력한다.
{request_contract}
검수 대상: {json.dumps(plan, ensure_ascii=False)}"""
