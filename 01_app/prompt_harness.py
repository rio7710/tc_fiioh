import json
import os
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


DEFAULT_GEMINI_MODEL = "gemini-3.6-flash"
DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image"


def validate_prompt(prompt):
    prompt = str(prompt or "").strip()
    if not prompt:
        raise ValueError("테스트할 프롬프트를 입력해 주세요.")
    if len(prompt) > 6000:
        raise ValueError("테스트 프롬프트는 6,000자 이하로 입력해 주세요.")
    return prompt


def gemini_request_error(exc, model):
    safe = {400: "Gemini 요청 형식 또는 모델 설정을 확인해 주세요.", 401: "Gemini API 키 인증에 실패했습니다.", 403: "Gemini API 사용 권한을 확인해 주세요.", 404: f"Gemini 모델 {model}을 현재 계정에서 사용할 수 없습니다.", 429: "Gemini 무료 또는 결제 사용 한도를 초과했습니다."}
    return RuntimeError(safe.get(exc.code, f"Gemini 응답 오류 (HTTP {exc.code})"))


def open_gemini_stream(api_key, prompt, model=None):
    prompt = validate_prompt(prompt)
    model = model or os.environ.get("GEMINI_TEXT_MODEL", DEFAULT_GEMINI_MODEL)
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{quote(model, safe='')}:streamGenerateContent?alt=sse"
    body = {"contents": [{"role": "user", "parts": [{"text": prompt}]}], "generationConfig": {"temperature": 0.5, "maxOutputTokens": 2048}}
    request = Request(endpoint, data=json.dumps(body, ensure_ascii=False).encode("utf-8"), headers={"Content-Type": "application/json", "x-goog-api-key": api_key}, method="POST")
    try:
        return urlopen(request, timeout=60), model
    except HTTPError as exc:
        raise gemini_request_error(exc, model) from None
    except (URLError, TimeoutError):
        raise RuntimeError("Gemini 서버 연결 시간이 초과되었습니다.") from None


def test_gemini_prompt(api_key, prompt, model=None):
    prompt = validate_prompt(prompt)
    model = model or os.environ.get("GEMINI_TEXT_MODEL", DEFAULT_GEMINI_MODEL)
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{quote(model, safe='')}:generateContent"
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.5, "maxOutputTokens": 2048},
    }
    request = Request(
        endpoint,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    started = time.monotonic()
    try:
        with urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        safe = {
            400: "Gemini 요청 형식 또는 모델 설정을 확인해 주세요.",
            401: "Gemini API 키 인증에 실패했습니다.",
            403: "Gemini API 사용 권한을 확인해 주세요.",
            404: f"Gemini 모델 {model}을 현재 계정에서 사용할 수 없습니다.",
            429: "Gemini 무료 또는 결제 사용 한도를 초과했습니다.",
        }
        raise gemini_request_error(exc, model) from None
    except (URLError, TimeoutError):
        raise RuntimeError("Gemini 서버 연결 시간이 초과되었습니다.") from None
    candidates = payload.get("candidates") or []
    candidate = candidates[0] if candidates else {}
    parts = candidate.get("content", {}).get("parts", [])
    output = "".join(str(part.get("text", "")) for part in parts).strip()
    if not output:
        block = payload.get("promptFeedback", {}).get("blockReason")
        raise RuntimeError(f"Gemini가 출력 내용을 반환하지 않았습니다{f' ({block})' if block else ''}.")
    return {
        "output": output,
        "trace": {
            "provider": "gemini",
            "model": payload.get("modelVersion") or model,
            "provider_request_id": payload.get("responseId"),
            "finish_reason": candidate.get("finishReason"),
            "usage": payload.get("usageMetadata", {}),
            "latency_ms": round((time.monotonic() - started) * 1000),
        },
    }


def test_gemini_image(api_key, prompt, model=None):
    prompt = validate_prompt(prompt)
    model = model or os.environ.get("GEMINI_IMAGE_MODEL", DEFAULT_GEMINI_IMAGE_MODEL)
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{quote(model, safe='')}:generateContent"
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
    }
    request = Request(
        endpoint,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    started = time.monotonic()
    try:
        with urlopen(request, timeout=180) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise gemini_request_error(exc, model) from None
    except (URLError, TimeoutError):
        raise RuntimeError("Gemini 이미지 생성 연결 시간이 초과되었습니다.") from None
    candidates = payload.get("candidates") or []
    candidate = candidates[0] if candidates else {}
    parts = candidate.get("content", {}).get("parts", [])
    image_part = next((part.get("inlineData") or part.get("inline_data") for part in parts if part.get("inlineData") or part.get("inline_data")), None)
    if not image_part or not image_part.get("data"):
        block = payload.get("promptFeedback", {}).get("blockReason")
        raise RuntimeError(f"Gemini가 이미지를 반환하지 않았습니다{f' ({block})' if block else ''}.")
    mime_type = image_part.get("mimeType") or image_part.get("mime_type") or "image/png"
    caption = "".join(str(part.get("text", "")) for part in parts).strip()
    return {
        "image_data_url": f"data:{mime_type};base64,{image_part['data']}",
        "caption": caption,
        "trace": {
            "provider": "gemini",
            "model": payload.get("modelVersion") or model,
            "provider_request_id": payload.get("responseId"),
            "finish_reason": candidate.get("finishReason"),
            "usage": payload.get("usageMetadata", {}),
            "latency_ms": round((time.monotonic() - started) * 1000),
        },
    }
