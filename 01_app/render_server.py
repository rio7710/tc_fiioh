import json
import hashlib
import base64
import binascii
import hmac
import html
import ipaddress
import math
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import uuid
import unicodedata
import re
import webbrowser
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prompt_harness import open_gemini_stream, test_gemini_image, test_gemini_prompt
from auth_store import AuthStore
from automation_store import AutomationStore, VersionConflict, validate_config, STAGES
from visual_decisions import VisualDecisions, DecisionConflict
kling_submission_lock = threading.Lock()
from keyword_pool import load_month_pool
from tools.unified_content_prompt_harness import run_generation_harness
from tools.validate_json_schema import JsonSchemaError, validate_json_schema_file

APP_DIR = Path(__file__).resolve().parent
ROOT = APP_DIR.parent
EXPORTS = Path(os.environ.get("EXPORTS_DIR", str(ROOT / "04_exports")))
DATA_FILE = Path(os.environ.get("DEMO_DATA_PATH", str(APP_DIR / "data" / "demo_data.json")))
CAPTION_REGISTRY_FILE = Path(os.environ.get("CAPTION_REGISTRY_PATH", str(APP_DIR / "data" / "caption_artifacts.json")))
RENDER_CATALOG_PATH = ROOT / "config" / "render-catalog.json"
SOURCE_CLIPS = ROOT / "02_media" / "video" / "source_clips"
MERGED_DEMO_VIDEO = ROOT / "02_media" / "video" / "P1_merged.mp4"
PORT = int(os.environ.get("PORT", "8765"))
IS_RENDER_HOSTED = bool(os.environ.get("RENDER") or os.environ.get("RENDER_EXTERNAL_URL"))
SQLITE_PATH = Path(os.environ.get("SQLITE_PATH", str(APP_DIR / "data" / "tc.sqlite")))
render_lock = threading.Lock()
data_lock = threading.Lock()
caption_registry_lock = threading.Lock()
render_progress_lock = threading.Lock()
render_jobs = {}
script_generation_lock = threading.Lock()
active_script_generation_projects = set()
provider_credentials_lock = threading.Lock()
provider_credentials = {}
kling_usage_lock = threading.Lock()
kling_usage_baselines = {}
kling_artifact_lock = threading.Lock()
project_kling_job_lock = threading.Lock()
KLING_ARTIFACT_DIR = Path(os.environ.get("KLING_ARTIFACT_DIR", str(ROOT / "02_media" / "generated" / "kling")))
PROJECT_KLING_JOBS_FILE = Path(os.environ.get("PROJECT_KLING_JOBS_PATH", str(APP_DIR / "data" / "project_kling_jobs.json")))
VOICE_ARTIFACT_DIR = Path(os.environ.get("VOICE_ARTIFACT_DIR", str(ROOT / "02_media" / "generated" / "voice")))
STORYBOARD_IMAGE_DIR = Path(os.environ.get("STORYBOARD_IMAGE_DIR", str(ROOT / "02_media" / "generated" / "storyboard")))
BRAND_ASSET_DIR = Path(os.environ.get("BRAND_ASSET_DIR", str(ROOT / "02_media" / "generated" / "brand")))
KLING_I2V_HARNESS = (
    "Animate only this exact source frame as one continuous shot. Perform only the single primary action described above, "
    "using restrained, low-amplitude, physically plausible motion continuously from the beginning through the end. "
    "Do not stop, pose, freeze, or hold on a final frame. Preserve every person's identity, face, hair, wardrobe, body proportions, "
    "screen position, and count; preserve every object's count and position, food arrangement, architecture, lighting, and color temperature. "
    "Keep feet grounded, hands anatomically stable, and contact between people and objects physically consistent. "
    "Keep the camera locked unless the scene direction explicitly requests one subtle continuous camera move; never cut, reframe into another shot, "
    "change location, introduce a new action, or generate a transition. Scene-to-scene dissolves and overlays are added later by the editorial renderer. "
    "Keep mouths naturally relaxed without speech or lip-sync motion. "
    "AMBIENT MOTION: only when explicitly directed and physically plausible, allow very subtle secondary motion in existing leaves, thin branches or curtains; "
    "never add foliage, wind, objects or a second narrative action. Background extras may breathe or make tiny gaze shifts while their identity, clothes and seated positions stay fixed."
)
KLING_I2V_NEGATIVE = (
    "scene transition, cut, crossfade, dissolve, overlay, morph into another shot, location change, camera angle change, abrupt reframing, "
    "final pose, frozen ending, held last frame, looped motion, speaking, lip sync, excessive mouth motion, teleporting, floating, flying objects, "
    "sudden position jump, identity drift, face morph, wardrobe change, extra people, duplicate limbs, warped hands, sliding feet, "
    "food substitution, object rearrangement, camera shake, flicker, text, logo"
)
voice_artifact_lock = threading.Lock()
voice_generation_locks = {}
voice_generation_locks_guard = threading.Lock()
VOICE_SAMPLE_TEXT = "안녕하세요. 행복한 하루 되세요."
VOICE_PROFILES = {
    "warm_female": {
        "label": "따뜻한 여성",
        "voice": "marin",
        "instructions": "안정감 있고 친절한 한국어 여성 내레이터. 따뜻하고 신뢰감 있게, 너무 느리지 않은 자연스러운 속도로 말한다.",
    },
    "bright_female": {
        "label": "경쾌한 여성",
        "voice": "coral",
        "instructions": "밝고 경쾌하며 친절한 한국어 여성 내레이터. 생기 있게 말하되 과장하지 않고 자연스러운 속도를 유지한다.",
    },
    "steady_male": {
        "label": "차분한 남성",
        "voice": "cedar",
        "instructions": "차분하고 신뢰감 있는 한국어 남성 내레이터. 친절하고 또렷하게, 너무 느리지 않은 자연스러운 속도로 말한다.",
    },
    "qwen_narrator": {
        "label": "복제음성 A · 내레이션",
        "provider": "qwen_clone",
        "worker_profile": "petroleum",
    },
    "qwen_etp": {
        "label": "복제음성 B · ETP",
        "provider": "qwen_clone",
        "worker_profile": "etp_2k",
    },
}
auth_store_lock = threading.Lock()
_auth_store = None


class ConflictError(ValueError):
    pass


def claim_script_generation(project_id):
    with script_generation_lock:
        if project_id in active_script_generation_projects:
            return False
        active_script_generation_projects.add(project_id)
        return True


def release_script_generation(project_id):
    with script_generation_lock:
        active_script_generation_projects.discard(project_id)


def log_script_generation_failure(project_id, exc):
    diagnostic = {
        "event": "script_generation_failed",
        "project_id": project_id,
        "error_type": type(exc).__name__,
        "message": str(exc)[:800],
    }
    print(json.dumps(diagnostic, ensure_ascii=False), file=sys.stderr, flush=True)


def init_data_volume():
    EXPORTS.mkdir(parents=True, exist_ok=True)
    KLING_ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    VOICE_ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    STORYBOARD_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    CAPTION_REGISTRY_FILE.parent.mkdir(parents=True, exist_ok=True)

    seed_demo_data = APP_DIR / "data" / "demo_data.json"
    if seed_demo_data.is_file() and not DATA_FILE.is_file():
        shutil.copy2(seed_demo_data, DATA_FILE)

    seed_caption_artifacts = APP_DIR / "data" / "caption_artifacts.json"
    if seed_caption_artifacts.is_file() and not CAPTION_REGISTRY_FILE.is_file():
        shutil.copy2(seed_caption_artifacts, CAPTION_REGISTRY_FILE)


init_data_volume()


def get_auth_store():
    global _auth_store
    with auth_store_lock:
        if _auth_store is None:
            _auth_store = AuthStore(SQLITE_PATH)
        return _auth_store


def sync_default_group_resources(user_id):
    store = get_auth_store()
    schema_path = ROOT / "contracts" / "unified-content-production.schema.json"
    if not schema_path.is_file():
        return store.personal_group(user_id)
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    version = str(schema.get("properties", {}).get("schema_version", {}).get("const", "1.0.0"))
    store.put_group_resource(
        user_id, "content_schema", "unified-content-production", version, schema,
        "contracts/unified-content-production.schema.json",
    )
    prompt_dimensions = {
        "schema_version": version,
        "inheritance": ["system", "group", "project", "stage_revision"],
        "reference_asset_kinds": ["character", "location", "style"],
        "continuity_fields": ["characters", "locations", "props", "sequence.camera_axis_transition"],
        "visual_invariants": ["location_latch", "screen_axis", "furniture_geometry", "shot_delta"],
        "scene_prompt_fields": [
            "reference_ids", "characters", "image_prompt", "camera", "lighting",
            "motion_prompt", "transition", "sequence",
        ],
        "identity_lock_fields": ["character_id", "display_name", "identity_group", "appearance_lock"],
    }
    store.put_group_resource(
        user_id, "prompt_contract", "people-places-scenes", version, prompt_dimensions,
        "contracts/unified-content-production.schema.json#/$defs",
    )
    return store.personal_group(user_id)


def environment_value(name):
    value = os.environ.get(name, "")
    if value or os.name != "nt" or IS_RENDER_HOSTED:
        return value
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
            registry_value, _ = winreg.QueryValueEx(key, name)
        return str(registry_value)
    except (FileNotFoundError, OSError):
        return ""

PROVIDER_CONFIG = {
    "openai": {
        "label": "OpenAI",
        "fields": [{"id": "api_key", "label": "API key", "env": "OPENAI_API_KEY", "secret": True}],
        "docs": "https://platform.openai.com/docs/quickstart",
    },
    "anthropic": {
        "label": "Anthropic Claude",
        "fields": [{"id": "api_key", "label": "API key", "env": "ANTHROPIC_API_KEY", "secret": True}],
        "docs": "https://docs.anthropic.com/en/api/getting-started",
    },
    "gemini": {
        "label": "Google Gemini · Nano Banana",
        "fields": [{"id": "api_key", "label": "API key", "env": "GEMINI_API_KEY", "secret": True}],
        "docs": "https://ai.google.dev/gemini-api/docs/api-key",
    },
    "byteplus": {
        "label": "BytePlus ModelArk · Seedance",
        "fields": [{"id": "api_key", "label": "API key", "env": "ARK_API_KEY", "secret": True}],
        "docs": "https://docs.byteplus.com/en/docs/ModelArk/1541594",
    },
    "kling": {
        "label": "Kling AI",
        "fields": [{"id": "api_key", "label": "API key", "env": "KLING_API_KEY", "secret": True}],
        "docs": "https://kling.ai/document-api/api/get-started/authentication",
    },
}

STEP_PROVIDERS = {
    "1": [],
    "2": ["openai", "anthropic"],
    "3": ["gemini", "openai"],
    "4": ["byteplus", "kling"],
    "5": [],
}


def provider_values(provider):
    definition = PROVIDER_CONFIG[provider]
    with provider_credentials_lock:
        overrides = dict(provider_credentials.get(provider, {}))
    return {
        field["id"]: overrides.get(field["id"]) or environment_value(field["env"])
        for field in definition["fields"]
    }


def provider_status_payload():
    statuses = {}
    for provider, definition in PROVIDER_CONFIG.items():
        values = provider_values(provider)
        configured = all(str(values.get(field["id"], "")).strip() for field in definition["fields"])
        with provider_credentials_lock:
            source = "session" if provider in provider_credentials else "environment" if configured else "none"
        statuses[provider] = {"configured": configured, "source": source}
    return {
        "ok": True,
        "schema_version": "1.0.0",
        "hosted": IS_RENDER_HOSTED,
        "providers": PROVIDER_CONFIG,
        "steps": STEP_PROVIDERS,
        "statuses": statuses,
    }


def b64url(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def kling_token(access_key, secret_key):
    now = int(time.time())
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = b64url(json.dumps({"iss": access_key, "exp": now + 1800, "nbf": now - 5}, separators=(",", ":")).encode())
    signing_input = f"{header}.{payload}".encode()
    signature = b64url(hmac.new(secret_key.encode(), signing_input, hashlib.sha256).digest())
    return f"{header}.{payload}.{signature}"


def test_provider_connection(provider, values):
    if provider == "openai":
        request = Request("https://api.openai.com/v1/models", headers={"Authorization": f"Bearer {values['api_key']}"})
    elif provider == "anthropic":
        request = Request("https://api.anthropic.com/v1/models?limit=1", headers={"x-api-key": values["api_key"], "anthropic-version": "2023-06-01"})
    elif provider == "gemini":
        request = Request("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", headers={"x-goog-api-key": values["api_key"]})
    elif provider == "byteplus":
        request = Request("https://ark.ap-southeast.bytepluses.com/api/v3/models", headers={"Authorization": f"Bearer {values['api_key']}"})
    elif provider == "kling":
        request = Request("https://api.klingai.com/v1/videos/image2video?pageNum=1&pageSize=1", headers={"Authorization": f"Bearer {values['api_key']}"})
    else:
        raise ValueError("지원하지 않는 API 공급자입니다.")
    try:
        with urlopen(request, timeout=RUNTIME_CONFIG["provider_probe_timeout"]) as response:
            if not 200 <= response.status < 300:
                raise ValueError(f"연결 확인 실패 (HTTP {response.status})")
    except HTTPError as exc:
        safe_messages = {401: "인증에 실패했습니다. 키를 다시 확인해 주세요.", 403: "키 권한 또는 API 사용 설정을 확인해 주세요.", 429: "요청 한도 또는 결제 상태를 확인해 주세요."}
        raise ValueError(safe_messages.get(exc.code, f"공급자 응답 오류 (HTTP {exc.code})")) from None
    except (URLError, TimeoutError) as exc:
        raise ValueError(f"공급자 서버에 연결하지 못했습니다: {getattr(exc, 'reason', '시간 초과')}") from None


keyword_preview_lock = threading.Lock()
keyword_preview_cache = {}
keyword_preview_pending = set()


def korea_keyword_context(local_date):
    month = datetime.strptime(local_date, "%Y-%m-%d").month
    season = "봄" if 3 <= month <= 5 else "여름" if 6 <= month <= 8 else "가을" if 9 <= month <= 11 else "겨울"
    themes = {
        1: "새해 인사, 겨울 일상", 2: "겨울방학, 새학기 준비", 3: "새학기, 봄맞이",
        4: "봄나들이, 봄꽃", 5: "가정의 달, 가족 감사", 6: "초여름, 여름 준비",
        7: "여름휴가, 장마철 일상", 8: "여름휴가, 늦여름", 9: "가을맞이, 지역 문화 활동",
        10: "가을 나들이, 한글 문화", 11: "김장 문화, 겨울 준비", 12: "연말 감사, 겨울 행사",
    }
    return {"country": "KR", "timezone": "Asia/Seoul", "local_date": local_date,
            "season": season, "themes": themes[month], "live_events_verified": False}


def openai_seasonal_keywords(api_key, local_date, existing_labels, count=None):
    if count is not None and (type(count) is not int or not 1 <= count <= 5):
        raise ValueError("추천 개수는 1~5 사이의 정수여야 합니다.")
    if not api_key:
        raise ValueError("OpenAI API 키가 연결되지 않았습니다.")
    model = os.environ.get("OPENAI_TEXT_MODEL", "gpt-4.1-mini")
    context = korea_keyword_context(local_date)
    amount = f"정확히 {count}개" if count is not None else "2~3개"
    prompt = (
        f"대한민국(Asia/Seoul) 기준 오늘은 {local_date}, 계절은 {context['season']}이다. "
        f"이번 달 참고 주제: {context['themes']}. 생각담 소셜 콘텐츠 제작용 한국어 키워드를 {amount} 추천하라. "
        "대상 업종은 대한민국 요양원(노인요양시설)이다. 일반 관광·축제·상업시설 홍보가 아니다. "
        "모든 키워드는 요양원 어르신의 존엄한 일상, 돌봄, 가족 면회·소통, 시설 안 계절 프로그램, "
        "생활 지원, 직원의 배려 중 하나와 구체적으로 연결하라. 보호자에게 전하는 따뜻하고 신뢰할 수 있는 콘텐츠를 기획하라. "
        "계절·행사 주제도 어르신의 참여와 안전을 고려한 시설 내 활동 관점으로 바꿔라. "
        "label 또는 description에서 요양원·어르신·보호자·돌봄 맥락이 드러나야 한다. "
        "실제로 진행한 행사, 제공 중인 서비스, 입소자 개인 사례나 시설 인증을 지어내지 말고 콘텐츠 기획 주제로 제안하라. "
        "치료·완치·치매 개선 보장 등 의학적 효능 주장, 입소자 개인정보, 어르신을 유아화하는 표현을 금지한다. "
        "실시간 검색이나 행사 일정 확인은 제공되지 않았다. 특정 지역 축제의 개최 여부·일정·장소, "
        "음력 명절의 양력 날짜, 임시·대체공휴일, 실시간 인기나 날씨를 추정하거나 단정하지 말라. "
        "검증되지 않은 고유 행사명 대신 일반적인 계절·행사 기획 주제를 제안하라. "
        f"기존 키워드({', '.join(existing_labels)})와 중복하지 말라. "
        "각 항목은 label과 28자 이하의 description을 가진다. {\"keywords\":[...]} 형태의 JSON 객체만 출력하라."
    )
    body = {
        "model": model,
        "input": prompt,
        "max_output_tokens": 800,
        "store": False,
        "text": {"format": {"type": "json_object"}},
    }
    request = Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=RUNTIME_CONFIG["openai_keywords_timeout"]) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        safe = {400: "시즌 추천 요청 형식을 확인해 주세요.", 401: "OpenAI API 키 인증에 실패했습니다.", 429: "OpenAI API 요청 한도 또는 결제 상태를 확인해 주세요."}
        raise RuntimeError(safe.get(exc.code, f"OpenAI API 응답 오류 (HTTP {exc.code})")) from None
    except (URLError, TimeoutError):
        raise RuntimeError("OpenAI 시즌 추천 연결 시간이 초과되었습니다.") from None
    output_text = "".join(
        str(content.get("text", ""))
        for item in result.get("output", [])
        for content in item.get("content", [])
        if content.get("type") == "output_text"
    )
    try:
        parsed = json.loads(output_text)
        raw_keywords = parsed.get("keywords", parsed) if isinstance(parsed, dict) else parsed
    except json.JSONDecodeError:
        raise RuntimeError("OpenAI 시즌 추천 결과를 읽지 못했습니다.") from None
    if not isinstance(raw_keywords, list) or (len(raw_keywords) != count if count is not None else not 2 <= len(raw_keywords) <= 3):
        raise RuntimeError("OpenAI 시즌 추천 항목 수가 올바르지 않습니다.")
    keywords = []
    seen = {''.join(str(label).split()).casefold() for label in existing_labels}
    for index, item in enumerate(raw_keywords):
        if not isinstance(item, dict) or not str(item.get("label", "")).strip():
            raise RuntimeError("OpenAI 시즌 추천 형식이 올바르지 않습니다.")
        label = str(item["label"]).strip()[:30]
        if ''.join(label.split()).casefold() in seen:
            raise RuntimeError("추천 키워드가 중복되었습니다. 다시 시도해 주세요.")
        seen.add(''.join(label.split()).casefold())
        keywords.append({
            "id": f"season-{local_date}-{index + 1}",
            "label": label,
            "description": str(item.get("description", "시즌 콘텐츠 추천")).strip()[:60],
            "image": "warmth",
            "seasonal": True,
        })
    return keywords, result


def openai_tts_audio(api_key, text, profile_id, response_format="wav"):
    if not api_key:
        raise ValueError("OpenAI API 키가 연결되지 않았습니다.")
    profile = VOICE_PROFILES.get(profile_id)
    if not profile:
        raise ValueError("선택한 음성 프로필을 찾을 수 없습니다.")
    body = {
        "model": os.environ.get("OPENAI_TTS_MODEL", "gpt-4o-mini-tts"),
        "voice": profile["voice"],
        "input": str(text).strip(),
        "instructions": profile["instructions"],
        "response_format": response_format,
        "speed": 1.0,
        "stream_format": "sse",
    }
    request = Request(
        "https://api.openai.com/v1/audio/speech",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=RUNTIME_CONFIG["openai_tts_timeout"]) as response:
            payload = response.read()
            content_type = response.headers.get("Content-Type", "")
            usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
            if "text/event-stream" in content_type or payload.lstrip().startswith(b"data:"):
                chunks = []
                for line in payload.decode("utf-8", errors="replace").splitlines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if not data or data == "[DONE]":
                        continue
                    try:
                        event = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    if event.get("type") == "speech.audio.delta" and event.get("audio"):
                        chunks.append(base64.b64decode(event["audio"]))
                    if event.get("type") == "speech.audio.done":
                        raw_usage = event.get("usage") or {}
                        usage = {key: int(raw_usage.get(key, 0)) for key in
                                 ("input_tokens", "output_tokens", "total_tokens")}
                if not chunks:
                    raise RuntimeError("OpenAI 음성 스트림에 오디오 데이터가 없습니다.")
                payload = b"".join(chunks)
            return payload, response.headers.get("x-request-id", ""), body["model"], usage
    except HTTPError as exc:
        safe = {400: "음성 생성 요청 형식을 확인해 주세요.", 401: "OpenAI API 키 인증에 실패했습니다.", 429: "OpenAI 음성 API 요청 한도 또는 결제 상태를 확인해 주세요."}
        raise RuntimeError(safe.get(exc.code, f"OpenAI 음성 API 응답 오류 (HTTP {exc.code})")) from None
    except (URLError, TimeoutError):
        raise RuntimeError("OpenAI 음성 생성 연결 시간이 초과되었습니다.") from None


def scene_reference_paths(document, scene):
    references = {item.get("id"): item for item in (document.get("production") or {}).get("reference_assets", [])}
    paths = []
    for reference_id in scene.get("reference_ids", []):
        reference = references.get(reference_id, {})
        uri = str(reference.get("uri", ""))
        kind = str(reference.get("kind", ""))
        folder = "characters" if kind == "character" else "locations" if kind == "location" else ""
        candidate = Path(os.environ.get("DATA_DIR", str(APP_DIR / "data"))) / "group_resources" / "defaults" / folder / Path(uri).name
        if folder and candidate.is_file():
            paths.append(candidate)
    if len(paths) != len(scene.get("reference_ids", [])):
        raise ValueError("이 씬의 시설·캐릭터 참조 이미지가 서버에 모두 준비되지 않았습니다.")
    return paths


def storyboard_image_path(uri):
    parsed = urlparse(str(uri or ""))
    if parsed.path != "/api/storyboard/image":
        return None
    query = parse_qs(parsed.query)
    parts = [str(query.get(key, [""])[0]).strip() for key in
             ("project_id", "revision_id", "scene_id", "file")]
    if not all(value and Path(value).name == value for value in parts):
        return None
    candidate = STORYBOARD_IMAGE_DIR.joinpath(*parts)
    return candidate if candidate.is_file() else None


def voice_audio_path(uri):
    parsed = urlparse(str(uri or ""))
    if parsed.path != "/api/voice/audio":
        return None
    query = parse_qs(parsed.query)
    parts = [str(query.get(key, [""])[0]).strip() for key in
             ("project_id", "revision_id", "profile", "file")]
    if not all(value and Path(value).name == value for value in parts):
        return None
    candidate = VOICE_ARTIFACT_DIR.joinpath(*parts)
    return candidate if candidate.is_file() else None


def brand_asset_path(uri):
    filename = Path(str(uri or "")).name
    path = (BRAND_ASSET_DIR / filename).resolve()
    root = BRAND_ASSET_DIR.resolve()
    return path if filename and path.parent == root and path.is_file() else None


def media_duration(path):
    ffprobe = shutil.which("ffprobe") or str(Path(find_ffmpeg()).with_name("ffprobe"))
    completed = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True, timeout=RUNTIME_CONFIG["ffprobe_timeout"], check=True,
    )
    return max(.1, float(completed.stdout.strip()))


def continuity_locked_prompt(document, scene, base_prompt):
    production = document.get("production") or {}
    continuity = production.get("continuity") or {}
    sequence = scene.get("sequence") or {}
    scenes = (production.get("timeline") or {}).get("scenes") or []
    is_final_scene = bool(scenes and scene.get("id") == scenes[-1].get("id"))
    final_scene_directive = (
        "\n- FINAL SCENE — unless safety, dignity, or the story makes it inappropriate, frame one main character in a composed frontal view looking naturally toward the camera lens; end with a restrained, warm, reassuring expression. This must be visibly different from the previous shot."
        if is_final_scene else ""
    )
    return f"""{base_prompt}

CONTINUITY EXECUTION LOCK:
- Use only this scene's canonical character and facility reference images. Previously generated scene images are not reference inputs. Ignore any earlier instruction to copy or inherit an approved frame image.
- Sequence anchor: {sequence.get('continuity_anchor', '')}; blocking: {sequence.get('character_blocking', '')}.
- SPATIAL PROGRESSION LOCK: follow the written entry and exit actions. When a facility entrance door opens, the next action moves inward through it and the next scene shows the interior destination, not another view of the doorway. A crossed threshold is behind the characters; never repeat the entrance or return to the previous side without an explicit return journey.
- LOCATION LATCH: once a scene has entered a location, keep subsequent scenes in that location until an explicit, narratively motivated exit and visible travel/threshold sequence occurs. Never jump back to a previous room, side of a doorway, or location on the immediately following scene. A camera angle or crop change is not a location transition.
- SCREEN-AXIS LOCK: planned transition=${sequence.get('camera_axis_transition', 'same_side')}. Preserve the established camera side of the 180-degree action axis and the left/right eyelines across adjacent scenes. Do not move the camera to the opposite side of a table or exchange the characters' screen positions when changing shot size. A close-up or reaction shot must remain on the established side; only cross the axis when a visible camera move or character movement motivates it.
- Set sequence.camera_axis_transition to establish on the first scene, same_side by default afterwards, and motivated_cross only when the camera or characters visibly travel across the axis in this scene.
- Character continuity: {json.dumps(continuity.get('characters', []), ensure_ascii=False)}
- MAIN SUBJECT SAFE FRAME: compose a full-bleed 16:9 landscape scene, while keeping at least one narrative main subject's visible head, torso and action-relevant hands within a centered 9:16 crop-safe window with breathing room. The 9:16 window is only a crop-safe area inside the landscape image; never render it as a separate panel. Avoid extreme close-ups or widely spread arms. This protection applies ONLY to main subjects, NOT background extras; never substitute an extra as the crop target.
- BACKGROUND CAST LEDGER: permit only the incidental extras explicitly planned in the scene and character continuity ledger. Preserve their anonymous production IDs, appearance, clothing, seats, orientation and ongoing action across connected shots in the same space/time. They may fall outside the frame as framing changes, but must return unchanged unless an explicit movement or time change is planned. Do not invent canonical reference assets for extras.
- Location continuity: {json.dumps(continuity.get('locations', []), ensure_ascii=False)}
- Prop continuity: {json.dumps(continuity.get('props', []), ensure_ascii=False)}
- PROP/FOOD STATE LOCK: when food or a dining table is described in consecutive scene records, preserve the menu items, dish and bowl count, plating, portions, garnish, tableware direction, and table positions. Never add, remove, substitute, redesign, or rearrange food or props.
- FURNITURE GEOMETRY LOCK: reproduce every visible table and furniture silhouette from the canonical location reference exactly, including round versus square/rectangular shape, proportions, edge profile, leg count, material, and orientation. Never change a round table into a square/rectangular table (or vice versa), even for a new camera angle or close-up.
- Preserve identity and wardrobe, but follow this scene's location reference and written action when the story changes rooms. Keep architecture and furniture stable only within the same location.
- The image must depict this scene's distinct action, camera framing, and current zone. A near-duplicate of another scene or a repeated doorway composition is a failed result.
- SHOT DELTA PLAN: when the written adjacent shots would look similar, visibly change shot distance, permitted zoom or camera angle on the same screen axis as directed by this scene; preserve the main-subject safe frame and the actual background seating/furniture state. Do not rearrange people or furniture merely to make the image different. Camera changes are between independently composed scenes, never an in-clip generated cut.
- ABSOLUTE PROHIBITION — the entire output MUST be a single continuous, full-bleed 16:9 landscape scene. NEVER add white or black bars, letterboxing, borders, margins, inset frames, split panels, or a portrait image pasted inside the landscape canvas. These are forbidden even if any other prompt text suggests a portrait layout or framed composition. The centered 9:16 crop-safe window is composition guidance only and MUST NOT appear as a visible panel or boundary.
- If the scene prompt says "vertical 9:16 frame/image", interpret that only as the subject's crop-safe area inside the 16:9 landscape image; NEVER make the generated canvas portrait or place a portrait scene inside it.
- DISTINCT SHOT LOCK — this independently composed scene must be visibly distinguishable from its adjacent scenes. Follow this scene's own action and framing; do not default to repeating the same two-person composition. A single person's close-up, a wider view, or a prop/action detail is allowed when supported by the story. Continuity locks identities, location state, and props, not a requirement to show every character in every frame.
{final_scene_directive}
- No text, captions, logos, unplanned people beyond the declared main cast and background extras, duplicate objects, or continuity-breaking substitutions."""


def multipart_body(fields, files):
    boundary = f"thinkcast-{uuid.uuid4().hex}"
    chunks = []
    for name, value in fields.items():
        chunks.extend([
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode("utf-8")
        ])
    for name, path in files:
        mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
        chunks.extend([
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{path.name}\"\r\nContent-Type: {mime}\r\n\r\n".encode("utf-8"),
            path.read_bytes(), b"\r\n",
        ])
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def openai_reference_image(api_key, model, prompt, reference_paths):
    allowed = {"gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2"}
    if model not in allowed:
        raise ValueError("지원 목록에 없는 OpenAI 이미지 모델입니다.")
    if not reference_paths:
        raise ValueError("시설 또는 캐릭터 참조 이미지가 없는 씬은 생성할 수 없습니다.")
    fields = {
        "model": model, "prompt": prompt, "size": "1536x1024",
        "quality": "auto", "output_format": "webp",
    }
    body, content_type = multipart_body(fields, [("image[]", path) for path in reference_paths])
    request = Request(
        "https://api.openai.com/v1/images/edits", data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": content_type}, method="POST",
    )
    try:
        with urlopen(request, timeout=RUNTIME_CONFIG["openai_image_timeout"]) as response:
            return json.loads(response.read().decode("utf-8")), response.headers.get("x-request-id", "")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"OpenAI 참조 이미지 생성에 실패했습니다. (HTTP {exc.code}: {detail})") from None
    except (URLError, TimeoutError):
        raise RuntimeError("OpenAI 이미지 생성 연결 시간이 초과되었습니다.") from None


def qwen_clone_audio(text, worker_profile):
    base_url = os.environ.get("ARUN_TTS_WORKER_URL", "").rstrip("/")
    api_key = os.environ.get("ARUN_TTS_WORKER_KEY", "")
    if not base_url or not api_key:
        raise ValueError("Qwen 복제음성 워커가 연결되지 않았습니다.")
    headers = {"X-ARUN-TTS-Key": api_key, "Content-Type": "application/json"}
    request = Request(
        f"{base_url}/v1/voice-clone/jobs",
        data=json.dumps({"text": str(text).strip(), "profile": worker_profile}, ensure_ascii=False).encode("utf-8"),
        headers=headers, method="POST",
    )
    try:
        with urlopen(request, timeout=RUNTIME_CONFIG["qwen_submit_timeout"]) as response:
            job = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        if exc.code == 429:
            raise RuntimeError("Qwen 음성 생성 대기열이 가득 찼습니다. 잠시 후 다시 시도해 주세요.") from None
        raise RuntimeError(f"Qwen 음성 생성 요청에 실패했습니다. (HTTP {exc.code})") from None
    except (URLError, TimeoutError):
        raise RuntimeError("Qwen 복제음성 워커에 연결할 수 없습니다.") from None
    job_id = str(job.get("job_id", ""))
    if not job_id:
        raise RuntimeError("Qwen 워커가 작업 ID를 반환하지 않았습니다.")
    status_headers = {"X-ARUN-TTS-Key": api_key}
    deadline = time.monotonic() + RUNTIME_CONFIG["qwen_deadline"]
    while time.monotonic() < deadline:
        time.sleep(RUNTIME_CONFIG["qwen_poll_interval"])
        try:
            with urlopen(Request(f"{base_url}/v1/voice-clone/jobs/{job_id}", headers=status_headers), timeout=RUNTIME_CONFIG["qwen_poll_timeout"]) as response:
                status = json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError):
            continue
        if status.get("status") == "failed":
            raise RuntimeError("Qwen 복제음성 생성에 실패했습니다.")
        if status.get("status") != "succeeded":
            continue
        try:
            with urlopen(Request(f"{base_url}/v1/voice-clone/jobs/{job_id}/audio", headers=status_headers), timeout=RUNTIME_CONFIG["qwen_audio_timeout"]) as response:
                return response.read(), job_id, "Qwen/Qwen3-TTS-12Hz-0.6B-Base", {
                    "input_tokens": 0, "output_tokens": 0, "total_tokens": 0,
                }
        except (HTTPError, URLError, TimeoutError):
            raise RuntimeError("생성된 Qwen 음성을 내려받지 못했습니다.") from None
    raise RuntimeError("Qwen 복제음성 생성 시간이 초과되었습니다.")


def ensure_voice_sample(api_key, profile_id):
    if profile_id not in VOICE_PROFILES:
        raise ValueError("선택한 음성 프로필을 찾을 수 없습니다.")
    profile = VOICE_PROFILES[profile_id]
    qwen = profile.get("provider") == "qwen_clone"
    sample_dir = VOICE_ARTIFACT_DIR / "samples"
    sample_path = sample_dir / f"{profile_id}.{'wav' if qwen else 'mp3'}"
    with voice_artifact_lock:
        if sample_path.is_file() and sample_path.stat().st_size > 0:
            return sample_path
        if qwen:
            audio, _, _, _ = qwen_clone_audio(VOICE_SAMPLE_TEXT, profile["worker_profile"])
        else:
            audio, _, _, _ = openai_tts_audio(api_key, VOICE_SAMPLE_TEXT, profile_id, "mp3")
        sample_dir.mkdir(parents=True, exist_ok=True)
        temporary = sample_path.with_suffix(".tmp")
        temporary.write_bytes(audio)
        temporary.replace(sample_path)
    return sample_path


def generate_voice_clips(api_key, user_id, project_id, script_revision, document, profile_id,
                         target_scene_id=None):
    key=(user_id,project_id,script_revision['revision_id'],profile_id)
    with voice_generation_locks_guard:
        lock=voice_generation_locks.setdefault(key,threading.Lock())
    # Serialize manual/bulk requests for the same revision; cue workers inside
    # one batch remain parallel and completed WAVs are reused on replay.
    with lock:
        return _generate_voice_clips(api_key,user_id,project_id,script_revision,document,profile_id,target_scene_id)


def _generate_voice_clips(api_key, user_id, project_id, script_revision, document, profile_id,
                          target_scene_id=None):
    profile = VOICE_PROFILES.get(profile_id)
    if not profile:
        raise ValueError("선택한 음성 프로필을 찾을 수 없습니다.")
    production = document.get("production") or {}
    cues = list(enumerate(production.get("narration_cues", [])))
    if not cues:
        raise ValueError("생성할 나레이션 큐가 없습니다.")
    revision_id = script_revision["revision_id"]
    output_dir = VOICE_ARTIFACT_DIR / project_id / revision_id / profile_id
    output_dir.mkdir(parents=True, exist_ok=True)
    cue_scene_ids = {}
    target_cue_ids = None
    for scene in production.get("timeline", {}).get("scenes", []):
        if target_scene_id and scene.get("id") == target_scene_id:
            target_cue_ids = {str(item) for item in scene.get("narration_cue_ids", [])}
        for cue_id in scene.get("narration_cue_ids", []):
            cue_scene_ids.setdefault(str(cue_id), str(scene.get("id") or cue_id))
    if target_scene_id:
        if target_cue_ids is None:
            raise ValueError("음성을 생성할 씬을 찾을 수 없습니다.")
        cues = [(index,cue) for index,cue in cues if str(cue.get("id")) in target_cue_ids]
        if not cues:
            raise ValueError("이 씬에 연결된 나레이션 문장이 없습니다.")
    existing_clips=get_auth_store().list_scene_voice_clips(user_id,project_id,revision_id)

    def generate(index_cue):
        index, cue = index_cue
        cue_id = str(cue.get("id") or f"cue-{index + 1:02d}")
        text = str((cue.get("narration") or {}).get("text", "")).strip()
        if not text:
            raise ValueError(f"{cue_id} 나레이션 문장이 비어 있습니다.")
        text_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
        filename = f"{index + 1:02d}_{cue_id}_{text_hash}.wav".replace("/", "_")
        path = output_dir / filename
        reused_uri = None
        # Reuse older single-scene files too; never re-synthesize merely because
        # their old ordinal or stored owner scene differs from the cue's owner.
        for existing in existing_clips:
            if existing.get('cue_id')==cue_id and existing.get('profile_id')==profile_id and existing.get('text_hash')==text_hash:
                old_path=voice_audio_path(existing.get('uri'))
                if old_path and old_path.stat().st_size>0:
                    path=old_path;filename=path.name;reused_uri=existing['uri'];break
        request_id = ""
        qwen = profile.get("provider") == "qwen_clone"
        model = "Qwen/Qwen3-TTS-12Hz-0.6B-Base" if qwen else os.environ.get("OPENAI_TTS_MODEL", "gpt-4o-mini-tts")
        reused = path.is_file() and path.stat().st_size > 0
        if not reused:
            if qwen:
                audio, request_id, model, usage = qwen_clone_audio(text, profile["worker_profile"])
            else:
                audio, request_id, model, usage = openai_tts_audio(api_key, text, profile_id, "wav")
            temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
            temporary.write_bytes(audio)
            temporary.replace(path)
        else:
            usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
        duration = None
        ffprobe = shutil.which("ffprobe")
        if ffprobe:
            probe = subprocess.run(
                [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
                capture_output=True, text=True, check=False,
            )
            try:
                duration = round(float(probe.stdout.strip()), 3)
            except ValueError:
                duration = None
        uri = reused_uri or f"/api/voice/audio?project_id={quote(project_id)}&revision_id={quote(revision_id)}&profile={quote(profile_id)}&file={quote(filename)}"
        return {
            "scene_id": cue_scene_ids.get(cue_id, cue_id),
            "cue_id": cue_id,
            "text_hash": text_hash,
            "uri": uri,
            "path": path,
            "model": model,
            "request_id": request_id,
            "reused": reused,
            "target_start": cue.get("start"),
            "target_end": cue.get("end"),
            "duration": duration,
            "usage": usage,
        }

    worker_count = 1 if profile.get("provider") == "qwen_clone" else min(RUNTIME_CONFIG["voice_workers"], len(cues))
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        clips = list(executor.map(generate, cues))
    clips.sort(key=lambda item: item["target_start"] if item["target_start"] is not None else 0)
    for clip in clips:
        checksum = hashlib.sha256(clip.pop("path").read_bytes()).hexdigest()
        registered = get_auth_store().register_artifact(
            user_id, project_id, revision_id, clip["scene_id"], "narration_wav",
            clip["uri"], f"sha256:{checksum}",
            {key: value for key, value in clip.items() if key != "uri"},
        )
        clip["artifact_id"] = registered["artifact_id"]
        if not clip["reused"]:
            clip["usage_id"] = get_auth_store().record_api_usage(
                user_id, project_id, "qwen_clone" if profile.get("provider") == "qwen_clone" else "openai", clip["model"],
                "scene_tts_generation", clip["request_id"], clip["usage"],
            )
    return {
        "profile_id": profile_id,
        "label": profile["label"],
        "provider": profile.get("provider", "openai"),
        "model": "Qwen/Qwen3-TTS-12Hz-0.6B-Base" if profile.get("provider") == "qwen_clone" else os.environ.get("OPENAI_TTS_MODEL", "gpt-4o-mini-tts"),
        "clips": clips,
    }


def group_story_reference_context(resources, character_limit=45_000, included_types=None):
    """Build a bounded prompt context from one project's already-authorized group resources."""
    sections = []
    priority = {
        "default_asset_manifest": 0,
        "reference_library": 1,
        "prompt_contract": 2,
        "canonical_storyboard_spec": 3,
        "human_storyboard_reference": 4,
        "storyboard_template": 5,
        "content_template": 6,
        "sample_manifest": 7,
    }
    selected = [item for item in resources if included_types is None or item["resource_type"] in included_types]
    for resource in sorted(selected, key=lambda item: (priority.get(item["resource_type"], 99), item["resource_key"])):
        resource_type = resource["resource_type"]
        payload = resource.get("payload", {})
        if resource_type == "default_asset_manifest":
            files = payload.get("files", [])
            value = {
                "inherit_by_default": bool(payload.get("inherit_by_default")),
                "assets": [
                    {key: item.get(key) for key in ("logical_path", "uri", "media_type")}
                    for item in files
                ],
            }
        elif resource_type == "sample_manifest":
            value = {
                "inherit_by_default": False,
                "sample_files": [item.get("logical_path") or item.get("path") for item in payload.get("files", [])],
            }
        else:
            value = payload
        section = json.dumps({
            "resource_type": resource_type,
            "resource_key": resource["resource_key"],
            "source_uri": resource.get("source_uri"),
            "value": value,
        }, ensure_ascii=False)
        if sum(len(item) for item in sections) + len(section) > character_limit:
            continue
        sections.append(section)
    return "\n".join(sections)


def openai_project_script(api_key, selected_labels, scene_specs, resource_context):
    if not api_key:
        raise ValueError("OpenAI API 키가 연결되지 않았습니다.")
    if not 1 <= len(selected_labels) <= 5:
        raise ValueError("대본 생성 키워드는 1개 이상 5개 이하이어야 합니다.")
    model = os.environ.get("OPENAI_SCRIPT_MODEL", "gpt-5.6-luna")
    prompt = f"""당신은 생각담 | ThinkCast의 한국어 콘텐츠 작가다.
선택 키워드: {json.dumps(selected_labels, ensure_ascii=False)}

아래 그룹 전용 자료만 사실과 시각 레퍼런스로 사용한다. default_asset_manifest의 시설·캐릭터는 기본 상속 자산이다.
storyboard_template/content_template/sample_manifest는 문체와 구성 참고 샘플이며, 샘플 문장을 그대로 복제하지 않는다.
다른 조직이나 그룹의 자료를 추정하거나 섞지 않는다.

[그룹 자료]
{resource_context or '등록된 그룹 자료 없음'}

[현재 미리보기 장면]
{json.dumps(scene_specs, ensure_ascii=False)}

현재 장면 순서와 개수에 맞는 대본을 작성하라. 화면에서 확인할 수 없는 치료 효과나 시설 사실을 만들지 않는다.
짧고 절제된 감성적 시문으로 장면끼리 자연스럽게 연결하고, 선택 키워드는 나열하지 말고 행동과 이미지로 표현한다.
응답은 headline(100자 이하), concept(300자 이하), lines 배열을 가진 JSON 객체 하나만 출력한다.
lines는 반드시 {len(scene_specs)}개이며 각 항목은 비어 있지 않은 한국어 문장이다."""
    body = {
        "model": model,
        "input": prompt,
        "max_output_tokens": 2500,
        "text": {"format": {"type": "json_object"}},
    }
    request = Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=RUNTIME_CONFIG["openai_script_timeout"]) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        safe = {400: "대본 생성 요청 형식을 확인해 주세요.", 401: "OpenAI API 키 인증에 실패했습니다.", 429: "OpenAI API 요청 한도 또는 결제 상태를 확인해 주세요."}
        raise RuntimeError(safe.get(exc.code, f"OpenAI API 응답 오류 (HTTP {exc.code})")) from None
    except (URLError, TimeoutError):
        raise RuntimeError("OpenAI 대본 생성 연결 시간이 초과되었습니다.") from None
    output_text = "".join(
        str(content.get("text", ""))
        for item in result.get("output", [])
        for content in item.get("content", [])
        if content.get("type") == "output_text"
    )
    try:
        script = json.loads(output_text)
    except json.JSONDecodeError:
        raise RuntimeError("OpenAI 대본 생성 결과를 읽지 못했습니다.") from None
    lines = [str(line).strip() for line in script.get("lines", [])]
    if len(lines) != len(scene_specs) or any(not line for line in lines):
        raise RuntimeError(f"OpenAI 결과의 대본 문장은 정확히 {len(scene_specs)}개여야 합니다.")
    clean_script = {
        "headline": str(script.get("headline", "")).strip()[:100] or "우리의 하루를 잇는 마음",
        "concept": str(script.get("concept", "")).strip()[:300],
        "lines": lines,
    }
    return clean_script, result


def validate_script_plan(plan):
    validate_json_schema_file(plan, ROOT / "contracts" / "script-plan.schema.json")
    beats = plan["narration_beats"]
    narration_length = sum(len(beat.strip()) for beat in beats)
    if narration_length < 180:
        raise ValueError("1차 나레이션은 총 180~210자로 작성해 주세요.")
    if narration_length > 210:
        raise ValueError("1차 나레이션은 총 210자를 넘을 수 없습니다.")
    names = {str(choice).split("—", 1)[0].split(",", 1)[0].strip()
             for choice in plan["cast_choices"]}
    names = {name for name in names if 2 <= len(name) <= 12 and " " not in name}
    if any(name in beat for name in names for beat in beats):
        raise ValueError("인물 이름은 나레이션이 아닌 캐스팅·콘티에만 넣어 주세요.")


def openai_script_plan(api_key, selected_labels, resources, recent_usage):
    if not api_key:
        raise ValueError("OpenAI API 키가 연결되지 않았습니다.")
    model = os.environ.get("OPENAI_SCRIPT_MODEL", "gpt-5.6-luna")
    context = group_story_reference_context(resources, 45_000,
        {"default_asset_manifest", "reference_library", "prompt_contract"})
    prompt = f"""생각담 | ThinkCast 한국어 콘텐츠의 1차 대본만 작성한다. JSON 객체 하나만 출력한다.
형식: {{"schema_version":"1.0.0","title":"제목","synopsis":"서사 요약","narration_beats":["실제 낭독 문장",...],"cast_choices":["자료 속 인물/역할"],"location_choices":["자료 속 장소"]}}
키워드: {json.dumps(selected_labels, ensure_ascii=False)}
그룹 자료: {context}
최근 같은 그룹의 실제 사용 인물/장소: {json.dumps(recent_usage, ensure_ascii=False)}
최근 자주 쓰인 특정 인물과 장소를 습관적으로 반복하지 말고, 이야기와 맞는 후보를 골고루 선택한다. 균등 할당을 위해 억지 인물이나 장소를 넣지는 않는다. 인물이나 장소가 바뀌면 서사상 이유를 둔다.
요양원에 대한 긍정적 인상은 과장 광고나 근거 없는 서비스·치료 효과 주장이 아니라, 제공된 자료가 뒷받침할 때 어르신의 선택을 존중하는 태도, 편안하고 정돈된 공간, 세심한 일상 돌봄, 가족과의 자연스러운 교류 같은 화면 가능한 행동으로 절제해 표현한다.
주요 인물만 cast_choices에 지정한다. 로비 등 분위기상 자연스러운 장소에는 익명 엑스트라를 연출로 보완할 수 있지만 cast_choices의 주요 인물과 구분하고 실제 시설 사실로 주장하지 않는다. 이어지는 같은 장소에서 배경 인물의 외형·옷·좌석·행동을 유지하도록 synopsis의 연출 맥락에 기록한다. 세로 크롭에 최소 한 명이 들어오는 조건은 주요 인물에게만 적용하고 엑스트라는 예외다. 구체적인 안전 여백·구도 변주·환경의 미세한 움직임은 후속 콘티에서 설계한다.
나레이션은 줄거리 해설이나 인물 행동 보고서가 아니다. 짧은 시처럼 이미지와 여운이 이어지는 낭독 카피를 2~8개 문장으로 쓰고, 전체 분량은 180~210자로 하며 200자에 가깝게 작성한다. 글자 수는 각 문장의 앞뒤 공백을 제외하고 문장 내부 공백과 문장부호를 포함해 센다. 인물의 이름과 캐릭터 ID는 cast_choices와 후속 콘티에만 쓰며 narration_beats에는 절대 넣지 않는다. '누가 무엇을 했습니다' 식의 사건 설명을 연속 나열하지 않는다. 실제 한국어로 낭독했을 때 뜻이 바로 들리는 익숙하고 자연스러운 시적 표현을 쓴다. 승인된 사람 작성 원고의 좋은 문장은 장면에 맞으면 인용해도 되지만 예시를 매번 반복하지 않는다. “내 속도로”, “곁의 눈빛이 먼저 살피고”, “방향이 놓이고”처럼 시점이나 주어·동작이 어색한 조합은 피한다. 시적인 여운은 실제 인물의 행동과 화면에 보이는 장면에서 출발한다. 한 문장 사이에 여러 씬이 들어갈 수 있지만 나레이션 없는 씬은 후속 단계에서 만들지 않는다. 이 단계에서는 씬 수, 카메라, 이미지 프롬프트를 작성하지 않는다."""
    responses = []
    def generate(input_text):
        body = {"model": model, "input": input_text, "max_output_tokens": 6_000,
                "text": {"format": {"type": "json_object"}}}
        request = Request("https://api.openai.com/v1/responses",
            data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}, method="POST")
        try:
            with urlopen(request, timeout=RUNTIME_CONFIG["openai_script_timeout"]) as response:
                result = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            raise RuntimeError(f"OpenAI 1차 대본 응답 오류 (HTTP {exc.code})") from None
        except (URLError, TimeoutError):
            raise RuntimeError("OpenAI 1차 대본 연결 시간이 초과되었습니다.") from None
        responses.append(result)
        output = "".join(str(content.get("text", "")) for item in result.get("output", [])
                         for content in item.get("content", []) if content.get("type") == "output_text")
        try:
            return json.loads(output)
        except json.JSONDecodeError:
            raise RuntimeError("1차 대본 JSON을 읽지 못했습니다.") from None

    plan = generate(prompt)
    for attempt in range(2):
        try:
            validate_script_plan(plan)
            break
        except (JsonSchemaError, TypeError, ValueError) as exc:
            if attempt:
                raise RuntimeError("1차 대본의 나레이션 형식 검증에 실패했습니다. 다시 요청해 주세요.") from None
            plan = generate(
                "아래 1차 대본 JSON을 형식에 맞게 고쳐 완전한 JSON 객체 하나만 출력하라. "
                "인물 이름 없는 짧은 시적 나레이션으로 바꾸되 제목·캐스팅·장소·서사 취지는 유지하라. "
                f"검증 오류: {exc}\n이전 결과: {json.dumps(plan, ensure_ascii=False)}"
            )
    usage = {key: sum(int(item.get("usage", {}).get(key, 0)) for item in responses)
             for key in ("input_tokens", "output_tokens", "total_tokens")}
    result = responses[-1]
    return plan, {"id": result.get("id", ""), "model": result.get("model", model),
                  "usage": usage, "request_count": len(responses)}


def openai_unified_storyboard(api_key, selected_labels, resources, previous_documents, script_plan=None):
    if not api_key:
        raise ValueError("OpenAI API 키가 연결되지 않았습니다.")
    model = os.environ.get("OPENAI_SCRIPT_MODEL", "gpt-5.6-luna")
    source_material = group_story_reference_context(
        resources, 55_000,
        {"default_asset_manifest", "reference_library", "prompt_contract"},
    )
    source_material += """

[필수 화면 연출 잠금]
- 모든 씬 이미지는 풀블리드 16:9 가로 원본이다. 9:16은 중앙 크롭 안전영역일 뿐이다. 세로 이미지 삽입, 흰/검은 레터박스, 테두리, 분할 패널을 절대 생성하지 않는다.
- 인접 씬마다 샷을 실제로 다르게 만든다. 같은 공간이라도 매번 같은 두 인물 투샷을 반복하지 않는다. 서사에 맞게 한 명만 줌인/클로즈업하거나, 와이드로 줌아웃하거나, 손·소품 디테일 또는 상대 리액션숏으로 전환한다. 매 씬의 주 피사체/행동 및 프레이밍을 직전 씬과 분명히 다르게 쓰고 image_prompt와 camera에 구체화한다. 동일 구도에서 미세한 줌만 바꾼 연속 씬은 허용하지 않는다.
- 한번 이동한 장소는 명시적이고 서사적인 귀환 동선이 보이기 전까지 유지한다. A→B→A 복귀에는 이유와 사이 장면의 이동 경로가 있어야 한다. 화면 크기를 바꿔도 확립된 180도 동작축과 인물 좌우·시선은 유지한다.
- sequence.camera_axis_transition은 첫 씬 establish, 이후 기본 same_side로 기록한다. 실제 화면상 이동을 보여줄 때만 motivated_cross를 쓰고 camera_bridge에 이동을 명시한다.
- 제공된 장소 레퍼런스에 보이는 테이블·가구의 형태, 윤곽, 비율, 모서리, 다리 수, 재질과 방향을 바꾸지 않는다. 확인된 형태를 continuity.props 및 그 장소를 사용하는 모든 image_prompt에 명시하고, 원형을 사각형으로 바꾸는 등의 형태 변형은 금지한다.
- 마지막 씬은 가능하면 주인공 한 명의 정면 구도와 자연스러운 카메라 렌즈 응시로 마무리한다. 안전·존엄·서사상 부적절한 경우에만 사유를 명시해 예외로 한다.
- 요양원의 좋은 인상은 어르신의 선택과 존엄을 지키는 눈높이 소통, 편안하고 정돈된 공간, 실제 장면에 근거한 세심한 돌봄과 가족 교류로 절제해 표현한다. 제공되지 않은 설비·서비스 실적·치료 효과를 꾸며 홍보하지 않는다.
"""
    if script_plan:
        source_material += "\n확정된 1차 대본(2차에서 제목과 나레이션 문장을 그대로 유지): " + json.dumps(script_plan, ensure_ascii=False)
        source_material += "\n2차 콘티에서는 확정 대본을 씬으로 확장한다. 제목과 나레이션 원문을 새 시어로 바꾸거나 어색한 비유를 덧붙이지 않는다. 모든 씬은 나레이션 큐에 속해야 한다. 인물/장소 선택은 1차와 일치시킨다. 각 씬의 현재 구역, 문턱 통과, 이동 방향, 다음 도착 구역을 sequence에 명시한다. 문을 열고 들어갔다면 다음 씬은 내부 장소이며 문 앞 재등장과 왕복을 금지한다."
    reference_material = group_story_reference_context(
        resources, 40_000,
        {"canonical_storyboard_spec"},
    )
    responses = []

    def generate(prompt):
        body = {
            "model": model,
            "input": prompt,
            "max_output_tokens": 24_000,
            "text": {"format": {"type": "json_object"}},
        }
        request = Request(
            "https://api.openai.com/v1/responses",
            data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=RUNTIME_CONFIG["openai_script_timeout"]) as response:
                result = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            safe = {400: "최종대본 생성 요청 형식을 확인해 주세요.", 401: "OpenAI API 키 인증에 실패했습니다.", 429: "OpenAI API 요청 한도 또는 결제 상태를 확인해 주세요."}
            raise RuntimeError(safe.get(exc.code, f"OpenAI API 응답 오류 (HTTP {exc.code})")) from None
        except (URLError, TimeoutError):
            raise RuntimeError("OpenAI 최종대본 생성 연결 시간이 초과되었습니다.") from None
        responses.append(result)
        return "".join(
            str(content.get("text", ""))
            for item in result.get("output", [])
            for content in item.get("content", [])
            if content.get("type") == "output_text"
        )

    generated = run_generation_harness(
        generate, selected_labels, source_material,
        previous_documents=previous_documents,
        reference_material=reference_material,
        strict_schema=True,
        provenance={
            "source_files": [f"group-resource:{item['resource_id']}" for item in resources] or ["group-resource:none"],
            "ai_additions_marked": True,
            "notes": ["그룹 리소스를 참조해 AI가 생성한 필드는 source=ai_inferred로 구분함."],
        },
        locked_plan=script_plan,
    )
    usage = {
        key: sum(int(item.get("usage", {}).get(key, 0)) for item in responses)
        for key in ("input_tokens", "output_tokens", "total_tokens")
    }
    provider = responses[-1] if responses else {}
    return generated, {
        "id": provider.get("id", ""),
        "model": provider.get("model", model),
        "usage": usage,
        "request_count": len(responses),
    }


def unified_document_view(document):
    variants = {item.get("id"): item for item in document.get("concept_variants", [])}
    selected = variants.get(document.get("selected_variant_id"), {})
    production = document.get("production") or {}
    cues = production.get("narration_cues", [])
    cue_indexes = {cue.get("id"): index for index, cue in enumerate(cues)}
    timeline = []
    used_cues = set()
    for index, scene in enumerate(production.get("timeline", {}).get("scenes", [])):
        cue_ids = scene.get("narration_cue_ids", [])
        cue_id = cue_ids[0] if cue_ids else None
        cue = cues[cue_indexes[cue_id]] if cue_id in cue_indexes else {}
        line_index = None
        if cue_id and cue_id not in used_cues:
            line_index = cue_indexes[cue_id]
            used_cues.add(cue_id)
        timeline.append({
            "id": scene.get("id") or f"scene-{index + 1:02d}",
            "name": scene.get("title") or f"장면 {index + 1}",
            "media_type": scene.get("media_type", "image"),
            "preview_uri": scene.get("source_media") or "",
            "start": scene.get("start"),
            "end": scene.get("end"),
            "cue_start": cue.get("start"),
            "cue_end": cue.get("end"),
            "narration_cue_id": cue_id,
            "script_line_index": line_index,
            "reference_ids": scene.get("reference_ids", []),
            "image_prompt": scene.get("image_prompt", {}),
        })
    script = {
        "headline": str(selected.get("title") or document.get("project", {}).get("title") or "최종대본"),
        "concept": str(selected.get("core_message") or selected.get("theme") or ""),
        "lines": [str(cue.get("narration", {}).get("text", "")).strip() for cue in cues],
    }
    narration_tracks = [
        {"rate": 1, "src": cue.get("audio_uri") or ""}
        for cue in cues
    ]
    return script, {
        "duration_source": "timeline.scenes[-1].end",
        "scenes": timeline,
        "narration_tracks": narration_tracks,
    }


def timeline_with_voice_durations(timeline, voice_clips):
    """Retime each narration cue and distribute its measured span across its scenes."""
    adjusted = json.loads(json.dumps(timeline, ensure_ascii=False))
    tracks = list(adjusted.get("narration_tracks") or [])
    scenes = adjusted.get("scenes", [])
    if not scenes:
        return adjusted
    clips_by_scene = {str(item.get("scene_id")): item for item in voice_clips}
    clips_by_cue = {}
    for item in voice_clips:
        cue_id = str(item.get("cue_id") or "")
        if cue_id and cue_id not in clips_by_cue:
            clips_by_cue[cue_id] = item
    group_starts = [index for index, scene in enumerate(scenes) if scene.get("script_line_index") is not None]
    if not group_starts or group_starts[0] != 0:
        raise ValueError("나레이션 큐가 연결되지 않은 씬이 있습니다.")
    group_starts.append(len(scenes))
    groups = [scenes[start:end] for start, end in zip(group_starts, group_starts[1:])]

    def group_clip(group):
        cue_id = str(group[0].get("narration_cue_id") or "")
        if cue_id in clips_by_cue:
            return clips_by_cue[cue_id]
        return next((clips_by_scene[str(scene.get("id"))] for scene in group
                     if str(scene.get("id")) in clips_by_scene), None)

    cursor = 0.0
    for group_index, group in enumerate(groups):
        clip = group_clip(group)
        planned = [max(0.001, float(scene.get("end", 0)) - float(scene.get("start", 0))) for scene in group]
        planned_total = sum(planned)
        measured = float((clip or {}).get("duration") or 0)
        spoken_duration = measured if measured > 0 else planned_total
        cue_start = round(cursor, 3)
        cue_end = round(cursor + spoken_duration, 3)
        for scene_index, (scene, planned_duration) in enumerate(zip(group, planned)):
            scene["start"] = round(cursor, 3)
            cursor = (cue_end if scene_index == len(group) - 1
                      else round(cursor + spoken_duration * planned_duration / planned_total, 3))
            scene["end"] = round(cursor, 3)
            scene["cue_start"] = cue_start
            scene["cue_end"] = cue_end
        line_index = int(group[0]["script_line_index"])
        while len(tracks) <= line_index:
            tracks.append({"rate": 1, "src": ""})
        if clip:
            tracks[line_index] = {"rate": 1, "src": clip.get("uri", "")}
        next_clip = group_clip(groups[group_index + 1]) if group_index + 1 < len(groups) else None
        tail = 0.5 if clip and next_clip else 2.0 if clip and not next_clip else 0.0
        if tail:
            cursor = round(cursor + tail, 3)
            group[-1]["end"] = cursor
    adjusted["narration_tracks"] = tracks
    adjusted["duration_source"] = "narration cue measured WAV duration distributed across scenes + 0.5s gaps + 2s BGM fadeout tail; fallback timeline estimate"
    return adjusted


def apply_script_edits(document, script):
    updated = json.loads(json.dumps(document, ensure_ascii=False))
    production = updated.get("production") or {}
    cues = production.get("narration_cues", [])
    lines = [str(item).strip() for item in script.get("lines", [])]
    if len(lines) != len(cues) or any(not item for item in lines):
        raise ValueError(f"대본 문장은 {len(cues)}개 모두 입력해 주세요.")
    for cue, line in zip(cues, lines):
        cue["narration"] = {"text": line, "source": "provided"}
        cue["caption"] = {"text": line, "source": "provided"}
    cue_lines = {cue.get("id"): line for cue, line in zip(cues, lines)}
    for scene in production.get("timeline", {}).get("scenes", []):
        cue_ids = scene.get("narration_cue_ids", [])
        if len(cue_ids) == 1 and cue_ids[0] in cue_lines:
            line = cue_lines[cue_ids[0]]
            scene["narration"] = {"text": line, "source": "provided"}
            scene["caption"] = {"text": line, "source": "provided"}
    variants = {item.get("id"): item for item in updated.get("concept_variants", [])}
    selected = variants.get(updated.get("selected_variant_id"))
    if selected:
        selected["title"] = str(script.get("headline", "")).strip()[:100] or selected["title"]
        selected["core_message"] = str(script.get("concept", "")).strip()[:300] or selected["core_message"]
        selected["source"] = "provided"
    return updated


def kling_api_request(api_key, path, payload=None, timeout=None):
    timeout = timeout or RUNTIME_CONFIG["provider_probe_timeout"] * 4
    if not api_key:
        raise ValueError("Kling API 키를 입력하거나 KLING_API_KEY 환경변수를 설정해 주세요.")
    base_url = os.environ.get("KLING_API_BASE_URL", "https://api-singapore.klingai.com").rstrip("/")
    endpoint = f"{base_url}{path}"
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(
        endpoint,
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST" if payload is not None else "GET",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        safe = {400: "Kling 요청 형식이나 모델 설정을 확인해 주세요.", 401: "Kling API 키 인증에 실패했습니다.", 403: "Kling API 권한 또는 잔여 크레딧을 확인해 주세요.", 404: "Kling API 경로 또는 작업을 찾을 수 없습니다.", 429: "Kling API 요청 한도를 초과했습니다."}
        provider_code = ""
        provider_message = ""
        try:
            error_payload = json.loads(exc.read().decode("utf-8", errors="replace"))
            provider_code = str(error_payload.get("code", "")).strip()[:40]
            provider_message = str(error_payload.get("message", error_payload.get("msg", ""))).strip()[:240]
        except (json.JSONDecodeError, AttributeError, OSError):
            pass
        detail = " · ".join(value for value in (provider_code, provider_message) if value)
        message = safe.get(exc.code, f"Kling API 응답 오류 (HTTP {exc.code})")
        raise RuntimeError(f"{message}{f' ({detail})' if detail else ''}") from None
    except (URLError, TimeoutError):
        raise RuntimeError("Kling API 연결 시간이 초과되었습니다.") from None


def kling_payload_data(payload):
    return payload.get("data") if isinstance(payload.get("data"), dict) else payload


def load_project_kling_jobs():
    with project_kling_job_lock:
        if not PROJECT_KLING_JOBS_FILE.is_file():
            return {}
        try:
            return json.loads(PROJECT_KLING_JOBS_FILE.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}


def save_project_kling_job(task_id, values):
    with project_kling_job_lock:
        try:
            jobs = json.loads(PROJECT_KLING_JOBS_FILE.read_text(encoding="utf-8")) if PROJECT_KLING_JOBS_FILE.is_file() else {}
        except (OSError, json.JSONDecodeError):
            jobs = {}
        if not isinstance(jobs, dict):
            jobs = {}
        existing = jobs.get(task_id) if isinstance(jobs.get(task_id), dict) else None
        merged = {**(existing or {}), **values}
        project_id = str(merged.get("project_id") or "").strip()
        user_id = str(merged.get("user_id") or "").strip()
        if not existing and not project_id and not user_id:
            return
        if not project_id or not user_id:
            return
        if not get_auth_store().get_project(user_id, project_id):
            if existing:
                jobs.pop(task_id, None)
            else:
                return
        else:
            jobs[task_id] = merged
        PROJECT_KLING_JOBS_FILE.parent.mkdir(parents=True, exist_ok=True)
        temporary = PROJECT_KLING_JOBS_FILE.with_suffix(".tmp")
        temporary.write_text(json.dumps(jobs, ensure_ascii=False, sort_keys=True), encoding="utf-8")
        temporary.replace(PROJECT_KLING_JOBS_FILE)


def file_data_url(path):
    mime = {".png": "image/png", ".webp": "image/webp"}.get(path.suffix.lower(), "image/jpeg")
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def kling_task_state(task):
    raw = str(task.get("task_status") or task.get("status") or "queued").lower()
    if raw in {"succeed", "succeeded", "completed", "complete"}:
        return "succeeded"
    if raw in {"failed", "error"}:
        return "failed"
    if raw in {"processing", "running"}:
        return "running"
    return "queued"


def kling_account_usage(api_key):
    end_time = int(time.time() * 1000)
    start_time = end_time - 30 * 24 * 60 * 60 * 1000
    result = kling_api_request(api_key, f"/account/costs?start_time={start_time}&end_time={end_time}")
    data = kling_payload_data(result)
    if isinstance(data.get("data"), dict):
        data = data["data"]
    packs = data.get("resource_pack_subscribe_infos") or []
    summary = {"image": {"total": 0.0, "remaining": 0.0}, "video": {"total": 0.0, "remaining": 0.0}, "other": {"total": 0.0, "remaining": 0.0}}
    safe_packs = []
    for pack in packs:
        name = str(pack.get("resource_pack_name", ""))
        category = "image" if "image" in name.lower() else "video" if "video" in name.lower() else "other"
        total = float(pack.get("total_quantity") or 0)
        remaining = float(pack.get("remaining_quantity") or 0)
        summary[category]["total"] += total
        summary[category]["remaining"] += remaining
        safe_packs.append({"name": name, "category": category, "total": total, "remaining": remaining, "status": pack.get("status")})
    for values in summary.values():
        values["used"] = round(values["total"] - values["remaining"], 4)
        values["total"] = round(values["total"], 4)
        values["remaining"] = round(values["remaining"], 4)
    return {"measured_at": datetime.now().astimezone().isoformat(timespec="seconds"), "summary": summary, "packs": safe_packs}


def kling_usage_delta(before, after):
    delta = {}
    for category in ("image", "video", "other"):
        before_remaining = before.get("summary", {}).get(category, {}).get("remaining", 0)
        after_remaining = after.get("summary", {}).get(category, {}).get("remaining", 0)
        delta[category] = round(float(before_remaining) - float(after_remaining), 4)
    return delta


def kling_usage_for_task(api_key, task_id):
    current = kling_account_usage(api_key)
    with kling_usage_lock:
        baseline = kling_usage_baselines.get(task_id)
    return {"account": current, "task_deduction": kling_usage_delta(baseline, current) if baseline else None}


def kling_result_url(task, media_type):
    collection = "images" if media_type == "image" else "videos"
    direct_key = "image_url" if media_type == "image" else "video_url"
    items = task.get("task_result", {}).get(collection) or task.get("result", {}).get(collection) or task.get(collection) or []
    return str((items[0].get("url") or items[0].get(direct_key)) if items else task.get(direct_key) or "").strip()


def save_kling_artifact(task_id, task, media_type):
    source_url = kling_result_url(task, media_type)
    if not source_url:
        return None
    parsed = urlparse(source_url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise RuntimeError("Kling 결과 파일 주소가 안전한 HTTPS 주소가 아닙니다.")
    try:
        address = ipaddress.ip_address(parsed.hostname)
        if address.is_private or address.is_loopback or address.is_link_local:
            raise RuntimeError("Kling 결과 파일 주소가 로컬 네트워크를 가리킵니다.")
    except ValueError:
        pass
    safe_task_id = "".join(character for character in task_id if character.isalnum() or character in "-_")[:160]
    if not safe_task_id:
        raise RuntimeError("Kling 작업 ID로 저장 파일을 만들 수 없습니다.")
    source_extension = Path(parsed.path).suffix.lower()
    allowed_extensions = {".png", ".jpg", ".jpeg", ".webp"} if media_type == "image" else {".mp4", ".mov", ".webm"}
    extension = source_extension if source_extension in allowed_extensions else ".png" if media_type == "image" else ".mp4"
    target = KLING_ARTIFACT_DIR / f"{safe_task_id}{extension}"
    public_uri = f"/02_media/generated/kling/{target.name}"
    with kling_artifact_lock:
        if target.is_file() and target.stat().st_size > 0:
            return {"uri": public_uri, "media_type": media_type, "size": target.stat().st_size}
        KLING_ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(target.suffix + ".part")
        request = Request(source_url, headers={"User-Agent": "ThinkCast-Kling-Lab/1.0"})
        try:
            with urlopen(request, timeout=RUNTIME_CONFIG["media_download_timeout"]) as response, temporary.open("wb") as output:
                maximum = 500 * 1024 * 1024
                total = 0
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    total += len(block)
                    if total > maximum:
                        raise RuntimeError("Kling 결과 파일이 로컬 저장 한도(500MB)를 초과했습니다.")
                    output.write(block)
            if not temporary.is_file() or temporary.stat().st_size == 0:
                raise RuntimeError("Kling 결과 파일이 비어 있어 저장하지 못했습니다.")
            temporary.replace(target)
        finally:
            if temporary.exists():
                temporary.unlink()
    return {"uri": public_uri, "media_type": media_type, "size": target.stat().st_size}


def local_scene_data_url(scene_id):
    data = load_demo_data()
    scene = next((item for item in timeline_from_data(data) if item.get("id") == scene_id), None)
    if not scene:
        raise ValueError("선택한 씬을 찾을 수 없습니다.")
    relative = str(scene.get("preview_uri", "")).lstrip("/").replace("/", os.sep)
    image_path = (ROOT / relative).resolve()
    scene_root = (ROOT / "02_media" / "images" / "scenes").resolve()
    if scene_root not in image_path.parents or not image_path.is_file():
        raise ValueError("선택한 씬 이미지를 읽을 수 없습니다.")
    mime_type = "image/webp" if image_path.suffix.lower() == ".webp" else "image/png"
    encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}", scene

def load_render_catalog() -> dict:
    catalog = json.loads(RENDER_CATALOG_PATH.read_text(encoding="utf-8"))
    if catalog.get("schema_version") != "render-catalog.v1":
        raise RuntimeError("지원하지 않는 렌더 카탈로그 버전입니다.")
    for section in ("music", "styles", "platforms", "platform_preview_formats", "ratio_profiles", "defaults"):
        if not isinstance(catalog.get(section), dict):
            raise RuntimeError(f"렌더 카탈로그의 {section} 항목이 올바르지 않습니다.")
    return catalog


RENDER_CATALOG = load_render_catalog()
MUSIC = {
    key: (ROOT / value["uri"] if value.get("uri") else None)
    for key, value in RENDER_CATALOG["music"].items()
}

NARRATION_TRACKS = [
    (1.00, "audio_0.mp3"),
    (1.10, "audio_1.mp3"),
    (1.00, "audio_2.mp3"),
    (1.00, "audio_3.mp3"),
    (1.00, "audio_4.mp3"),
    (1.00, "audio_5.mp3"),
    (1.00, "audio_6.mp3"),
    (1.02, "audio_7.mp3"),
    (1.02, "audio_8.mp3"),
    (1.00, "audio_9.mp3"),
    (1.00, "audio_10.mp3"),
    (1.10, "audio_11.mp3"),
    (1.00, "audio_12.mp3"),
    (1.16, "audio_13.mp3"),
]

ASS_STYLES = {key: tuple(value) for key, value in RENDER_CATALOG["styles"].items()}
PLATFORM_FORMATS = {
    key: (value["width"], value["height"], value["format"])
    for key, value in RENDER_CATALOG["platforms"].items()
}
RENDER_DEFAULTS = dict(RENDER_CATALOG["defaults"])
RENDER_SETTING_KEYS = frozenset({
    "type", "music", "volume", "narration", "video_pan_x", "caption_size", "preview_platform",
    "platforms", "scene_dissolve_seconds",
})


def safe_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def safe_env_choice(name: str, default: str, allowed: set[str]) -> str:
    value = os.environ.get(name, default)
    return value if value in allowed else default


RUNTIME_CONFIG = {
    "provider_probe_timeout": safe_env_int("PROVIDER_PROBE_TIMEOUT", 15, 1, 120),
    "openai_keywords_timeout": safe_env_int("OPENAI_KEYWORDS_TIMEOUT", 60, 1, 600),
    "openai_tts_timeout": safe_env_int("OPENAI_TTS_TIMEOUT", 120, 1, 600),
    "openai_image_timeout": safe_env_int("OPENAI_IMAGE_TIMEOUT", 300, 1, 900),
    "openai_script_timeout": safe_env_int("OPENAI_SCRIPT_TIMEOUT", 300, 1, 900),
    "qwen_submit_timeout": safe_env_int("QWEN_SUBMIT_TIMEOUT", 15, 1, 120),
    "qwen_poll_timeout": safe_env_int("QWEN_POLL_TIMEOUT", 10, 1, 120),
    "qwen_audio_timeout": safe_env_int("QWEN_AUDIO_TIMEOUT", 30, 1, 300),
    "qwen_deadline": safe_env_int("QWEN_DEADLINE_SECONDS", 360, 10, 1800),
    "qwen_poll_interval": safe_env_int("QWEN_POLL_INTERVAL_SECONDS", 2, 1, 30),
    "ffprobe_timeout": safe_env_int("FFPROBE_TIMEOUT", 20, 1, 120),
    "media_download_timeout": safe_env_int("MEDIA_DOWNLOAD_TIMEOUT", 120, 1, 900),
    "kling_generation_timeout": safe_env_int("KLING_GENERATION_TIMEOUT", 90, 1, 900),
    "browser_render_timeout": safe_env_int("BROWSER_RENDER_TIMEOUT", 30, 1, 300),
    "voice_workers": safe_env_int("VOICE_RENDER_WORKERS", 3, 1, 8),
    "caption_batch_size": safe_env_int("CAPTION_RENDER_BATCH_SIZE", 4, 1, 32),
    "caption_workers": safe_env_int("CAPTION_RENDER_WORKERS", 2, 1, 8),
    "ffmpeg_threads": safe_env_int("FFMPEG_THREADS", 2, 1, 4),
    "render_preset": safe_env_choice(
        "RENDER_PRESET", "medium",
        {"ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"},
    ),
}


def validate_render_overrides(overrides: dict) -> dict:
    if not isinstance(overrides, dict):
        raise ValueError("렌더 설정 형식이 올바르지 않습니다.")
    schema_payload = {"schema_version": "render-settings.v1", "overrides": overrides}
    validate_json_schema_file(schema_payload, ROOT / "contracts" / "render-settings.schema.json")
    if set(overrides) - RENDER_SETTING_KEYS:
        raise ValueError("지원하지 않는 렌더 설정입니다.")
    if "type" in overrides and overrides["type"] not in ASS_STYLES:
        raise ValueError("지원하지 않는 자막 스타일입니다.")
    if "music" in overrides and overrides["music"] not in MUSIC:
        raise ValueError("지원하지 않는 배경음악입니다.")
    if "preview_platform" in overrides and overrides["preview_platform"] not in PLATFORM_FORMATS:
        raise ValueError("지원하지 않는 미리보기 플랫폼입니다.")
    if "platforms" in overrides and (
        not overrides["platforms"] or any(platform not in PLATFORM_FORMATS for platform in overrides["platforms"])
    ):
        raise ValueError("지원하지 않는 출력 플랫폼입니다.")
    return json.loads(json.dumps(overrides, ensure_ascii=False, allow_nan=False))


def resolve_render_settings(user_id: str, explicit=None) -> dict:
    stored = validate_render_overrides(get_auth_store().get_render_settings(user_id))
    resolved = {**RENDER_DEFAULTS, **stored}
    explicit = explicit or {}
    for key in RENDER_SETTING_KEYS:
        if key not in explicit:
            continue
        value = explicit[key]
        if key == "type":
            if value not in ASS_STYLES:
                raise ValueError("선택 설정이 올바르지 않습니다.")
        elif key == "music":
            if value not in MUSIC:
                raise ValueError("선택 설정이 올바르지 않습니다.")
        elif key == "preview_platform":
            if value not in PLATFORM_FORMATS:
                raise ValueError("미리보기 플랫폼 설정이 올바르지 않습니다.")
        elif key == "volume":
            value = max(0.0, min(1.0, float(value)))
        elif key == "video_pan_x":
            value = max(0.0, min(1.0, float(value)))
        elif key == "caption_size":
            value = max(-5, min(5, int(value)))
        elif key == "narration":
            value = bool(value)
        elif key == "platforms":
            if not value or any(platform not in PLATFORM_FORMATS for platform in value):
                raise ValueError("출력 플랫폼 설정이 올바르지 않습니다.")
            value = list(dict.fromkeys(value))
        elif key == "scene_dissolve_seconds":
            value = max(0.0, min(5.0, float(value)))
        resolved[key] = value
    return resolved


def render_settings_response(user_id: str) -> dict:
    overrides = validate_render_overrides(get_auth_store().get_render_settings(user_id))
    return {
        "catalog": json.loads(json.dumps(RENDER_CATALOG, ensure_ascii=False)),
        "effective": resolve_render_settings(user_id),
        "overrides": overrides,
    }


def parse_render_settings_request(payload: dict) -> dict:
    validate_json_schema_file(payload, ROOT / "contracts" / "render-settings.schema.json")
    return validate_render_overrides(payload["overrides"])


def handle_render_settings_request(handler, merge: bool) -> None:
    user = handler.current_user()
    if not user:
        handler.send_json(401, {"error": "로그인 후 이용해 주세요."});return
    try:
        payload = handler.read_json()
        if not isinstance(payload, dict):
            raise ValueError("렌더 설정 형식이 올바르지 않습니다.")
        overrides = parse_render_settings_request(payload)
        get_auth_store().save_render_settings(user["user_id"], overrides, merge=merge)
        handler.send_json(200, {"ok": True, **render_settings_response(user["user_id"])}, {"Cache-Control": "no-store"})
    except (ValueError, TypeError, KeyError) as exc:
        handler.send_json(400, {"error": str(exc)})


def group_platform_formats(platforms):
    groups = []
    indexes = {}
    for platform in platforms:
        output_format = PLATFORM_FORMATS[platform]
        if output_format not in indexes:
            indexes[output_format] = len(groups)
            groups.append({"render_platform": platform, "platforms": [], "format": output_format})
        groups[indexes[output_format]]["platforms"].append(platform)
    return groups


def find_ffmpeg():
    found = shutil.which("ffmpeg")
    if found:
        return found
    local = os.environ.get("LOCALAPPDATA", "")
    package_root = Path(local) / "Microsoft" / "WinGet" / "Packages"
    if package_root.exists():
        for package in package_root.iterdir():
            if not package.name.startswith("Gyan.FFmpeg"):
                continue
            for release in package.iterdir():
                if release.name.startswith("ffmpeg-"):
                    # WinGet 설치 폴더는 Python의 디렉터리 탐색을 제한할 수 있지만
                    # 실행 파일의 알려진 하위 경로는 정상 실행된다.
                    return str(release / "bin" / "ffmpeg.exe")
    raise FileNotFoundError("FFmpeg를 찾을 수 없습니다.")


def find_browser_renderer():
    configured = os.environ.get("BROWSER_RENDERER")
    candidates = [configured] if configured else []
    candidates += [
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    raise FileNotFoundError("투명 자막 PNG를 만들 Edge 브라우저를 찾을 수 없습니다.")


def create_caption_overlays(style_name, title_lines, title_scenes, width, height, caption_size, destination, progress_callback=None):
    source = (APP_DIR / "P1_title_design_preview.html").read_text(encoding="utf-8")
    css_start, css_end = source.index("<style>") + len("<style>"), source.index("</style>")
    css = source[css_start:css_end]
    browser = find_browser_renderer()
    overlays = [None] * len(title_scenes)
    destination.mkdir(parents=True, exist_ok=True)
    jobs = list(enumerate(zip(title_lines, title_scenes)))

    def render_caption(job):
        index, (line, scene) = job
        html_path = destination / f"caption_{index:02d}.html"
        png_path = destination / f"caption_{index:02d}.png"
        profile_path = destination / f"browser-profile-{index:02d}"
        document = f"""<!doctype html><html lang="ko"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&family=Noto+Serif+KR:wght@700;900&family=Song+Myung&display=swap" rel="stylesheet">
<style>{css}
html,body{{width:{width}px;height:{height}px;min-height:0;overflow:hidden;background:transparent!important}}
body{{margin:0}}.stage{{width:{width}px;height:{height}px;aspect-ratio:auto;background:transparent!important;--caption-size-offset:{caption_size * .278}cqmin}}
*,*::before,*::after{{animation:none!important;transition:none!important}}
</style></head><body><div class="stage type-{style_name} has-title"><div class="title-wrap"><div class="title-card"><p class="title-text">{html.escape(str(line))}</p></div></div></div></body></html>"""
        update_caption_artifact(scene, index, style_name, line, width, height, caption_size, png_path, "running")
        if not png_path.is_file():
            html_path.write_text(document, encoding="utf-8")
            command = [
                browser, "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
                "--force-device-scale-factor=1", f"--window-size={width},{height}",
                "--default-background-color=00000000", "--virtual-time-budget=5000",
                "--run-all-compositor-stages-before-draw",
                "--renderer-process-limit=2", f"--user-data-dir={profile_path}",
                f"--screenshot={png_path}", html_path.as_uri(),
            ]
            try:
                completed = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=RUNTIME_CONFIG["browser_render_timeout"])
                if completed.returncode != 0 or not png_path.is_file():
                    update_caption_artifact(scene, index, style_name, line, width, height, caption_size, png_path, "failed")
                    raise RuntimeError(completed.stderr.strip() or "투명 자막 PNG 생성에 실패했습니다.")
            finally:
                shutil.rmtree(profile_path, ignore_errors=True)
                html_path.unlink(missing_ok=True)
        update_caption_artifact(scene, index, style_name, line, width, height, caption_size, png_path, "succeeded")
        return index, (png_path, float(scene["cue_start"]), float(scene["cue_end"]))

    batch_size = RUNTIME_CONFIG["caption_batch_size"]
    parallelism = RUNTIME_CONFIG["caption_workers"]
    completed_count = 0
    for batch_start in range(0, len(jobs), batch_size):
        batch = jobs[batch_start:batch_start + batch_size]
        with ThreadPoolExecutor(max_workers=parallelism, thread_name_prefix="caption-png") as executor:
            futures = [executor.submit(render_caption, job) for job in batch]
            for future in as_completed(futures):
                index, overlay = future.result()
                overlays[index] = overlay
                completed_count += 1
                if progress_callback:
                    progress_callback(completed_count, len(title_scenes))
    return overlays


def get_lan_ip():
    connection = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        connection.connect(("8.8.8.8", 80))
        return connection.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        connection.close()


def ass_time(seconds):
    centiseconds = round(seconds * 100)
    hour, remain = divmod(centiseconds, 360000)
    minute, remain = divmod(remain, 6000)
    second, centi = divmod(remain, 100)
    return f"{hour}:{minute:02d}:{second:02d}.{centi:02d}"


def wrap_title(text):
    text = text.replace("\n", "\\N")
    if "\\N" in text or len(text) <= 25:
        return text
    words = text.split()
    target = len(text) // 2
    current = 0
    for index, word in enumerate(words[:-1], 1):
        current += len(word) + 1
        if current >= target:
            return " ".join(words[:index]) + "\\N" + " ".join(words[index:])
    return text


def load_demo_data():
    with data_lock:
        return json.loads(DATA_FILE.read_text(encoding="utf-8"))


def timeline_from_data(data):
    raw_scenes = data.get("timeline", {}).get("scenes", [])
    if not isinstance(raw_scenes, list) or not raw_scenes:
        raise ValueError("이전 단계의 장면 타임라인이 없습니다.")
    scenes = []
    previous_end = 0.0
    for index, item in enumerate(raw_scenes):
        start = float(item["start"])
        end = float(item["end"])
        if abs(start - previous_end) > 0.001 or end <= start:
            raise ValueError(f"{index + 1}번 장면의 시간이 올바르지 않습니다.")
        media_type = str(item.get("media_type", ""))
        if media_type not in {"image", "video"}:
            raise ValueError(f"{index + 1}번 장면의 미디어 유형이 올바르지 않습니다.")
        scenes.append({**item, "start": start, "end": end, "media_type": media_type})
        previous_end = end
    return scenes


def timed_script_scenes(data):
    rows = [scene for scene in timeline_from_data(data) if scene.get("script_line_index") is not None]
    return sorted(rows, key=lambda scene: int(scene["script_line_index"]))


def scene_video_path(scene, index, scene_videos=None):
    artifact = None
    if isinstance(scene_videos, dict):
        artifact = scene_videos.get(str(scene.get("id", "")))
    elif isinstance(scene_videos, list):
        artifact = next((item for item in scene_videos if isinstance(item, dict) and item.get("scene_id") == scene.get("id")), None)
    if isinstance(artifact, dict):
        artifact = artifact.get("uri") or artifact.get("path")
    configured = artifact or scene.get("video_uri") or scene.get("video_path") or scene.get("media_uri") or scene.get("media_path")
    parsed_configured = urlparse(str(configured or ""))
    if parsed_configured.path == "/api/storyboard/video":
        filename = str(parse_qs(parsed_configured.query).get("file", [""])[0])
        candidate = (KLING_ARTIFACT_DIR / Path(filename).name).resolve()
        if filename and Path(filename).name == filename and candidate.is_file():
            return candidate
        raise ValueError(f"{index + 1}번 장면의 Kling 원본 MP4를 찾을 수 없습니다.")
    if configured and parsed_configured.scheme:
        raise ValueError(f"{index + 1}번 장면의 원격 영상은 FFmpeg 작업 공간에 아직 준비되지 않았습니다.")
    candidate = ROOT / configured if configured else SOURCE_CLIPS / f"{index + 1}.mp4"
    candidate = candidate.resolve()
    if not configured and not candidate.is_file() and MERGED_DEMO_VIDEO.is_file():
        return MERGED_DEMO_VIDEO.resolve()
    if ROOT.resolve() not in candidate.parents or not candidate.is_file():
        raise ValueError(f"{index + 1}번 장면의 원본 MP4를 찾을 수 없습니다.")
    return candidate


def save_demo_data(data):
    with data_lock:
        temporary = DATA_FILE.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(DATA_FILE)


def project_deletion_file_paths(user_id, project_id):
    """Return only local, project-owned artifact files safe to quarantine."""
    snapshot = get_auth_store().project_deletion_snapshot(user_id, project_id)
    if snapshot is None:
        return None
    paths = []
    for artifact in snapshot["artifacts"]:
        uri = str(artifact.get("uri") or "")
        parsed = urlparse(uri)
        if parsed.scheme or parsed.netloc:
            continue
        query = parse_qs(parsed.query)
        candidate = None
        if parsed.path == "/api/storyboard/image" and query.get("project_id", [""])[0] == project_id:
            values = [query.get(key, [""])[0] for key in ("revision_id", "scene_id", "file")]
            if all(value and Path(value).name == value for value in values):
                candidate = STORYBOARD_IMAGE_DIR.joinpath(project_id, *values)
        elif parsed.path == "/api/voice/audio" and query.get("project_id", [""])[0] == project_id:
            values = [query.get(key, [""])[0] for key in ("revision_id", "profile", "file")]
            if all(value and Path(value).name == value for value in values):
                candidate = VOICE_ARTIFACT_DIR.joinpath(project_id, *values)
        elif parsed.path == "/api/storyboard/video" and query.get("project_id", [""])[0] == project_id:
            filename = query.get("file", [""])[0]
            if filename and Path(filename).name == filename:
                candidate = KLING_ARTIFACT_DIR / filename
        elif parsed.path.startswith("/04_exports/") or parsed.path.startswith("/exports/"):
            filename = Path(parsed.path).name
            if filename and parsed.path.rsplit("/", 1)[-1] == filename:
                candidate = EXPORTS / filename
        elif parsed.path.startswith("/02_media/generated/kling/"):
            filename = Path(parsed.path).name
            if filename and parsed.path.rsplit("/", 1)[-1] == filename:
                candidate = KLING_ARTIFACT_DIR / filename
        if candidate is None or snapshot["uri_counts"].get(uri, 0) != 1:
            continue
        resolved = candidate.resolve()
        allowed = (STORYBOARD_IMAGE_DIR, VOICE_ARTIFACT_DIR, KLING_ARTIFACT_DIR, EXPORTS)
        if any(root.resolve() == resolved or root.resolve() in resolved.parents for root in allowed):
            paths.append(resolved)
    return sorted(set(paths))


def quarantine_project_files(paths):
    """Move files out of serving paths; callers restore on transaction failure."""
    quarantine_root = EXPORTS / ".project-delete-quarantine" / uuid.uuid4().hex
    moved = []
    try:
        for index, path in enumerate(paths):
            if not path.is_file():
                continue
            target = quarantine_root / str(index)
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(path, target)
            moved.append((path, target))
    except Exception:
        restore_project_files(quarantine_root, moved)
        raise
    return quarantine_root, moved


def restore_project_files(quarantine_root, moved):
    for original, target in reversed(moved):
        if target.exists():
            original.parent.mkdir(parents=True, exist_ok=True)
            os.replace(target, original)
    shutil.rmtree(quarantine_root, ignore_errors=True)


def discard_project_quarantine(quarantine_root):
    shutil.rmtree(quarantine_root, ignore_errors=True)


def stage_project_kling_jobs(project_id):
    if not PROJECT_KLING_JOBS_FILE.is_file():
        return None
    original = PROJECT_KLING_JOBS_FILE.read_bytes()
    jobs = json.loads(original.decode("utf-8"))
    if not isinstance(jobs, dict):
        return original
    filtered = {
        task_id: job for task_id, job in jobs.items()
        if not isinstance(job, dict) or job.get("project_id") != project_id
    }
    temporary = PROJECT_KLING_JOBS_FILE.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(filtered, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    temporary.replace(PROJECT_KLING_JOBS_FILE)
    return original


def restore_project_kling_jobs(original):
    if original is None:
        return
    temporary = PROJECT_KLING_JOBS_FILE.with_suffix(".json.tmp")
    temporary.write_bytes(original)
    temporary.replace(PROJECT_KLING_JOBS_FILE)


def update_caption_artifact(scene, index, style_name, text, width, height, caption_size, png_path, status):
    project_id = "greenhill-demo-v1"
    text_hash = hashlib.sha256(str(text).encode("utf-8")).hexdigest()
    logical_key = f"{project_id}:{scene['id']}:{width}x{height}:{style_name}:{caption_size}:{text_hash}"
    artifact_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"thinkcast:caption:{logical_key}"))
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    with caption_registry_lock:
        if CAPTION_REGISTRY_FILE.is_file():
            registry = json.loads(CAPTION_REGISTRY_FILE.read_text(encoding="utf-8"))
        else:
            registry = {"schema_version": "1.0.0", "artifacts": []}
        artifacts = registry.setdefault("artifacts", [])
        artifact = next((item for item in artifacts if item.get("artifact_id") == artifact_id), None)
        caption_uri = None
        if png_path.is_file():
            try:
                caption_uri = "/exports/" + png_path.relative_to(EXPORTS).as_posix()
            except ValueError:
                caption_uri = png_path.name
        values = {
            "artifact_id": artifact_id,
            "logical_key": logical_key,
            "project_id": project_id,
            "scene_id": scene["id"],
            "caption_index": index,
            "format_id": f"{width}x{height}",
            "width": width,
            "height": height,
            "style": style_name,
            "caption_size": caption_size,
            "text_hash": text_hash,
            "status": status,
            "uri": caption_uri,
            "updated_at": now,
        }
        if artifact is None:
            artifact = {"created_at": now, **values}
            artifacts.append(artifact)
        else:
            artifact.update(values)
        temporary = CAPTION_REGISTRY_FILE.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(registry, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(CAPTION_REGISTRY_FILE)
    return artifact_id


def clean_caption_artifacts(cache_roots):
    roots = [path.resolve() for path in cache_roots]
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    with caption_registry_lock:
        if CAPTION_REGISTRY_FILE.is_file():
            registry = json.loads(CAPTION_REGISTRY_FILE.read_text(encoding="utf-8"))
            changed = False
            for artifact in registry.get("artifacts", []):
                uri = artifact.get("uri")
                if not uri:
                    continue
                artifact_path = (ROOT / uri).resolve()
                if any(root == artifact_path.parent for root in roots):
                    artifact.update({"status": "cleaned", "uri": None, "cleaned_at": now, "updated_at": now})
                    changed = True
            if changed:
                temporary = CAPTION_REGISTRY_FILE.with_suffix(".json.tmp")
                temporary.write_text(json.dumps(registry, ensure_ascii=False, indent=2), encoding="utf-8")
                temporary.replace(CAPTION_REGISTRY_FILE)
    cache_parent = (EXPORTS / ".caption_cache").resolve()
    for root in roots:
        if root.parent == cache_parent:
            shutil.rmtree(root, ignore_errors=True)


def validate_caption_overlays(prepared_overlays, expected_total):
    overlays = [overlay for group in prepared_overlays.values() for overlay in group]
    if len(overlays) != expected_total:
        raise ValueError(f"자막 PNG가 모두 준비되지 않았습니다. {len(overlays)} / {expected_total}")
    invalid = [path for path, _, _ in overlays if not path.is_file() or path.stat().st_size < 1000]
    if invalid:
        raise ValueError(f"정상적으로 생성되지 않은 자막 PNG가 {len(invalid)}개 있습니다. 합성을 시작하지 않습니다.")
    with caption_registry_lock:
        registry = json.loads(CAPTION_REGISTRY_FILE.read_text(encoding="utf-8"))
    succeeded_uris = {item.get("uri") for item in registry.get("artifacts", []) if item.get("status") == "succeeded"}
    missing_registry = []
    for path, _, _ in overlays:
        try:
            uri = "/exports/" + path.relative_to(EXPORTS).as_posix()
        except ValueError:
            uri = path.name
        if uri not in succeeded_uris:
            missing_registry.append(path)
    if missing_registry:
        raise ValueError(f"UUID 레지스트리 검증을 통과하지 못한 자막 PNG가 {len(missing_registry)}개 있습니다. 합성을 시작하지 않습니다.")
    return overlays


def create_ass(style_name, destination, title_lines, title_scenes, width=1916, height=1080, caption_size=0):
    style = ASS_STYLES[style_name]
    font, size, primary, outline_color, back, border, outline, shadow, align, ml, mr, mv, italic = style
    scale = min(width, height) / 1080
    size = max(18, round(size * scale + caption_size * 3))
    if width < height:
        ml = round(width * (0.07 if align == 1 else 0.08))
        mr = round(width * (0.20 if align == 1 else 0.08))
        mv = round(height * 0.08)
    else:
        ml, mr, mv = round(ml * scale), round(mr * scale), round(mv * scale)
    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {width}",
        f"PlayResY: {height}",
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: Title,{font},{size},{primary},&H00FFFFFF,{outline_color},{back},-1,{italic},0,0,100,100,0,0,{border},{outline},{shadow},{align},{ml},{mr},{mv},1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    if not isinstance(title_lines, list) or len(title_lines) != len(title_scenes):
        raise ValueError(f"대본 문장은 {len(title_scenes)}개 모두 입력해 주세요.")
    title_rows = [
        (float(scene["cue_start"]), float(scene["cue_end"]), str(title_lines[index]).strip())
        for index, scene in enumerate(title_scenes)
    ]
    if style_name in {"minimal", "action"}:
        line_height = max(2, round((2 if style_name == "minimal" else 7) * scale))
        line_width = round((76 * scale) if style_name == "minimal" else min(width * 0.50, 580 * scale))
        line_x = round((width - line_width) / 2)
        line_y = round(height - mv + 8 * scale)
        for start, end, _ in title_rows:
            if style_name == "minimal":
                drawing = f"{{\\an7\\pos({line_x},{line_y})\\p1\\bord0\\shad0\\1c&H9BC4DB&}}m 0 0 l {line_width} 0 l {line_width} {line_height} l 0 {line_height}"
                lines.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Title,,0,0,0,,{drawing}")
            else:
                split = round(line_width * 0.52)
                left = f"{{\\an7\\pos({line_x},{line_y})\\p1\\bord0\\shad0\\1c&H764DF4&}}m 0 0 l {split} 0 l {split} {line_height} l 0 {line_height}"
                right = f"{{\\an7\\pos({line_x + split},{line_y})\\p1\\bord0\\shad0\\1c&H66E3FF&}}m 0 0 l {line_width - split} 0 l {line_width - split} {line_height} l 0 {line_height}"
                lines.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Title,,0,0,0,,{left}")
                lines.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Title,,0,0,0,,{right}")
    for start, end, text in title_rows:
        lines.append(f"Dialogue: 1,{ass_time(start)},{ass_time(end)},Title,,0,0,0,,{wrap_title(text)}")
    destination.write_text("\n".join(lines), encoding="utf-8-sig")


def update_render_progress(job_id, **changes):
    if not job_id:
        return
    with render_progress_lock:
        job = render_jobs.setdefault(job_id, {"status": "queued", "progress": 0.0})
        job.update(changes)
        job["updated_at"] = time.time()
        if len(render_jobs) > 40:
            oldest = sorted(render_jobs, key=lambda key: render_jobs[key].get("updated_at", 0))[:-30]
            for key in oldest:
                render_jobs.pop(key, None)


def prepare_caption_overlays(config, job_id, output_width, output_height, demo_data=None):
    demo_data = demo_data or load_demo_data()
    title_scenes = timed_script_scenes(demo_data)
    script_lines = demo_data.get("state", {}).get("script", {}).get("lines")
    if not isinstance(script_lines, list) or len(script_lines) != len(title_scenes):
        raise ValueError(f"대본 문장은 {len(title_scenes)}개 모두 입력해 주세요.")
    preview_hash = hashlib.sha256((APP_DIR / "P1_title_design_preview.html").read_bytes()).hexdigest()
    overlay_signature = json.dumps({"style": config["type"], "lines": script_lines, "width": output_width, "height": output_height, "caption_size": config["caption_size"], "preview_hash": preview_hash}, ensure_ascii=False, sort_keys=True)
    overlay_key = hashlib.sha256(overlay_signature.encode("utf-8")).hexdigest()[:20]
    overlay_root = EXPORTS / ".caption_cache" / overlay_key
    return create_caption_overlays(
        config["type"], script_lines, title_scenes, output_width, output_height, config["caption_size"], overlay_root,
        lambda completed, total: update_render_progress(
            job_id, status="running", phase="captions",
            completed_captions=config.get("caption_progress_offset", 0) + completed,
            caption_total=config.get("caption_progress_total", total),
            detail=f"자막 PNG {config.get('caption_progress_offset', 0) + completed:02d} / {config.get('caption_progress_total', total):02d} 생성 중",
        ),
    )


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def render_video(config, job_id=None):
    ffmpeg = find_ffmpeg()
    style = config["type"]
    music = config["music"]
    volume = config["volume"]
    use_narration = config["narration"]
    platform = config["preview_platform"]
    output_width, output_height, format_label = PLATFORM_FORMATS[platform]
    video_pan_x = config["video_pan_x"]
    scene_crop_positions = config.get("scene_crop_positions") or {}
    caption_size = config["caption_size"]
    EXPORTS.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_name = f"P1_final_{style}_{platform}_{format_label}_{music}_{stamp}.mp4"
    output_path = EXPORTS / output_name
    demo_data = config.get("content_data") or load_demo_data()
    timeline_scenes = timeline_from_data(demo_data)
    title_scenes = timed_script_scenes(demo_data)
    scene_end_times = tuple(scene["end"] for scene in timeline_scenes)
    scene_count = len(timeline_scenes)
    video_duration = scene_end_times[-1]
    caption_overlays = config.get("prepared_caption_overlays") or prepare_caption_overlays(config, job_id, output_width, output_height, demo_data)

    hosted_mode = os.environ.get("PORT", "8765") != "8765"
    ffmpeg_threads = 1 if hosted_mode else RUNTIME_CONFIG["ffmpeg_threads"]
    render_preset = "ultrafast" if hosted_mode else RUNTIME_CONFIG["render_preset"]
    args = [
        ffmpeg, "-y",
        "-filter_threads", str(ffmpeg_threads),
        "-filter_complex_threads", str(ffmpeg_threads),
    ]
    scene_videos = config.get("scene_videos")
    scene_images = config.get("scene_images") or {}
    for index, scene in enumerate(timeline_scenes):
        video_artifact = next((item for item in scene_videos if isinstance(item, dict) and
                               item.get("scene_id") == scene.get("id")), None) if isinstance(scene_videos, list) else None
        image_artifact = scene_images.get(str(scene.get("id", ""))) if isinstance(scene_images, dict) else None
        image_path = storyboard_image_path((image_artifact or {}).get("uri"))
        if not video_artifact and image_path:
            args += ["-loop", "1", "-i", str(image_path)]
            continue
        source_path = scene_video_path(scene, index, scene_videos)
        if source_path == MERGED_DEMO_VIDEO.resolve():
            args += ["-ss", f"{scene['start']:.3f}", "-i", str(source_path)]
        else:
            args += ["-i", str(source_path)]
    input_index = scene_count
    bgm_index = None
    if MUSIC[music] is not None:
        bgm_index = input_index
        args += ["-stream_loop", "-1", "-i", str(MUSIC[music])]
        input_index += 1

    narration_indexes = []
    if use_narration:
        voice_clips = {str(item.get("scene_id")): item for item in config.get("voice_clips") or []}
        if voice_clips:
            narration_sources = []
            for scene in title_scenes:
                clip = voice_clips.get(str(scene.get("id")))
                path = voice_audio_path((clip or {}).get("uri"))
                if not path:
                    raise ValueError(f"{scene.get('name', scene.get('id'))} 장면의 나레이션 파일을 찾을 수 없습니다.")
                narration_sources.append((1, path))
        else:
            if len(NARRATION_TRACKS) != len(title_scenes):
                raise ValueError("음성 파일과 대본 타임라인의 개수가 일치하지 않습니다.")
            narration_sources = [(rate, ROOT / "02_media" / "narration" / filename)
                                 for rate, filename in NARRATION_TRACKS]
        for scene, (rate, narration_path) in zip(title_scenes, narration_sources):
            start = float(scene["cue_start"])
            narration_indexes.append((input_index, start, rate))
            args += ["-i", str(narration_path)]
            input_index += 1

    caption_indexes = []
    for png_path, start, end in caption_overlays:
        caption_indexes.append((input_index, start, end))
        args += ["-loop", "1", "-i", str(png_path)]
        input_index += 1

    brand_inputs = {}
    for item in config.get("brand_selections") or []:
        if not item.get("enabled") or not item.get("uri"):
            continue
        if item.get("role") == "outro":
            settings = item.get("settings") or {}
            profiles = settings.get("profiles") if isinstance(settings.get("profiles"), dict) else {}
            format_profile = profiles.get(format_label) if isinstance(profiles.get(format_label), dict) else {}
            if format_profile.get("uri"):
                item = {**item, "uri": format_profile["uri"],
                        "media_type": format_profile.get("media_type", item.get("media_type")),
                        "mime_type": format_profile.get("mime_type", item.get("mime_type"))}
        path = brand_asset_path(item["uri"])
        if not path:
            raise ValueError(f"{item.get('role')} 브랜드 파일을 찾을 수 없습니다.")
        duration = 2.0 if item.get("media_type") == "image" else media_duration(path)
        brand_inputs[item["role"]] = {**item, "path": path, "index": input_index, "duration": duration}
        if item.get("media_type") == "image":
            args += ["-loop", "1", "-i", str(path)]
        else:
            args += ["-an", "-i", str(path)]
        input_index += 1
    intro_duration = brand_inputs.get("intro", {}).get("duration", 0.0)
    outro_duration = brand_inputs.get("outro", {}).get("duration", 0.0)
    output_duration = intro_duration + video_duration + outro_duration

    filters = []
    video_labels = []
    dissolve_duration = max(
        0.0,
        min(5.0, float(config.get("scene_dissolve_seconds", RENDER_DEFAULTS["scene_dissolve_seconds"]))),
    )
    for index, scene in enumerate(timeline_scenes):
        duration = scene["end"] - scene["start"]
        video_artifact = None
        if isinstance(scene_videos, dict):
            video_artifact = scene_videos.get(str(scene.get("id", "")))
        elif isinstance(scene_videos, list):
            video_artifact = next((item for item in scene_videos if isinstance(item, dict) and item.get("scene_id") == scene.get("id")), None)
        playback_rate = max(0.1, float((video_artifact or {}).get("playback_rate", 1)))
        scene_pan_x = 0.5 if format_label == "16x9" else float(
            (scene_crop_positions.get(str(scene.get("id"))) or {}).get(format_label, video_pan_x)
        )
        filters.append(
            f"[{index}:v:0]scale={output_width}:{output_height}:force_original_aspect_ratio=increase,"
            f"crop={output_width}:{output_height}:x='(iw-ow)*{scene_pan_x:.5f}':y='(ih-oh)/2',"
            f"setsar=1,fps=30,format=yuv420p,setpts=PTS/{playback_rate:.6f},tpad=stop_mode=clone:stop_duration={duration:.3f},"
            f"trim=duration={duration:.3f},setpts=PTS-STARTPTS[v{index}]"
        )
        if index < scene_count - 1 and dissolve_duration > 0:
            last_frame = max(0, math.ceil(duration * 30 - 1e-6) - 1)
            filters.append(f"[v{index}]split=2[v{index}base][v{index}tail]")
            filters.append(
                f"[v{index}tail]trim=start_frame={last_frame}:end_frame={last_frame + 1},"
                f"setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration={dissolve_duration:.3f},"
                f"trim=duration={dissolve_duration:.3f},format=yuva420p,"
                f"fade=t=out:st=0:d={dissolve_duration:.3f}:alpha=1,"
                f"setpts=PTS+{float(scene['end']):.3f}/TB[dissolve{index}]"
            )
            video_labels.append(f"[v{index}base]")
        elif index < scene_count - 1:
            video_labels.append(f"[v{index}]")
        else:
            video_labels.append(f"[v{index}]")
    filters.append("".join(video_labels) + f"concat=n={scene_count}:v=1:a=0[sequence_base]")
    video_output = "sequence_base"
    for index, scene in enumerate(timeline_scenes[:-1]):
        if dissolve_duration <= 0:
            continue
        next_output = "sequence" if index == scene_count - 2 else f"dissolved{index}"
        filters.append(
            f"[{video_output}][dissolve{index}]overlay=0:0:eof_action=pass[{next_output}]"
        )
        video_output = next_output
    if scene_count == 1:
        filters.append("[sequence_base]null[sequence]")
        video_output = "sequence"
    for number, (index, start, end) in enumerate(caption_indexes):
        next_output = f"captioned{number}"
        filters.append(f"[{index}:v:0]format=rgba[caption{number}]")
        filters.append(f"[{video_output}][caption{number}]overlay=0:0:enable='between(t,{start:.3f},{end:.3f})'[{next_output}]")
        video_output = next_output
    watermark = brand_inputs.get("watermark")
    if watermark:
        settings = watermark.get("settings") or {}
        format_profiles = settings.get("profiles") if isinstance(settings.get("profiles"), dict) else {}
        format_settings = format_profiles.get(format_label) if isinstance(format_profiles.get(format_label), dict) else {}
        opacity = max(.1, min(1.0, float(settings.get("opacity", .8))))
        width_ratio = float(format_settings.get("width_ratio", settings.get("width_ratio", .15)))
        width = max(48, round(output_width * max(.06, min(1.0, width_ratio))))
        position = str(format_settings.get("position", settings.get("position", "top-right")))
        vertical, _, horizontal = position.partition("-")
        margin_x, margin_y = round(output_width * .035), round(output_height * .035)
        overlay_x = str(margin_x) if horizontal == "left" else "(W-w)/2" if horizontal == "center" else f"W-w-{margin_x}"
        overlay_y = str(margin_y) if vertical == "top" else "(H-h)/2" if vertical == "center" else f"H-h-{margin_y}"
        filters.append(f"[{watermark['index']}:v]scale={width}:-1,format=rgba,colorchannelmixer=aa={opacity:.3f}[watermark]")
        filters.append(f"[{video_output}][watermark]overlay={overlay_x}:{overlay_y}[branded_body]")
        video_output = "branded_body"
    segments = []
    intro = brand_inputs.get("intro")
    if intro:
        filters.append(f"[{intro['index']}:v]scale={output_width}:{output_height}:force_original_aspect_ratio=decrease,pad={output_width}:{output_height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p,trim=duration={intro['duration']:.3f},setpts=PTS-STARTPTS[brand_intro]")
        segments.append("[brand_intro]")
    outro = brand_inputs.get("outro")
    if outro:
        settings = outro.get("settings") or {}
        profiles = settings.get("profiles") if isinstance(settings.get("profiles"), dict) else {}
        format_settings = profiles.get(format_label) if isinstance(profiles.get(format_label), dict) else {}
        width_ratio = max(.06, min(1.0, float(format_settings.get("width_ratio", settings.get("width_ratio", 1.0)))))
        position = str(format_settings.get("position", settings.get("position", "center-center")))
        background = str(format_settings.get("background", settings.get("background", "none")))
        if background not in {"none", "white", "black"}:
            background = "none"
        background_opacity = max(0.0, min(1.0, float(format_settings.get(
            "background_opacity", settings.get("background_opacity", .8)
        ))))
        vertical, _, horizontal = position.partition("-")
        margin_x, margin_y = round(output_width * .035), round(output_height * .035)
        overlay_x = str(margin_x) if horizontal == "left" else "(W-w)/2" if horizontal == "center" else f"W-w-{margin_x}"
        overlay_y = str(margin_y) if vertical == "top" else "(H-h)/2" if vertical == "center" else f"H-h-{margin_y}"
        outro_width = max(48, round(output_width * width_ratio))
        freeze_start = max(0.0, video_duration - (1 / 30))
        filters.append(f"[{video_output}]split=2[body_main][outro_source]")
        background_filter = f",drawbox=color={background}@{background_opacity:.3f}:t=fill" if background != "none" and background_opacity > 0 else ""
        filters.append(f"[outro_source]trim=start={freeze_start:.3f},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration={outro['duration']:.3f},trim=duration={outro['duration']:.3f}{background_filter}[outro_bg]")
        filters.append(f"[{outro['index']}:v]scale={outro_width}:-1,format=rgba,fps=30,trim=duration={outro['duration']:.3f},setpts=PTS-STARTPTS[outro_layer]")
        filters.append(f"[outro_bg][outro_layer]overlay={overlay_x}:{overlay_y}:shortest=1,format=yuv420p[brand_outro]")
        video_output = "body_main"
    segments.append(f"[{video_output}]")
    if outro:
        segments.append("[brand_outro]")
    if len(segments) > 1:
        filters.append("".join(segments) + f"concat=n={len(segments)}:v=1:a=0[vout]")
    else:
        filters.append(f"[{video_output}]null[vout]")
    audio_labels = []
    if bgm_index is not None:
        fadeout_start = max(0.0, output_duration - 2.0)
        filters.append(
            f"[{bgm_index}:a:0]atrim=start=2:duration={output_duration},asetpts=PTS-STARTPTS,"
            f"volume={volume:.3f},afade=t=in:st=0:d=2,afade=t=out:st={fadeout_start:.3f}:d=2[bg]"
        )
        audio_labels.append("[bg]")
    for number, (index, start, rate) in enumerate(narration_indexes):
        delay = round((start + intro_duration) * 1000)
        filters.append(f"[{index}:a:0]atempo={rate:.3f},volume=0.95,adelay={delay}|{delay}[n{number}]")
        audio_labels.append(f"[n{number}]")

    if len(audio_labels) > 1:
        filters.append("".join(audio_labels) + f"amix=inputs={len(audio_labels)}:duration=longest:dropout_transition=0,atrim=duration={output_duration},apad=whole_dur={output_duration},alimiter=limit=0.95[aout]")
    elif len(audio_labels) == 1:
        filters.append(audio_labels[0] + f"atrim=duration={output_duration},apad=whole_dur={output_duration}[aout]")
    else:
        filters.append(f"anullsrc=r=44100:cl=stereo,atrim=duration={output_duration}[aout]")

    args += [
        "-filter_complex", ";".join(filters),
        "-map", "[vout]", "-map", "[aout]",
        "-t", str(output_duration),
        "-c:v", "libx264", "-preset", render_preset, "-r", "30",
        "-threads", str(ffmpeg_threads), "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
        "-progress", "pipe:1", "-nostats",
        str(output_path),
    ]
    try:
        update_render_progress(
            job_id, status="running", phase="composite", progress=0.01,
            rendered_seconds=0.0, completed_scenes=0, scene_total=scene_count,
            format_id=config.get("format_id"), format_index=config.get("format_index", 1),
            format_total=config.get("format_total", 1), detail="FFmpeg 합성을 시작했습니다.",
        )
        process = subprocess.Popen(
            args,
            cwd=ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        output_tail = deque(maxlen=16)
        for raw_line in process.stdout or []:
            line = raw_line.strip()
            output_tail.append(line)
            if line.startswith("out_time_ms="):
                try:
                    rendered_seconds = int(line.split("=", 1)[1]) / 1_000_000
                    fraction = max(0.01, min(0.98, rendered_seconds / output_duration))
                    completed_scenes = sum(rendered_seconds >= end_time + intro_duration for end_time in scene_end_times)
                    update_render_progress(
                        job_id,
                        status="running",
                        progress=fraction,
                        rendered_seconds=round(rendered_seconds, 1),
                        completed_scenes=completed_scenes,
                        scene_total=scene_count,
                        format_id=config.get("format_id"),
                        format_index=config.get("format_index", 1),
                        format_total=config.get("format_total", 1),
                        detail=f"장면 {completed_scenes:02d} / {scene_count:02d} 완료 · {rendered_seconds:.1f}초 / {output_duration:.1f}초 합성 중",
                    )
                except (TypeError, ValueError):
                    pass
        return_code = process.wait()
        if return_code != 0:
            detail = "\n".join(output_tail)
            raise RuntimeError(detail or "FFmpeg 변환에 실패했습니다.")
        if not output_path.exists() or output_path.stat().st_size < 1_000_000:
            raise RuntimeError("출력 MP4가 정상적으로 생성되지 않았습니다.")
        update_render_progress(job_id, status="succeeded", progress=1.0, rendered_seconds=output_duration, completed_scenes=scene_count, scene_total=scene_count, detail=f"장면 {scene_count:02d} / {scene_count:02d} 완료 · 최종 MP4 합성이 완료됐습니다.")
        return {
            "filename": output_name,
            "path": output_path,
            "duration": output_duration,
            "width": output_width,
            "height": output_height,
            "scene_count": scene_count,
        }
    except Exception as exc:
        update_render_progress(job_id, status="failed", detail=str(exc))
        raise
    finally:
        pass


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        self._byte_range = None
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def translate_path(self, path):
        parsed_path = urlparse(path).path
        if parsed_path.startswith("/04_exports/"):
            filename = Path(parsed_path).name
            if filename and filename == parsed_path.removeprefix("/04_exports/"):
                return str(EXPORTS / filename)
        return super().translate_path(path)

    def end_headers(self):
        if self.path.split("?", 1)[0].endswith(".html"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_json(self, status, payload, headers=None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def send_bytes(self, status, body, content_type, headers=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def has_site_auth(self):
        return self.current_user() is not None

    def current_user(self):
        cookies = {}
        for item in self.headers.get("Cookie", "").split(";"):
            name, separator, value = item.strip().partition("=")
            if separator:
                cookies[name] = value
        return get_auth_store().session_user(cookies.get("thinkcast_session", ""))

    def session_token(self):
        for item in self.headers.get("Cookie", "").split(";"):
            name, separator, value = item.strip().partition("=")
            if separator and name == "thinkcast_session":
                return value
        return ""

    def require_kling_lab_auth(self):
        if not IS_RENDER_HOSTED:
            return True
        if self.has_site_auth():
            return True
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="ThinkCast Kling Lab", charset="UTF-8"')
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        return False

    def read_json(self):
        length = min(int(self.headers.get("Content-Length", "0")), 64 * 1024 * 1024)
        return json.loads(self.rfile.read(length) or b"{}")

    def send_head(self):
        path = Path(self.translate_path(self.path))
        if path.is_dir() or path.suffix == ".html":
            return super().send_head()
        if not path.is_file():
            normalized_nfc = Path(unicodedata.normalize("NFC", str(path)))
            normalized_nfd = Path(unicodedata.normalize("NFD", str(path)))
            if normalized_nfc.is_file():
                path = normalized_nfc
            elif normalized_nfd.is_file():
                path = normalized_nfd
            elif path.name.startswith("audio_"):
                m = re.match(r"^audio_(\d+)", path.name)
                if m:
                    alt_path = path.with_name(f"audio_{m.group(1)}.mp3")
                    if alt_path.is_file():
                        path = alt_path
        try:
            source = path.open("rb")
        except OSError:
            self.send_error(404, "File not found")
            return None

        stat = path.stat()
        size = stat.st_size
        start, end = 0, size - 1
        range_header = self.headers.get("Range", "")
        partial = False
        if range_header.startswith("bytes=") and "," not in range_header:
            requested = range_header[6:].split("-", 1)
            try:
                if requested[0]:
                    start = int(requested[0])
                    end = int(requested[1]) if requested[1] else end
                elif requested[1]:
                    suffix = min(size, int(requested[1]))
                    start = size - suffix
                if start < 0 or start >= size or end < start:
                    raise ValueError
                end = min(end, size - 1)
                partial = True
            except ValueError:
                source.close()
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return None

        self._byte_range = (start, end) if partial else None
        self.send_response(206 if partial else 200)
        self.send_header("Content-Type", self.guess_type(str(path)))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Last-Modified", self.date_time_string(stat.st_mtime))
        if partial:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            source.seek(start)
        self.end_headers()
        return source

    def copyfile(self, source, outputfile):
        try:
            if self._byte_range is None:
                shutil.copyfileobj(source, outputfile)
                return
            start, end = self._byte_range
            remaining = end - start + 1
            while remaining > 0:
                block = source.read(min(256 * 1024, remaining))
                if not block:
                    break
                outputfile.write(block)
                remaining -= len(block)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/render-settings":
            user = self.current_user()
            if not user:
                self.send_json(401, {"error": "로그인 후 이용해 주세요."});return
            self.send_json(200, {"ok": True, **render_settings_response(user["user_id"])}, {"Cache-Control": "no-store"})
            return
        if parsed.path == '/api/automation':
            user = self.current_user()
            if not user:
                self.send_json(401, {'error': '로그인 후 이용해 주세요.'});return
            self.send_json(200, {'ok': True, **AutomationStore(get_auth_store()).snapshot(user['user_id'])}, {'Cache-Control': 'no-store'})
            return
        if (parsed.path == "/01_app/kling_test.html" or parsed.path.startswith("/api/kling-lab/") or parsed.path.startswith("/02_media/generated/kling/")) and not self.require_kling_lab_auth():
            return
        if parsed.path == "/":
            self.send_response(302)
            self.send_header("Location", "/01_app/P1_title_design_preview.html")
            self.end_headers()
            return
        if parsed.path == "/health":
            self.send_json(200, {"ok": True})
            return
        if parsed.path == "/api/voice/sample":
            user = self.current_user()
            if not user:
                self.send_json(401, {"error": "로그인 후 이용해 주세요."})
                return
            try:
                profile_id = str(parse_qs(parsed.query).get("profile", [""])[0]).strip()
                sample = ensure_voice_sample(provider_values("openai").get("api_key", ""), profile_id)
                sample_type = "audio/wav" if sample.suffix.lower() == ".wav" else "audio/mpeg"
                self.send_bytes(200, sample.read_bytes(), sample_type, {"Cache-Control": "private, no-store, max-age=0"})
            except ValueError as exc:
                self.send_json(400, {"error": str(exc)})
            except RuntimeError as exc:
                self.send_json(502, {"error": str(exc)})
            return
        if parsed.path == "/api/voice/audio":
            user = self.current_user()
            query = parse_qs(parsed.query)
            project_id = str(query.get("project_id", [""])[0]).strip()
            revision_id = str(query.get("revision_id", [""])[0]).strip()
            profile_id = str(query.get("profile", [""])[0]).strip()
            filename = str(query.get("file", [""])[0]).strip()
            if not user or not get_auth_store().get_project(user["user_id"], project_id):
                self.send_json(404, {"error": "음성 파일을 찾을 수 없습니다."})
                return
            if profile_id not in VOICE_PROFILES or Path(filename).name != filename:
                self.send_json(400, {"error": "음성 파일 경로가 올바르지 않습니다."})
                return
            audio_path = VOICE_ARTIFACT_DIR / project_id / revision_id / profile_id / filename
            if not audio_path.is_file():
                self.send_json(404, {"error": "음성 파일을 찾을 수 없습니다."})
                return
            self.send_bytes(200, audio_path.read_bytes(), "audio/wav", {"Cache-Control": "private, max-age=31536000, immutable"})
            return
        if parsed.path == "/api/storyboard/image":
            user = self.current_user(); query = parse_qs(parsed.query)
            project_id = str(query.get("project_id", [""])[0]).strip()
            revision_id = str(query.get("revision_id", [""])[0]).strip()
            scene_id = str(query.get("scene_id", [""])[0]).strip()
            filename = str(query.get("file", [""])[0]).strip()
            safe_parts = all(value and Path(value).name == value for value in (revision_id, scene_id, filename))
            if not user or not get_auth_store().get_project(user["user_id"], project_id) or not safe_parts:
                self.send_json(404, {"error": "생성 이미지를 찾을 수 없습니다."}); return
            image_path = STORYBOARD_IMAGE_DIR / project_id / revision_id / scene_id / filename
            if not image_path.is_file():
                self.send_json(404, {"error": "생성 이미지를 찾을 수 없습니다."}); return
            self.send_bytes(200, image_path.read_bytes(), "image/webp", {"Cache-Control": "private, max-age=31536000, immutable"})
            return
        if parsed.path == "/api/storyboard/video":
            user = self.current_user(); query = parse_qs(parsed.query)
            project_id = str(query.get("project_id", [""])[0]).strip()
            filename = str(query.get("file", [""])[0]).strip()
            if not user or not get_auth_store().get_project(user["user_id"], project_id) or Path(filename).name != filename:
                self.send_json(404, {"error": "생성 영상을 찾을 수 없습니다."}); return
            video_path = KLING_ARTIFACT_DIR / filename
            if not video_path.is_file():
                self.send_json(404, {"error": "생성 영상을 찾을 수 없습니다."}); return
            self.send_bytes(200, video_path.read_bytes(), "video/mp4", {"Cache-Control": "private, max-age=31536000, immutable", "Accept-Ranges": "bytes"})
            return
        if parsed.path == "/api/session":
            user = self.current_user()
            group = sync_default_group_resources(user["user_id"]) if user else None
            self.send_json(200, {"ok": True, "authenticated": bool(user), "user": user, "group": group})
            return
        if parsed.path == "/api/projects":
            user = self.current_user()
            if not user:
                self.send_json(401, {"error": "로그인 후 이용해 주세요."})
                return
            self.send_json(200, {"ok": True, "projects": get_auth_store().list_projects(user["user_id"])})
            return
        if parsed.path == "/api/usage":
            user = self.current_user()
            if not user:
                self.send_json(401, {"error": "로그인 후 이용해 주세요."})
                return
            project_id = str(parse_qs(parsed.query).get("project_id", [""])[0]).strip()
            if project_id and not get_auth_store().get_project(user["user_id"], project_id):
                self.send_json(404, {"error": "프로젝트를 찾을 수 없습니다."})
                return
            self.send_json(200, {
                "ok": True,
                "project": get_auth_store().usage_summary(user["user_id"], project_id) if project_id else None,
                "account": get_auth_store().usage_summary(user["user_id"]),
            })
            return
        if parsed.path == "/api/group/resources":
            user = self.current_user()
            if not user:
                self.send_json(401, {"error": "로그인 후 이용해 주세요."})
                return
            group = sync_default_group_resources(user["user_id"])
            self.send_json(200, {
                "ok": True, "group": group,
                "resources": get_auth_store().list_group_resources(user["user_id"]),
            })
            return
        if parsed.path == "/api/calendar":
            user = self.current_user()
            if not user:
                self.send_json(401, {"error": "로그인 후 이용해 주세요."})
                return
            self.send_json(200, {
                "ok": True,
                "entries": get_auth_store().list_calendar_entries(user["user_id"]),
            })
            return
        if parsed.path == "/api/brand-assets":
            user = self.current_user()
            if not user:
                self.send_json(401, {"error": "로그인 후 이용해 주세요."});return
            self.send_json(200, {"ok": True, "assets": get_auth_store().list_brand_assets(user["user_id"]),
                                 "selections": get_auth_store().content_brand_selections(user["user_id"])})
            return
        if parsed.path == "/api/brand-asset":
            user = self.current_user()
            if not user:
                self.send_json(401, {"error": "로그인 후 이용해 주세요."});return
            version_id = str(parse_qs(parsed.query).get("version_id", [""])[0])
            requested_format = str(parse_qs(parsed.query).get("format", [""])[0]).strip()
            store = get_auth_store()
            item = None
            if requested_format:
                try:
                    item = store.resolve_brand_variant(user["user_id"], version_id, requested_format)
                except ValueError as exc:
                    self.send_json(400, {"error": str(exc)});return
            else:
                item = next((row for row in store.list_brand_assets(user["user_id"])
                             if row["version_id"] == version_id), None)
            if not item:
                self.send_json(404, {"error": "브랜드 리소스를 찾을 수 없습니다."});return
            path = brand_asset_path(item["uri"])
            if not path:
                self.send_json(404, {"error": "브랜드 파일을 찾을 수 없습니다."});return
            self.send_bytes(200, path.read_bytes(), item.get("mime_type") or "application/octet-stream",
                            {"Cache-Control": "private, max-age=3600"})
            return
        if parsed.path == "/api/project-content":
            user = self.current_user()
            if not user:
                self.send_json(401, {"error": "로그인 후 이용해 주세요."})
                return
            project_id = str(parse_qs(parsed.query).get("project_id", [""])[0]).strip()
            latest = get_auth_store().latest_stage_data(user["user_id"], project_id, 3)
            if not latest:
                self.send_json(404, {"error": "생성된 최종대본이 없습니다."})
                return
            media_inheritance = get_auth_store().inherit_compatible_media_artifacts(
                user["user_id"], project_id, latest["revision_id"]
            )
            voice_clips = get_auth_store().list_scene_voice_clips(
                user["user_id"], project_id, latest["revision_id"]
            )
            content_data = json.loads(json.dumps(latest["data"], ensure_ascii=False))
            content_data["timeline"] = timeline_with_voice_durations(
                content_data.get("timeline") or {}, voice_clips
            )
            design_revision = get_auth_store().latest_stage_data(user['user_id'], project_id, 4)
            automation_editor = (design_revision or {}).get('data', {}).get('automation_editor')
            self.send_json(200, {
                "ok": True,
                "project_id": project_id,
                "revision": latest["revision"],
                "status": latest["status"],
                "content_uuid": project_id,
                "automation_editor": automation_editor,
                "media_inheritance": media_inheritance,
                "storyboard_images": get_auth_store().list_scene_images(
                    user["user_id"], project_id, latest["revision_id"]
                ),
                "storyboard_image_candidates": get_auth_store().list_scene_image_candidates(
                    user["user_id"], project_id, latest["revision_id"]
                ),
                "storyboard_voice_clips": voice_clips,
                "storyboard_videos": get_auth_store().list_scene_videos(
                    user["user_id"], project_id, latest["revision_id"]
                ),
                "storyboard_video_candidates": get_auth_store().list_scene_video_candidates(
                    user["user_id"], project_id, latest["revision_id"]
                ),
                "scene_crop_positions": get_auth_store().scene_crop_positions(
                    user["user_id"], project_id
                ),
                "brand_assets": get_auth_store().list_brand_assets(user["user_id"]),
                "brand_selections": get_auth_store().content_brand_selections(
                    user["user_id"], project_id
                ),
                **content_data,
            })
            return
        if parsed.path == "/api/project-state":
            user = self.current_user()
            if not user:
                self.send_json(401, {"error": "로그인 후 이용해 주세요."})
                return
            project_id = str(parse_qs(parsed.query).get("project_id", [""])[0]).strip()
            project = get_auth_store().get_project(user["user_id"], project_id)
            if not project:
                self.send_json(404, {"error": "프로젝트를 찾을 수 없습니다."})
                return
            keywords = get_auth_store().latest_stage_data(user["user_id"], project_id, 2)
            content = get_auth_store().latest_stage_data(user["user_id"], project_id, 3)
            media_inheritance = get_auth_store().inherit_compatible_media_artifacts(
                user["user_id"], project_id, content["revision_id"]
            ) if content else {"copied": 0, "source_revision_ids": []}
            content_voice_clips = get_auth_store().list_scene_voice_clips(
                user["user_id"], project_id, content["revision_id"]
            ) if content else []
            content_data = json.loads(json.dumps((content or {}).get("data"), ensure_ascii=False)) if content else None
            if content_data:
                content_data["timeline"] = timeline_with_voice_durations(
                    content_data.get("timeline") or {}, content_voice_clips
                )
            local_date = datetime.now(timezone(timedelta(hours=9))).date().isoformat()
            seasonal_keywords = list({item['id']: item for item in [*(get_auth_store().seasonal_keywords(project_id, local_date) or []), *((keywords or {}).get('data', {}).get('seasonal_keywords', []))]}.values())
            self.send_json(200, {
                "ok": True,
                "project": project,
                "content_uuid": project_id,
                "media_inheritance": media_inheritance,
                "keywords": (keywords or {}).get("data"),
                "seasonal_keywords": seasonal_keywords,
                "content": content_data,
                "content_revision": (content or {}).get("revision"),
                "content_status": (content or {}).get("status"),
                "storyboard_images": get_auth_store().list_scene_images(
                    user["user_id"], project_id, content["revision_id"]
                ) if content else [],
                "storyboard_image_candidates": get_auth_store().list_scene_image_candidates(
                    user["user_id"], project_id, content["revision_id"]
                ) if content else [],
                "storyboard_voice_clips": content_voice_clips,
                "storyboard_videos": get_auth_store().list_scene_videos(
                    user["user_id"], project_id, content["revision_id"]
                ) if content else [],
                "storyboard_video_candidates": get_auth_store().list_scene_video_candidates(
                    user["user_id"], project_id, content["revision_id"]
                ) if content else [],
                "scene_crop_positions": get_auth_store().scene_crop_positions(
                    user["user_id"], project_id
                ),
            })
            return
        if parsed.path == "/api/storyboard/video-jobs":
            user = self.current_user(); query = parse_qs(parsed.query)
            project_id = str(query.get("project_id", [""])[0]).strip()
            if not user or not get_auth_store().get_project(user["user_id"], project_id):
                self.send_json(404, {"error": "프로젝트를 찾을 수 없습니다."}); return
            jobs = []
            for task_id, job in load_project_kling_jobs().items():
                if job.get("user_id") != user["user_id"] or job.get("project_id") != project_id:
                    continue
                if job.get("status") not in {"queued", "running"}:
                    continue
                jobs.append({"task_id": task_id, "scene_id": job.get("scene_id"),
                             "status": job.get("status"), "model": job.get("model"),
                             "created_at": job.get("created_at")})
            self.send_json(200, {"ok": True, "project_id": project_id, "jobs": jobs})
            return
        if parsed.path == "/api/storyboard/video-status":
            user = self.current_user(); query = parse_qs(parsed.query)
            task_id = str(query.get("task_id", [""])[0]).strip()[:160]
            job = load_project_kling_jobs().get(task_id)
            if not user or not job or job.get("user_id") != user["user_id"]:
                self.send_json(404, {"error": "영상 생성 작업을 찾을 수 없습니다."}); return
            try:
                result = kling_api_request(provider_values("kling").get("api_key", ""), f"/v1/videos/image2video/{quote(task_id, safe='')}")
                task = kling_payload_data(result); status = kling_task_state(task); video = None
                if status == "succeeded":
                    artifact = save_kling_artifact(task_id, task, "video")
                    if not artifact:
                        raise RuntimeError("Kling 완료 영상 주소를 찾을 수 없습니다.")
                    target = KLING_ARTIFACT_DIR / Path(urlparse(artifact["uri"]).path).name
                    video_uri = f"/api/storyboard/video?project_id={quote(job['project_id'])}&file={quote(target.name)}"
                    registered = get_auth_store().register_artifact(
                        user["user_id"], job["project_id"], job["revision_id"], job["scene_id"],
                        "scene_video", video_uri, f"sha256:{hashlib.sha256(target.read_bytes()).hexdigest()}",
                        {"provider": "kling", "model": job["model"], "task_id": task_id,
                         "duration": job["duration"], "provider_duration": job.get("provider_duration", 5),
                         "playback_rate": job.get("playback_rate", 1)},
                    )
                    get_auth_store().select_scene_video(
                        user["user_id"], job["project_id"], job["revision_id"], job["scene_id"],
                        registered["artifact_id"],
                    )
                    video = {"scene_id": job["scene_id"], "uri": video_uri, "model": job["model"],
                             "task_id": task_id, "artifact_id": registered["artifact_id"], "duration": job["duration"],
                             "provider_duration": job.get("provider_duration", 5),
                             "playback_rate": job.get("playback_rate", 1)}
                save_project_kling_job(task_id, {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()})
                self.send_json(200, {"ok": True, "status": status, "scene_id": job["scene_id"], "video": video})
            except (ValueError, RuntimeError) as exc:
                self.send_json(502, {"error": str(exc)})
            return
        if parsed.path == "/api/demo":
            self.send_json(200, load_demo_data())
            return
        if parsed.path == "/api/provider-settings":
            self.send_json(200, provider_status_payload())
            return
        if parsed.path == "/api/kling-lab/usage":
            try:
                api_key = provider_values("kling").get("api_key", "")
                self.send_json(200, {"ok": True, "usage": kling_account_usage(api_key)})
            except ValueError as exc:
                self.send_json(400, {"error": str(exc)})
            except Exception as exc:
                self.send_json(502, {"error": str(exc)})
            return
        if parsed.path == "/api/kling-lab/status":
            try:
                task_id = str(parse_qs(parsed.query).get("task_id", [""])[0]).strip()[:160]
                if not task_id:
                    raise ValueError("조회할 Kling 작업 ID를 입력해 주세요.")
                api_key = provider_values("kling").get("api_key", "")
                result = kling_api_request(api_key, f"/v1/videos/image2video/{quote(task_id, safe='')}")
                task = kling_payload_data(result)
                artifact = save_kling_artifact(task_id, task, "video") if kling_result_url(task, "video") else None
                self.send_json(200, {"ok": True, "task": task, "usage": kling_usage_for_task(api_key, task_id), "local_artifact": artifact})
            except ValueError as exc:
                self.send_json(400, {"error": str(exc)})
            except Exception as exc:
                self.send_json(502, {"error": str(exc)})
            return
        if parsed.path == "/api/kling-lab/image-status":
            try:
                task_id = str(parse_qs(parsed.query).get("task_id", [""])[0]).strip()[:160]
                if not task_id:
                    raise ValueError("조회할 Kling 이미지 작업 ID를 입력해 주세요.")
                api_key = provider_values("kling").get("api_key", "")
                result = kling_api_request(api_key, f"/v1/images/generations/{quote(task_id, safe='')}")
                task = kling_payload_data(result)
                artifact = save_kling_artifact(task_id, task, "image") if kling_result_url(task, "image") else None
                self.send_json(200, {"ok": True, "task": task, "usage": kling_usage_for_task(api_key, task_id), "local_artifact": artifact})
            except ValueError as exc:
                self.send_json(400, {"error": str(exc)})
            except Exception as exc:
                self.send_json(502, {"error": str(exc)})
            return
        if parsed.path == "/api/render/status":
            job_id = str(parse_qs(parsed.query).get("job_id", [""])[0])[:100]
            with render_progress_lock:
                job = dict(render_jobs.get(job_id, {}))
            if not job:
                self.send_json(404, {"error": "변환 작업을 찾을 수 없습니다."})
                return
            self.send_json(200, {"ok": True, "job_id": job_id, **job})
            return
        super().do_GET()

    def do_POST(self):
        if self.path != '/api/storyboard/video-generate':
            return self._do_POST()
        if not kling_submission_lock.acquire(blocking=False):
            self.send_json(409, {'error': '영상 생성 요청을 등록 중입니다. 잠시 후 다시 확인해 주세요.'});return
        try:
            return self._do_POST()
        finally:
            kling_submission_lock.release()

    def do_PATCH(self):
        if self.path != "/api/render-settings":
            self.send_error(405)
            return
        handle_render_settings_request(self, merge=True)

    def _do_POST(self):
        if self.path == "/api/render-settings":
            handle_render_settings_request(self, merge=False)
            return
        if self.path in {'/api/storyboard/auto-select', '/api/project/auto-crop'}:
            user = self.current_user()
            if not user:
                self.send_json(401, {'error': '로그인 후 이용해 주세요.'});return
            try:
                payload = self.read_json()
                if not isinstance(payload, dict):
                    raise ValueError('요청 형식이 올바르지 않습니다.')
                project_id = str(payload.get('project_id', ''))
                decisions = VisualDecisions(get_auth_store(), storyboard_image_path, scene_video_path,
                                            find_ffmpeg(), provider_values('openai').get('api_key', ''))
                if self.path == '/api/storyboard/auto-select':
                    result = decisions.select(user['user_id'], project_id, payload.get('count'))
                else:
                    result = decisions.crop(user['user_id'], project_id, str(payload.get('scene_id', '')), payload.get('apply', False))
                self.send_json(200, {'ok': True, **result})
            except DecisionConflict as exc:
                self.send_json(409, {'error': str(exc)})
            except ValueError as exc:
                self.send_json(400, {'error': str(exc)})
            except Exception:
                self.send_json(502, {'error': '시각 분석을 완료하지 못했습니다. 원본과 API 연결을 확인해 주세요.'})
            return
        if self.path == '/api/automation':
            user = self.current_user()
            if not user:
                self.send_json(401, {'error': '로그인 후 이용해 주세요.'});return
            try:
                payload = self.read_json()
                if not isinstance(payload, dict):
                    raise ValueError('설정 형식이 올바르지 않습니다.')
                if payload.get('action') == 'start':
                    automation_config = validate_config(payload.get('config'))
                    keyword_options = automation_config['keywords']
                    month = keyword_options['month'] or datetime.now(timezone(timedelta(hours=9))).strftime('%Y-%m')
                    needs_openai = STAGES.index(automation_config['endpoint']) >= 2 or (keyword_options['ai'] and not load_month_pool(month))
                    if needs_openai and not provider_values('openai').get('api_key'):
                        raise ValueError('자동화에 필요한 플랫폼 OpenAI API 연결을 먼저 설정해 주세요.')
                    if STAGES.index(automation_config['endpoint']) >= 3 and automation_config['video']['scene_count'] and not provider_values('kling').get('api_key'):
                        raise ValueError('장면 영상 변환에 필요한 Kling API 연결을 먼저 설정해 주세요.')
                result = AutomationStore(get_auth_store()).configure(user['user_id'], payload.get('action'), payload)
                self.send_json(200, {'ok': True, **result})
            except VersionConflict as exc:
                self.send_json(409, {'error': str(exc)})
            except ValueError as exc:
                self.send_json(400, {'error': str(exc)})
            except (TypeError, KeyError):
                self.send_json(400, {'error': '설정을 확인해 주세요. 키워드 1~5개, 기본 크롭, 영상 변환 0개를 지원하며 영상 디자인부터는 채널 및 선택한 브랜드 리소스가 필요합니다.'})
            except Exception:
                self.send_json(503, {'error': '자동화 설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.'})
            return
        if self.path.startswith("/api/prompt-harness/") and not self.require_kling_lab_auth():
            return
        if self.path in {"/api/kling-lab/connect", "/api/kling-lab/image-generate", "/api/kling-lab/generate"}:
            if not self.require_kling_lab_auth():
                return
            try:
                payload = self.read_json()
                api_key = str(payload.get("api_key", "")).strip() or provider_values("kling").get("api_key", "")
                if self.path == "/api/kling-lab/connect":
                    video_result = kling_api_request(api_key, "/v1/videos/image2video?pageNum=1&pageSize=1")
                    image_result = kling_api_request(api_key, "/v1/images/generations?pageNum=1&pageSize=1")
                    if str(payload.get("api_key", "")).strip():
                        with provider_credentials_lock:
                            provider_credentials["kling"] = {"api_key": api_key}
                    self.send_json(200, {"ok": True, "message": "Kling 이미지·영상 API 인증에 성공했습니다.", "reachable": bool(video_result is not None and image_result is not None)})
                    return
                if self.path == "/api/kling-lab/image-generate":
                    prompt = str(payload.get("prompt", "")).strip()
                    if not prompt:
                        raise ValueError("이미지 생성 프롬프트를 입력해 주세요.")
                    if len(prompt) > 2500:
                        raise ValueError("Kling 프롬프트는 2,500자 이하로 입력해 주세요.")
                    model_name = str(payload.get("model_name", "kling-v1"))[:40]
                    allowed_models = {"kling-v1", "kling-v1-5", "kling-image-o1", "kling-image-3.0"}
                    if model_name not in allowed_models:
                        raise ValueError("지원 목록에 없는 Kling 이미지 모델입니다.")
                    request_payload = {
                        "model_name": model_name,
                        "prompt": prompt,
                        "negative_prompt": str(payload.get("negative_prompt", "")).strip()[:2500],
                        "n": 1,
                        "aspect_ratio": str(payload.get("aspect_ratio", "16:9")),
                    }
                    reference_mode = str(payload.get("reference_mode", "none")).strip()
                    if reference_mode not in {"none", "subject", "face", "background"}:
                        raise ValueError("지원하지 않는 참조 이미지 방식입니다.")
                    if reference_mode != "none":
                        if model_name != "kling-v1-5":
                            raise ValueError("참조 이미지 옵션은 Kling Image 1.5 모델을 선택해 주세요.")
                        scene_id = str(payload.get("scene_id", "")).strip()
                        reference_image, _ = local_scene_data_url(scene_id)
                        try:
                            reference_strength = float(payload.get("reference_strength", 0.55))
                        except (TypeError, ValueError):
                            raise ValueError("참조 강도 값이 올바르지 않습니다.") from None
                        if not 0.0 <= reference_strength <= 1.0:
                            raise ValueError("참조 강도는 0과 1 사이여야 합니다.")
                        if reference_mode == "background":
                            request_payload["prompt"] = (
                                "Use the reference photo as the fixed base scene. Preserve its background, architecture, "
                                "camera angle, perspective, lighting, colors, and existing objects. Add only the person "
                                "described below, naturally integrated with realistic scale, shadows, and reflections. "
                                "Do not redesign or replace the location.\n" + prompt
                            )[:2500]
                        request_payload.update({
                            "image": reference_image,
                            "image_reference": "face" if reference_mode == "face" else "subject",
                            "image_fidelity": reference_strength,
                            "human_fidelity": reference_strength if reference_mode in {"subject", "face"} else 0.2,
                        })
                    usage_before = kling_account_usage(api_key)
                    started = time.monotonic()
                    result = kling_api_request(api_key, "/v1/images/generations", request_payload,
                                               timeout=RUNTIME_CONFIG["kling_generation_timeout"])
                    if str(payload.get("api_key", "")).strip():
                        with provider_credentials_lock:
                            provider_credentials["kling"] = {"api_key": api_key}
                    task = kling_payload_data(result)
                    task_id = str(task.get("task_id") or task.get("id") or "")
                    if not task_id:
                        raise RuntimeError("Kling이 이미지 작업 ID를 반환하지 않았습니다.")
                    with kling_usage_lock:
                        kling_usage_baselines[task_id] = usage_before
                    usage = kling_usage_for_task(api_key, task_id)
                    self.send_json(200, {
                        "ok": True,
                        "job_id": f"kling-image-lab-{uuid.uuid4()}",
                        "project_id": "p1-demo",
                        "stage": "scene_image_generation",
                        "status": "queued",
                        "attempt": 1,
                        "input": {"model_name": model_name, "aspect_ratio": request_payload["aspect_ratio"], "reference_mode": reference_mode, "reference_strength": payload.get("reference_strength") if reference_mode != "none" else None},
                        "trace": {"provider": "kling", "provider_task_id": task_id, "latency_ms": round((time.monotonic() - started) * 1000)},
                        "usage": usage,
                    })
                    return
                prompt = str(payload.get("prompt", "")).strip()
                if not prompt:
                    raise ValueError("영상 움직임 프롬프트를 입력해 주세요.")
                if len(prompt) > 2500:
                    raise ValueError("Kling 프롬프트는 2,500자 이하로 입력해 주세요.")
                scene_id = str(payload.get("scene_id", "")).strip()
                generated_image_url = str(payload.get("image_url", "")).strip()
                if generated_image_url:
                    parsed_image_url = urlparse(generated_image_url)
                    if parsed_image_url.scheme != "https" or not parsed_image_url.netloc:
                        raise ValueError("생성 이미지 URL 형식이 올바르지 않습니다.")
                    image_data_url, scene = generated_image_url, {"id": "generated-image"}
                else:
                    image_data_url, scene = local_scene_data_url(scene_id)
                duration = str(payload.get("duration", "5"))
                if duration not in {"5", "10"}:
                    raise ValueError("테스트 영상 길이는 5초 또는 10초만 선택할 수 있습니다.")
                request_payload = {
                    "model_name": str(payload.get("model_name", "kling-v1-6"))[:40],
                    "mode": "std",
                    "duration": duration,
                    "image": image_data_url,
                    "prompt": prompt,
                    "negative_prompt": str(payload.get("negative_prompt", "")).strip()[:2500],
                    "cfg_scale": 0.5,
                }
                usage_before = kling_account_usage(api_key)
                started = time.monotonic()
                result = kling_api_request(api_key, "/v1/videos/image2video", request_payload,
                                           timeout=RUNTIME_CONFIG["kling_generation_timeout"])
                if str(payload.get("api_key", "")).strip():
                    with provider_credentials_lock:
                        provider_credentials["kling"] = {"api_key": api_key}
                task = kling_payload_data(result)
                task_id = str(task.get("task_id") or task.get("id") or "")
                if not task_id:
                    raise RuntimeError("Kling이 작업 ID를 반환하지 않았습니다.")
                with kling_usage_lock:
                    kling_usage_baselines[task_id] = usage_before
                usage = kling_usage_for_task(api_key, task_id)
                self.send_json(200, {
                    "ok": True,
                    "job_id": f"kling-lab-{uuid.uuid4()}",
                    "project_id": "p1-demo",
                    "stage": "image_to_video",
                    "status": "queued",
                    "attempt": 1,
                    "input": {"scene_id": scene.get("id"), "duration": int(duration), "model_name": request_payload["model_name"]},
                    "trace": {"provider": "kling", "provider_task_id": task_id, "latency_ms": round((time.monotonic() - started) * 1000)},
                    "usage": usage,
                })
            except ValueError as exc:
                self.send_json(400, {"error": str(exc)})
            except Exception as exc:
                self.send_json(502, {"error": str(exc)})
            return
        if self.path == "/api/prompt-harness/stream":
            try:
                payload = self.read_json()
                values = provider_values("gemini")
                api_key = str(payload.get("api_key", "")).strip() or values.get("api_key", "")
                if not api_key:
                    raise ValueError("실험실 상단에 Google Gemini 테스트 키를 입력해 주세요.")
                upstream, requested_model = open_gemini_stream(api_key, payload.get("prompt"))
            except ValueError as exc:
                self.send_json(400, {"error": str(exc)})
                return
            except Exception as exc:
                self.send_json(502, {"error": str(exc)})
                return
            started_at = time.monotonic()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-transform")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            trace = {"model": requested_model, "usage": {}}
            try:
                with upstream:
                    for raw_line in upstream:
                        line = raw_line.decode("utf-8", errors="replace").strip()
                        if not line.startswith("data:"):
                            continue
                        event = json.loads(line[5:].strip())
                        candidate = (event.get("candidates") or [{}])[0]
                        parts = candidate.get("content", {}).get("parts", [])
                        chunk = "".join(str(part.get("text", "")) for part in parts)
                        trace = {
                            "model": event.get("modelVersion") or trace["model"],
                            "usage": event.get("usageMetadata") or trace["usage"],
                            "finish_reason": candidate.get("finishReason") or trace.get("finish_reason"),
                        }
                        if chunk:
                            message = json.dumps({"type": "chunk", "text": chunk}, ensure_ascii=False)
                            self.wfile.write(f"data: {message}\n\n".encode("utf-8"))
                            self.wfile.flush()
                trace.update({"type": "done", "latency_ms": round((time.monotonic() - started_at) * 1000)})
                self.wfile.write(f"data: {json.dumps(trace, ensure_ascii=False)}\n\n".encode("utf-8"))
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as exc:
                try:
                    message = json.dumps({"type": "error", "error": str(exc)}, ensure_ascii=False)
                    self.wfile.write(f"data: {message}\n\n".encode("utf-8"))
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass
            return
        if self.path == "/api/login":
            try:
                payload = self.read_json()
                username = str(payload.get("username", "")).strip()
                password = str(payload.get("password", ""))
                user = get_auth_store().authenticate(username, password)
                if not user:
                    raise ValueError("아이디 또는 비밀번호가 올바르지 않습니다.")
                session_token = get_auth_store().create_session(user["user_id"])
                group = sync_default_group_resources(user["user_id"])
                cookie = f"thinkcast_session={session_token}; Path=/; HttpOnly; SameSite=Lax"
                if IS_RENDER_HOSTED:
                    cookie += "; Secure"
                self.send_json(200, {"ok": True, "state": {"user": {"id": user["user_id"], "name": user["username"]}, "group": group}}, {"Set-Cookie": cookie})
            except ValueError as exc:
                self.send_json(400, {"error": str(exc)})
            return
        if self.path == "/api/register":
            try:
                payload = self.read_json()
                username = str(payload.get("username", "")).strip()
                password = str(payload.get("password", ""))
                password_confirm = str(payload.get("password_confirm", ""))
                if password != password_confirm:
                    raise ValueError("비밀번호 확인이 일치하지 않습니다.")
                user = get_auth_store().create_user(username, password)
                session_token = get_auth_store().create_session(user["user_id"])
                group = sync_default_group_resources(user["user_id"])
                cookie = f"thinkcast_session={session_token}; Path=/; HttpOnly; SameSite=Lax"
                if IS_RENDER_HOSTED:
                    cookie += "; Secure"
                self.send_json(201, {"ok": True, "state": {"user": {"id": user["user_id"], "name": user["username"]}, "group": group}}, {"Set-Cookie": cookie})
            except ValueError as exc:
                self.send_json(400, {"error": str(exc)})
            return
        if self.path == "/api/logout":
            get_auth_store().delete_session(self.session_token())
            cookie = "thinkcast_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
            if IS_RENDER_HOSTED:
                cookie += "; Secure"
            self.send_json(200, {"ok": True}, {"Set-Cookie": cookie})
            return
        if self.path == "/api/brand-assets/upload":
            user = self.current_user()
            if not user:
                self.send_json(401, {"error": "로그인 후 이용해 주세요."});return
            try:
                payload = self.read_json();role = str(payload.get("role", ""))
                name = str(payload.get("name", "")).strip()[:80] or {"intro":"인트로","outro":"아웃트로","watermark":"워터마크"}.get(role, "브랜드 리소스")
                data_url = str(payload.get("data_url", ""))
                header, encoded = data_url.split(",", 1)
                mime = header.removeprefix("data:").split(";", 1)[0].lower()
                allowed = {"image/png":("image","png"), "image/jpeg":("image","jpg"),
                           "image/webp":("image","webp"), "video/mp4":("video","mp4")}
                if mime not in allowed: raise ValueError("PNG·JPG·WebP 이미지 또는 MP4 영상만 등록할 수 있습니다.")
                media_type, ext = allowed[mime]
                if role == "watermark" and mime != "image/png": raise ValueError("워터마크는 PNG만 등록할 수 있습니다.")
                raw = base64.b64decode(encoded, validate=True)
                if not raw or len(raw) > 45 * 1024 * 1024: raise ValueError("브랜드 파일은 45MB 이하로 등록해 주세요.")
                BRAND_ASSET_DIR.mkdir(parents=True, exist_ok=True)
                filename = f"{uuid.uuid4().hex}.{ext}";path = BRAND_ASSET_DIR / filename
                path.write_bytes(raw)
                result = get_auth_store().add_brand_asset_version(
                    user["user_id"], role, name, filename, media_type, mime
                )
                self.send_json(201, {"ok": True, **result})
            except (ValueError, binascii.Error) as exc:
                self.send_json(400, {"error": str(exc)})
            return
        if self.path == "/api/content-brand-selection":
            user = self.current_user()
            if not user:
                self.send_json(401, {"error": "로그인 후 이용해 주세요."});return
            try:
                payload=self.read_json();project_id=str(payload.get("project_id", ""))
                selections=get_auth_store().save_content_brand_selections(
                    user["user_id"], project_id, payload.get("selections") or []
                )
                self.send_json(200, {"ok": True, "selections": selections})
            except ValueError as exc:self.send_json(400, {"error": str(exc)})
            return
        if self.path == "/api/brand-asset-variant":
            user = self.current_user()
            if not user:
                self.send_json(401, {"error": "로그인 후 이용해 주세요."});return
            try:
                payload = self.read_json()
                required = ("version_id", "format", "uri", "width", "height", "media_type", "checksum")
                if any(key not in payload for key in required):
                    raise ValueError("브랜드 변형 필드가 부족합니다.")
                result = get_auth_store().add_brand_asset_variant(
                    user["user_id"], str(payload["version_id"]), str(payload["format"]),
                    str(payload["uri"]), payload["width"], payload["height"],
                    str(payload["media_type"]), str(payload["checksum"]),
                    str(payload.get("mime_type")) if payload.get("mime_type") else None,
                    str(payload.get("variant_id")) if payload.get("variant_id") else None,
                )
                self.send_json(201, {"ok": True, "variant": result})
            except (ValueError, TypeError) as exc:
                self.send_json(400, {"error": str(exc)})
            return
        if self.path == "/api/projects":
            user = self.current_user()
            if not user:
                self.send_json(401, {"error": "로그인 후 이용해 주세요."})
                return
            try:
                payload = self.read_json()
                project = get_auth_store().create_project(user["user_id"], str(payload.get("name", "새 콘텐츠")))
                self.send_json(201, {"ok": True, "project": project})
            except ValueError as exc:
                self.send_json(400, {"error": str(exc)})
            return
        if self.path == "/api/project/delete":
            user = self.current_user()
            if not user:
                self.send_json(401, {"error": "로그인 후 이용해 주세요."})
                return
            try:
                payload = self.read_json()
                project_id = str(payload.get("project_id", "")).strip()
                if not project_id:
                    raise ValueError("삭제할 콘텐츠 ID가 없습니다.")
                paths = project_deletion_file_paths(user["user_id"], project_id)
                if paths is None:
                    self.send_json(404, {"error": "콘텐츠를 찾을 수 없습니다."})
                    return
                quarantine_root, moved = quarantine_project_files(paths)
                original_kling_jobs = None
                with project_kling_job_lock:
                    try:
                        original_kling_jobs = stage_project_kling_jobs(project_id)
                        if not get_auth_store().delete_project(user["user_id"], project_id):
                            raise ValueError("콘텐츠를 찾을 수 없습니다.")
                    except Exception:
                        restore_project_kling_jobs(original_kling_jobs)
                        restore_project_files(quarantine_root, moved)
                        raise
                discard_project_quarantine(quarantine_root)
                with render_progress_lock:
                    for job_id in list(render_jobs):
                        if render_jobs[job_id].get("project_id") == project_id:
                            render_jobs.pop(job_id, None)
                self.send_json(200, {"ok": True, "project_id": project_id})
            except (OSError, ValueError) as exc:
                self.send_json(400, {"error": str(exc)})
            return
        if self.path == "/api/project/crop-position":
            user = self.current_user()
            if not user:
                self.send_json(401, {"error": "로그인 후 이용해 주세요."})
                return
            try:
                payload = self.read_json()
                saved = get_auth_store().save_scene_crop_position(
                    user["user_id"],
                    str(payload.get("project_id", "")).strip(),
                    str(payload.get("scene_id", "")).strip(),
                    str(payload.get("format", "")).strip(),
                    float(payload.get("pan_x", 50)),
                )
                self.send_json(200, {"ok": True, "crop_position": saved})
            except (TypeError, ValueError) as exc:
                self.send_json(400, {"error": str(exc)})
            return
        if self.path == "/api/storyboard/video-select":
            user = self.current_user()
            if not user:
                self.send_json(401, {"error": "로그인 후 이용해 주세요."})
                return
            try:
                payload = self.read_json()
                project_id = str(payload.get("project_id", "")).strip()
                latest = get_auth_store().latest_stage_data(user["user_id"], project_id, 3)
                if not latest:
                    raise ValueError("선택할 영상의 콘텐츠를 찾을 수 없습니다.")
                selected = get_auth_store().select_scene_video(
                    user["user_id"], project_id, latest["revision_id"],
                    str(payload.get("scene_id", "")).strip(),
                    str(payload.get("artifact_id", "")).strip(),
                )
                self.send_json(200, {"ok": True, "video": selected})
            except ValueError as exc:
                self.send_json(400, {"error": str(exc)})
            return
        if self.path == "/api/season-keywords/apply":
            user = self.current_user()
            if not user:
                self.send_json(401, {"error": "로그인 후 이용해 주세요."})
                return
            try:
                payload = self.read_json()
                if not isinstance(payload, dict):
                    raise ValueError("적용 요청 형식이 올바르지 않습니다.")
                recommendation_id = str(payload.get('recommendation_id', ''))
                with keyword_preview_lock:
                    result = next((value for key, value in keyword_preview_cache.items()
                                   if key[0] == user['user_id'] and value.get('recommendation_id') == recommendation_id), None)
                if not result:
                    raise ValueError("추천이 만료되었거나 변경되었습니다. 추천을 다시 받아 주세요.")
                saved = get_auth_store().apply_keyword_recommendation(user['user_id'], str(payload.get('project_id', '')), result['keywords'])
                self.send_json(200, {"ok": True, **saved})
            except ValueError as exc:
                self.send_json(400, {"error": str(exc)})
            except Exception:
                self.send_json(502, {"error": "키워드를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요."})
            return
        if self.path == "/api/season-keywords/preview":
            user = self.current_user()
            if not user:
                self.send_json(401, {"error": "로그인 후 이용해 주세요."})
                return
            cache_key = None
            claimed = False
            try:
                payload = self.read_json()
                if not isinstance(payload, dict):
                    raise ValueError("추천 요청 형식이 올바르지 않습니다.")
                count = payload.get("count", 3)
                refresh = payload.get("refresh", False)
                if type(refresh) is not bool:
                    raise ValueError("새 추천 요청 형식이 올바르지 않습니다.")
                if type(count) is not int or not 1 <= count <= 5:
                    raise ValueError("추천 개수는 1~5 사이의 정수여야 합니다.")
                local_date = datetime.now(timezone(timedelta(hours=9))).date().isoformat()
                cache_key = (user["user_id"], local_date, count)
                month = payload.get('month') or local_date[:7]
                pool = load_month_pool(month)
                if payload.get('month') and not pool:
                    raise ValueError('선택한 월의 키워드 후보가 아직 준비되지 않았습니다.')
                if pool:
                    drawn = get_auth_store().draw_monthly_keywords(user['user_id'],pool,count)
                    result = {'ok':True,**drawn,'recommendation_id':str(uuid.uuid4()),'context':korea_keyword_context(month+'-01'),
                              'usage':{'input_tokens':0,'output_tokens':0,'total_tokens':0},'cached':False}
                    with keyword_preview_lock:
                        if len(keyword_preview_cache)>=256:
                            keyword_preview_cache.pop(next(iter(keyword_preview_cache)))
                        keyword_preview_cache[cache_key]=result
                    self.send_json(200,result)
                    return
                with keyword_preview_lock:
                    previous = keyword_preview_cache.get(cache_key)
                    cached = None if refresh else previous
                    if cached is None and user["user_id"] not in keyword_preview_pending:
                        keyword_preview_pending.add(user["user_id"])
                        claimed = True
                if cached is not None:
                    self.send_json(200, {**cached, "cached": True})
                    return
                if not claimed:
                    self.send_json(409, {"error": "이미 추천을 요청하고 있습니다. 잠시 후 다시 시도해 주세요."})
                    return
                labels = [str(item.get("label", "")) for item in load_demo_data().get("keywords", [])]
                if refresh and previous:
                    labels.extend(item['label'] for item in previous['keywords'])
                keywords, response = openai_seasonal_keywords(provider_values("openai").get("api_key", ""), local_date, labels, count=count)
                usage = response.get("usage", {})
                get_auth_store().record_api_usage(user["user_id"], None, "openai", str(response.get("model", "")),
                                                  "seasonal_keyword_preview", str(response.get("id", "")), usage)
                recommendation_id = str(uuid.uuid4())
                keywords = [{**item, "id": f"season-{recommendation_id}-{index+1}"} for index, item in enumerate(keywords)]
                result = {"ok": True, "recommendation_id": recommendation_id, "keywords": keywords, "context": korea_keyword_context(local_date),
                          "usage": {key: int(usage.get(key, 0)) for key in ("input_tokens", "output_tokens", "total_tokens")}, "cached": False}
                with keyword_preview_lock:
                    if len(keyword_preview_cache) >= 256:
                        keyword_preview_cache.pop(next(iter(keyword_preview_cache)))
                    keyword_preview_cache[cache_key] = result
                self.send_json(200, result)
            except (ValueError, RuntimeError) as exc:
                self.send_json(400 if isinstance(exc, ValueError) else 502, {"error": str(exc)})
            except Exception:
                self.send_json(502, {"error": "AI 추천을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."})
            finally:
                if claimed:
                    with keyword_preview_lock:
                        keyword_preview_pending.discard(user["user_id"])
            return
        if self.path == "/api/season-keywords":
            user = self.current_user()
            if not user:
                self.send_json(401, {"error": "로그인 후 이용해 주세요."})
                return
            try:
                payload = self.read_json()
                project_id = str(payload.get("project_id", "")).strip()
                if not get_auth_store().get_project(user["user_id"], project_id):
                    self.send_json(404, {"error": "프로젝트를 찾을 수 없습니다."})
                    return
                local_date = datetime.now(timezone(timedelta(hours=9))).date().isoformat()
                cached = get_auth_store().seasonal_keywords(project_id, local_date)
                month = payload.get('month') or local_date[:7]
                pool = load_month_pool(month)
                if payload.get('month') and not pool:
                    raise ValueError('선택한 월의 키워드 후보가 아직 준비되지 않았습니다.')
                if pool:
                    drawn = get_auth_store().draw_monthly_keywords(user['user_id'],pool,3,project_id,local_date)
                    self.send_json(200,{'ok':True,**drawn,'cached':False,'usage':get_auth_store().usage_summary(user['user_id'],project_id)})
                    return
                refresh = payload.get("refresh", False)
                if type(refresh) is not bool:
                    raise ValueError("새 추천 요청 형식이 올바르지 않습니다.")
                if cached is not None and not refresh:
                    self.send_json(200, {
                        "ok": True, "keywords": cached[-3:], "cached": True,
                        "usage": get_auth_store().usage_summary(user["user_id"], project_id),
                    })
                    return
                data = load_demo_data()
                labels = [str(item.get("label", "")) for item in data.get("keywords", [])]
                if refresh:
                    labels.extend(item["label"] for item in (cached or []))
                keywords, response = openai_seasonal_keywords(
                    provider_values("openai").get("api_key", ""), local_date, labels, count=3
                )
                batch_id = str(uuid.uuid4())
                keywords = [{**item, "id": f"season-{batch_id}-{index+1}"} for index, item in enumerate(keywords)]
                usage_id = get_auth_store().record_api_usage(
                    user["user_id"], project_id, "openai", str(response.get("model", "")),
                    "seasonal_keyword_recommendation", str(response.get("id", "")), response.get("usage", {}),
                )
                # Keep earlier IDs valid for already selected cards; return only the new batch.
                get_auth_store().save_seasonal_keywords(project_id, local_date, [*(cached or []), *keywords], usage_id)
                self.send_json(200, {
                    "ok": True, "keywords": keywords, "cached": False,
                    "usage": get_auth_store().usage_summary(user["user_id"], project_id),
                })
            except (ValueError, RuntimeError) as exc:
                self.send_json(400 if isinstance(exc, ValueError) else 502, {"error": str(exc)})
            return
        if self.path.startswith("/api/"):
            if IS_RENDER_HOSTED and not self.has_site_auth():
                self.send_json(401, {"error": "로그인 후 이용해 주세요."})
                return
            try:
                payload = self.read_json()
                data = load_demo_data()
                state = data.setdefault("state", {})
                if self.path == "/api/keywords":
                    allowed = {item["id"] for item in data.get("keywords", [])}
                    user = self.current_user()
                    project_id = str(payload.get("project_id", "")).strip()
                    if not user or not get_auth_store().get_project(user["user_id"], project_id):
                        raise ValueError("작업할 프로젝트를 인덱스에서 다시 선택해 주세요.")
                    local_date = datetime.now(timezone(timedelta(hours=9))).date().isoformat()
                    seasonal = get_auth_store().seasonal_keywords(project_id, local_date) or []
                    saved_keywords = get_auth_store().latest_stage_data(user['user_id'], project_id, 2)
                    seasonal = list({item['id']: item for item in [*seasonal, *((saved_keywords or {}).get('data', {}).get('seasonal_keywords', []))]}.values())
                    allowed.update(str(item.get("id", "")) for item in seasonal)
                    selected = [str(item) for item in payload.get("selected", [])]
                    if not selected or len(selected) > 5 or any(item not in allowed for item in selected):
                        raise ValueError("마케팅 키워드는 1개 이상 5개 이하로 선택해 주세요.")
                    selected = list(dict.fromkeys(selected))
                    keyword_map = {str(item["id"]): item for item in [*data.get("keywords", []), *seasonal]}
                    selected_labels = [str(keyword_map[item]["label"]).strip() for item in selected]
                    state["selected_keywords"] = selected
                    keyword_draft = get_auth_store().save_stage_draft(user["user_id"], project_id, 2, {
                        "selected_keyword_ids": selected,
                        "selected_keywords": selected_labels,
                        "seasonal_keywords": [item for item in seasonal if item['id'] in selected],
                    })
                    get_auth_store().confirm_stage_revision(
                        user["user_id"], project_id, keyword_draft["revision_id"]
                    )
                elif self.path in {"/api/script/plan", "/api/script/generate"}:
                    user = self.current_user()
                    project_id = str(payload.get("project_id", "")).strip()
                    project = get_auth_store().get_project(user["user_id"], project_id) if user else None
                    if not project:
                        raise ValueError("작업할 프로젝트를 인덱스에서 다시 선택해 주세요.")
                    keyword_revision = get_auth_store().latest_stage_data(user["user_id"], project_id, 2)
                    labels = list((keyword_revision or {}).get("data", {}).get("selected_keywords", []))
                    if not 1 <= len(labels) <= 5:
                        raise ValueError("먼저 STEP 02에서 키워드 1~5개를 저장해 주세요.")
                    existing_content = get_auth_store().latest_stage_data(
                        user["user_id"], project_id, 3
                    )
                    existing_document = (existing_content or {}).get("data", {}).get("document")
                    existing_keywords = (
                        (existing_document or {}).get("project", {}).get("selected_keywords", [])
                        if isinstance(existing_document, dict) else []
                    )
                    if self.path == "/api/script/generate" and existing_keywords == labels:
                        media_inheritance = get_auth_store().inherit_compatible_media_artifacts(
                            user["user_id"], project_id, existing_content["revision_id"]
                        )
                        existing_script, existing_timeline = unified_document_view(existing_document)
                        state["selected_keywords"] = list(
                            (keyword_revision or {}).get("data", {}).get("selected_keyword_ids", [])
                        )
                        state["script"] = existing_script
                        self.send_json(200, {
                            "ok": True,
                            "state": state,
                            "document": existing_document,
                            "timeline": existing_timeline,
                            "generation": {
                                "project_id": project_id,
                                "content_uuid": project_id,
                                "reused": True,
                                "revision_id": existing_content["revision_id"],
                                "message": "같은 키워드의 저장된 최종대본을 불러왔습니다.",
                                "media_inheritance": media_inheritance,
                                "usage": get_auth_store().usage_summary(user["user_id"], project_id),
                            },
                        })
                        return
                    resource_types = (
                        "default_asset_manifest", "reference_library", "prompt_contract",
                        "canonical_storyboard_spec",
                    )
                    resources = get_auth_store().project_group_resources(
                        user["user_id"], project_id, resource_types
                    )
                    previous_documents = get_auth_store().recent_group_documents(
                        user["user_id"], project_id, labels
                    )
                    if not claim_script_generation(project_id):
                        raise ConflictError("이 콘텐츠의 최종대본 요청 1건이 이미 처리 중입니다. 현재 모달에서 완료를 기다려 주세요.")
                    try:
                        script_plan_data = get_auth_store().latest_script_plan(
                            user["user_id"], project_id, labels)
                        if self.path == "/api/script/plan":
                            if script_plan_data:
                                self.send_json(200, {"ok": True, "plan": script_plan_data["plan"], "reused": True})
                                return
                            plan, plan_response = openai_script_plan(
                                provider_values("openai").get("api_key", ""), labels, resources,
                                get_auth_store().recent_group_visual_usage(user["user_id"], project_id),
                            )
                            get_auth_store().save_stage_candidate(user["user_id"], project_id, 3, {
                                "kind": "script_plan", "schema_version": "1.0.0",
                                "selected_keywords": labels, "plan": plan,
                            })
                            get_auth_store().record_api_usage(
                                user["user_id"], project_id, "openai", str(plan_response.get("model", "")),
                                "script_plan_generation", str(plan_response.get("id", "")),
                                plan_response.get("usage", {}),
                            )
                            self.send_json(200, {"ok": True, "plan": plan, "reused": False})
                            return
                        if not script_plan_data:
                            raise ValueError("먼저 1차 대본을 작성해 주세요.")
                        generated, openai_response = openai_unified_storyboard(
                            provider_values("openai").get("api_key", ""), labels,
                            resources, previous_documents, script_plan_data["plan"],
                        )
                    except Exception as exc:
                        log_script_generation_failure(project_id, exc)
                        raise
                    finally:
                        release_script_generation(project_id)
                    document = generated["document"]
                    script, project_timeline = unified_document_view(document)
                    state["selected_keywords"] = list(
                        (keyword_revision or {}).get("data", {}).get("selected_keyword_ids", [])
                    )
                    state["script"] = script
                    candidate = get_auth_store().save_stage_candidate(user["user_id"], project_id, 3, {
                        "document": document,
                        "script": script,
                        "selected_keywords": labels,
                        "group_id": project["group_id"],
                        "resource_ids": [item["resource_id"] for item in resources],
                        "repair_count": generated["repair_count"],
                        "maximum_similarity": generated["maximum_similarity"],
                    })
                    script_draft = get_auth_store().save_stage_draft(user["user_id"], project_id, 3, {
                        "document": document,
                        "script": script,
                        "timeline": project_timeline,
                        "selected_keywords": labels,
                        "selected_keyword_ids": state["selected_keywords"],
                        "candidate_id": candidate["candidate_id"],
                        "group_id": project["group_id"],
                        "resource_ids": [item["resource_id"] for item in resources],
                        "voice_profile": "warm_female",
                    })
                    get_auth_store().update_project_name(
                        user["user_id"], project_id, script["headline"]
                    )
                    get_auth_store().record_api_usage(
                        user["user_id"], project_id, "openai", str(openai_response.get("model", "")),
                        "group_referenced_script_generation", str(openai_response.get("id", "")),
                        openai_response.get("usage", {}),
                    )
                    generation_meta = {
                        "project_id": project_id,
                        "group_id": project["group_id"],
                        "candidate_id": candidate["candidate_id"],
                        "resource_count": len(resources),
                        "resource_types": sorted({item["resource_type"] for item in resources}),
                        "document_id": document["document_id"],
                        "schema_version": document["schema_version"],
                        "scene_count": len(document["production"]["timeline"]["scenes"]),
                        "repair_count": generated["repair_count"],
                        "usage": get_auth_store().usage_summary(user["user_id"], project_id),
                    }
                elif self.path == "/api/script/save":
                    user = self.current_user()
                    project_id = str(payload.get("project_id", "")).strip()
                    latest = get_auth_store().latest_stage_data(user["user_id"], project_id, 3) if user else None
                    document = (latest or {}).get("data", {}).get("document")
                    if not isinstance(document, dict):
                        raise ValueError("저장할 최종대본을 먼저 생성해 주세요.")
                    edited_script = {
                        "headline": str(payload.get("headline", "")).strip()[:100] or "하루를 보면 마음이 보입니다",
                        "concept": str(payload.get("concept", "")).strip()[:300],
                        "lines": [str(line).strip() for line in payload.get("lines", [])],
                    }
                    document = apply_script_edits(document, edited_script)
                    script, project_timeline = unified_document_view(document)
                    state["script"] = script
                    candidate = get_auth_store().save_stage_candidate(user["user_id"], project_id, 3, {
                        "document": document,
                        "script": script,
                        "selected_keywords": document["project"]["selected_keywords"],
                        "group_id": latest["data"]["group_id"],
                        "resource_ids": latest["data"].get("resource_ids", []),
                        "source": "user_edit",
                    })
                    edited_draft = get_auth_store().save_stage_draft(user["user_id"], project_id, 3, {
                        "document": document,
                        "script": script,
                        "timeline": project_timeline,
                        "selected_keywords": document["project"]["selected_keywords"],
                        "selected_keyword_ids": latest["data"].get("selected_keyword_ids", []),
                        "candidate_id": candidate["candidate_id"],
                        "group_id": latest["data"]["group_id"],
                        "resource_ids": latest["data"].get("resource_ids", []),
                        "voice_profile": latest["data"].get("voice_profile", "warm_female"),
                    })
                    get_auth_store().update_project_name(
                        user["user_id"], project_id, script["headline"]
                    )
                    get_auth_store().confirm_stage_revision(
                        user["user_id"], project_id, edited_draft["revision_id"]
                    )
                elif self.path == "/api/voice/select":
                    user = self.current_user()
                    project_id = str(payload.get("project_id", "")).strip()
                    profile_id = str(payload.get("profile_id", "")).strip()
                    if profile_id not in VOICE_PROFILES:
                        raise ValueError("선택한 음성 프로필을 찾을 수 없습니다.")
                    latest = get_auth_store().latest_stage_data(user["user_id"], project_id, 3) if user else None
                    if not latest:
                        raise ValueError("음성을 연결할 최종대본을 먼저 생성해 주세요.")
                    if latest["data"].get("voice_profile") == profile_id:
                        voice_revision = {key: latest[key] for key in ("revision_id", "revision", "status")}
                    else:
                        voice_data = json.loads(json.dumps(latest["data"], ensure_ascii=False))
                        voice_data["voice_profile"] = profile_id
                        voice_revision = get_auth_store().save_stage_draft(
                            user["user_id"], project_id, 3, voice_data
                        )
                elif self.path == "/api/voice/generate-scene":
                    user = self.current_user()
                    project_id = str(payload.get("project_id", "")).strip()
                    scene_id = str(payload.get("scene_id", "")).strip()
                    latest = get_auth_store().latest_stage_data(user["user_id"], project_id, 3) if user else None
                    document = (latest or {}).get("data", {}).get("document")
                    if not isinstance(document, dict):
                        raise ValueError("음성을 생성할 최종대본을 먼저 준비해 주세요.")
                    profile_id = str(latest["data"].get("voice_profile", "warm_female"))
                    voice_result = generate_voice_clips(
                        provider_values("openai").get("api_key", ""), user["user_id"],
                        project_id, latest, document, profile_id, target_scene_id=scene_id,
                    )
                    scene_voice = voice_result["clips"][0]
                    scene_voice["profile_id"] = profile_id
                    voice_timeline = timeline_with_voice_durations(
                        latest["data"].get("timeline") or {},
                        get_auth_store().list_scene_voice_clips(
                            user["user_id"], project_id, latest["revision_id"]
                        ),
                    )
                elif self.path == "/api/storyboard/image-generate":
                    user = self.current_user()
                    project_id = str(payload.get("project_id", "")).strip()
                    scene_id = str(payload.get("scene_id", "")).strip()
                    provider = str(payload.get("provider", "")).strip()
                    model = str(payload.get("model", "")).strip()
                    force = payload.get("force") is True
                    latest = get_auth_store().latest_stage_data(user["user_id"], project_id, 3) if user else None
                    document = (latest or {}).get("data", {}).get("document")
                    if not isinstance(document, dict):
                        raise ValueError("이미지를 생성할 최종대본을 먼저 준비해 주세요.")
                    storyboard_scene = next((item for item in document["production"]["timeline"]["scenes"] if item.get("id") == scene_id), None)
                    if not storyboard_scene:
                        raise ValueError("생성할 씬을 찾을 수 없습니다.")
                    base_prompt = str((storyboard_scene.get("image_prompt") or {}).get("text", "")).strip()
                    stored_images = {item["scene_id"]: item for item in get_auth_store().list_scene_images(
                        user["user_id"], project_id, latest["revision_id"]
                    )}
                    prompt = continuity_locked_prompt(document, storyboard_scene, base_prompt)
                    reference_paths = scene_reference_paths(document, storyboard_scene)
                    existing_image = None
                    if not force:
                        existing_image = stored_images.get(scene_id)
                    if existing_image:
                        storyboard_image = {"status": "succeeded", "reused": True, **existing_image}
                    elif provider == "openai":
                        result, request_id = openai_reference_image(
                            provider_values("openai").get("api_key", ""), model, prompt, reference_paths
                        )
                        output = (result.get("data") or [{}])[0]
                        if output.get("b64_json"):
                            image_bytes = base64.b64decode(output["b64_json"])
                        elif output.get("url"):
                            with urlopen(output["url"], timeout=RUNTIME_CONFIG["media_download_timeout"]) as image_response:
                                image_bytes = image_response.read()
                        else:
                            raise RuntimeError("OpenAI가 생성 이미지 데이터를 반환하지 않았습니다.")
                        prompt_hash = hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:12]
                        output_dir = STORYBOARD_IMAGE_DIR / project_id / latest["revision_id"] / scene_id
                        output_dir.mkdir(parents=True, exist_ok=True)
                        filename = f"{model}_{prompt_hash}_{uuid.uuid4().hex[:10]}.webp"
                        image_path = output_dir / filename
                        image_path.write_bytes(image_bytes)
                        image_uri = (f"/api/storyboard/image?project_id={quote(project_id)}"
                                     f"&revision_id={quote(latest['revision_id'])}&scene_id={quote(scene_id)}"
                                     f"&file={quote(filename)}")
                        registered_image = get_auth_store().register_artifact(
                            user["user_id"], project_id, latest["revision_id"], scene_id,
                            "scene_image_candidate", image_uri,
                            f"sha256:{hashlib.sha256(image_bytes).hexdigest()}",
                            {"provider": provider, "model": model, "reference_ids": storyboard_scene.get("reference_ids", []), "request_id": request_id},
                        )
                        get_auth_store().select_scene_image(
                            user["user_id"], project_id, latest["revision_id"], scene_id,
                            registered_image["artifact_id"],
                        )
                        image_usage = {
                            "input_tokens": int((result.get("usage") or {}).get("input_tokens", 0)),
                            "output_tokens": int((result.get("usage") or {}).get("output_tokens", 0)),
                            "total_tokens": int((result.get("usage") or {}).get("total_tokens", 0)),
                        }
                        usage_id = get_auth_store().record_api_usage(
                            user["user_id"], project_id, "openai", model,
                            "scene_reference_image_generation", request_id, image_usage,
                        )
                        storyboard_image = {
                            "status": "succeeded", "uri": image_uri,
                            "artifact_id": registered_image["artifact_id"], "model": model,
                            "usage_id": usage_id, "usage": image_usage,
                        }
                    elif provider == "kling":
                        if model != "kling-v1-5":
                            raise ValueError("레퍼런스 유지용 Kling 모델은 Image 1.5만 지원합니다.")
                        if len(reference_paths) != 1:
                            raise ValueError("Kling Image 1.5는 현재 한 장의 참조 이미지만 안정적으로 연결할 수 있어 이 씬에서는 사용할 수 없습니다.")
                        mime = "image/png" if reference_paths[0].suffix.lower() == ".png" else "image/jpeg"
                        reference_data = f"data:{mime};base64,{base64.b64encode(reference_paths[0].read_bytes()).decode('ascii')}"
                        result = kling_api_request(provider_values("kling").get("api_key", ""), "/v1/images/generations", {
                            "model_name": model, "prompt": prompt, "negative_prompt": "", "n": 1,
                            "aspect_ratio": "16:9", "image": reference_data,
                            "image_reference": "subject", "image_fidelity": 0.75, "human_fidelity": 0.75,
                        }, timeout=RUNTIME_CONFIG["kling_generation_timeout"])
                        task = kling_payload_data(result); task_id = str(task.get("task_id") or task.get("id") or "")
                        if not task_id: raise RuntimeError("Kling이 이미지 작업 ID를 반환하지 않았습니다.")
                        storyboard_image = {"status": "queued", "task_id": task_id, "model": model}
                    else:
                        raise ValueError("지원하지 않는 이미지 공급자입니다.")
                elif self.path == "/api/storyboard/image-select":
                    user = self.current_user()
                    project_id = str(payload.get("project_id", "")).strip()
                    scene_id = str(payload.get("scene_id", "")).strip()
                    artifact_id = str(payload.get("artifact_id", "")).strip()
                    latest = get_auth_store().latest_stage_data(user["user_id"], project_id, 3) if user else None
                    if not latest:
                        raise ValueError("이미지를 연결할 최종대본을 먼저 준비해 주세요.")
                    selected_image = get_auth_store().select_scene_image(
                        user["user_id"], project_id, latest["revision_id"], scene_id, artifact_id
                    )
                elif self.path == "/api/storyboard/video-generate":
                    user = self.current_user()
                    project_id = str(payload.get("project_id", "")).strip()
                    scene_id = str(payload.get("scene_id", "")).strip()
                    force = payload.get("force") is True
                    latest = get_auth_store().latest_stage_data(user["user_id"], project_id, 3) if user else None
                    document = (latest or {}).get("data", {}).get("document")
                    if not isinstance(document, dict):
                        raise ValueError("영상을 생성할 최종대본을 먼저 준비해 주세요.")
                    scenes = document["production"]["timeline"]["scenes"]
                    scene_index = next((index for index, item in enumerate(scenes) if item.get("id") == scene_id), -1)
                    if scene_index < 0:
                        raise ValueError("영상으로 만들 씬을 찾을 수 없습니다.")
                    existing_video = next((item for item in get_auth_store().list_scene_videos(
                        user["user_id"], project_id, latest["revision_id"]
                    ) if item["scene_id"] == scene_id), None)
                    pending_video = next((dict(job, task_id=task_id) for task_id, job in load_project_kling_jobs().items()
                                          if job.get('user_id') == user['user_id'] and job.get('project_id') == project_id
                                          and job.get('revision_id') == latest['revision_id'] and job.get('scene_id') == scene_id
                                          and job.get('status') in {'queued', 'running'}), None)
                    if pending_video and not force and not existing_video:
                        shared_job={'status':pending_video['status'],'task_id':pending_video['task_id'],'scene_id':scene_id,'reused':True}
                        self.send_json(200, {'ok': True, 'video_job':shared_job,'scene_video_job':shared_job})
                        return
                    if existing_video and not force:
                        scene_video_job = {"status": "succeeded", "reused": True, "video": existing_video}
                    else:
                        images = {item["scene_id"]: item for item in get_auth_store().list_scene_images(
                            user["user_id"], project_id, latest["revision_id"]
                        )}
                        start_image = storyboard_image_path((images.get(scene_id) or {}).get("uri"))
                        if not start_image:
                            raise ValueError("이 씬의 생성 이미지를 먼저 준비해 주세요.")
                        scene = scenes[scene_index]
                        base_motion = str((scene.get("motion_prompt") or {}).get("text", "")).strip()
                        user_motion = str(payload.get("motion_prompt", "")).strip()[:1200]
                        user_negative = str(payload.get("negative_prompt", "")).strip()[:1200]
                        prompt = (f"{base_motion}\nAdditional motion direction: {user_motion}\n" if user_motion else f"{base_motion}\n") + KLING_I2V_HARNESS
                        negative = (user_negative + ", " if user_negative else "") + KLING_I2V_NEGATIVE
                        voice_clips = get_auth_store().list_scene_voice_clips(
                            user["user_id"], project_id, latest["revision_id"]
                        )
                        _, base_timeline = unified_document_view(document)
                        timed_scene = next(item for item in timeline_with_voice_durations(
                            base_timeline, voice_clips
                        )["scenes"] if item["id"] == scene_id)
                        duration = max(0.1, float(timed_scene["end"]) - float(timed_scene["start"]))
                        provider_duration = 5 if duration <= 6.5 else 10
                        model = os.environ.get("KLING_VIDEO_MODEL", "kling-v2-5-turbo")
                        request_payload = {"model_name": model, "mode": "std", "duration": str(provider_duration),
                                           "image": file_data_url(start_image), "prompt": prompt[:2500],
                                           "negative_prompt": negative[:2500]}
                        if model.startswith("kling-v1"):
                            request_payload["cfg_scale"] = 0.5
                        result = kling_api_request(provider_values("kling").get("api_key", ""),
                                                   "/v1/videos/image2video", request_payload,
                                                   timeout=RUNTIME_CONFIG["kling_generation_timeout"])
                        task = kling_payload_data(result); task_id = str(task.get("task_id") or task.get("id") or "")
                        if not task_id:
                            raise RuntimeError("Kling이 영상 작업 ID를 반환하지 않았습니다.")
                        save_project_kling_job(task_id, {
                            "user_id": user["user_id"], "project_id": project_id,
                            "revision_id": latest["revision_id"], "scene_id": scene_id,
                            "model": model, "duration": duration, "provider_duration": provider_duration,
                            "playback_rate": round(provider_duration / duration, 6), "status": "queued",
                            "has_tail_frame": False, "prompt_harness_version": "i2v-single-frame-v2",
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        })
                        scene_video_job = {"status": "queued", "task_id": task_id, "scene_id": scene_id,
                                           "model": model, "provider_duration": provider_duration,
                                           "timeline_duration": round(duration, 3), "has_tail_frame": False,
                                           "prompt_harness_version": "i2v-single-frame-v2"}
                elif self.path == "/api/production/prepare":
                    user = self.current_user()
                    project_id = str(payload.get("project_id", "")).strip()
                    latest = get_auth_store().latest_stage_data(user["user_id"], project_id, 3) if user else None
                    if not latest or latest["status"] != "confirmed":
                        raise ValueError("확정된 최종대본이 없습니다. STEP 03 대본을 먼저 확정해 주세요.")
                    document = latest["data"].get("document")
                    if not isinstance(document, dict) or not document.get("production", {}).get("timeline", {}).get("scenes"):
                        raise ValueError("최종대본의 제작 타임라인을 찾을 수 없습니다.")
                    voice_profile = str(latest["data"].get("voice_profile", "warm_female"))
                    voice_output = generate_voice_clips(
                        provider_values("openai").get("api_key", ""), user["user_id"],
                        project_id, latest, document, voice_profile,
                    )
                    handoff = {
                        "schema_version": "1.0.0",
                        "job_id": f"handoff-{uuid.uuid4()}",
                        "project_id": project_id,
                        "stage": "storyboard_handoff",
                        "status": "succeeded",
                        "attempt": 1,
                        "idempotency_key": f"{project_id}:storyboard:{latest['revision_id']}",
                        "input": {
                            "source_revision_id": latest["revision_id"],
                            "document": document,
                            "voice_profile": voice_profile,
                        },
                        "trace": {
                            "trace_id": str(uuid.uuid4()),
                            "parent_job_id": None,
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        },
                    }
                    production_draft = get_auth_store().save_stage_draft(
                        user["user_id"], project_id, 4,
                        {"handoff": handoff, "source_stage_revision_id": latest["revision_id"], "voice_output": voice_output},
                    )
                elif self.path == "/api/image/regenerate":
                    scene_index = int(payload.get("scene_index", -1))
                    additional_prompt = str(payload.get("additional_prompt", "")).strip()
                    if scene_index < 0 or scene_index >= len(timeline_from_data(data)):
                        raise ValueError("장면 정보가 올바르지 않습니다.")
                    if not additional_prompt:
                        raise ValueError("추가 프롬프트를 입력해 주세요.")
                    requests = state.setdefault("image_regeneration_requests", [])
                    scene_requests = [item for item in requests if item.get("scene_index") == scene_index]
                    request = {
                        "job_id": f"scene-image-{scene_index + 1}-{time.time_ns()}",
                        "scene_index": scene_index,
                        "request_number": len(scene_requests) + 1,
                        "base_prompt_ref": f"storyboard.scenes[{scene_index}].image_prompt",
                        "additional_prompt": additional_prompt[:500],
                        "preserve_existing": True,
                        "status": "queued",
                        "adapter": "image_provider_planned",
                        "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
                    }
                    requests.append(request)
                elif self.path == "/api/provider-settings":
                    if IS_RENDER_HOSTED:
                        raise ValueError("공개 Render에서는 브라우저로 API 키를 저장할 수 없습니다. Render Dashboard의 Environment에 환경변수로 등록해 주세요.")
                    provider = str(payload.get("provider", "")).strip()
                    if provider not in PROVIDER_CONFIG:
                        raise ValueError("지원하지 않는 API 공급자입니다.")
                    values = {key: str(value).strip() for key, value in dict(payload.get("credentials", {})).items()}
                    required = [field["id"] for field in PROVIDER_CONFIG[provider]["fields"]]
                    if any(not values.get(key) for key in required):
                        raise ValueError("필수 인증값을 모두 입력해 주세요.")
                    test_provider_connection(provider, values)
                    with provider_credentials_lock:
                        provider_credentials[provider] = {key: values[key] for key in required}
                elif self.path == "/api/prompt-harness/test":
                    values = provider_values("gemini")
                    one_time_key = str(payload.get("api_key", "")).strip()
                    api_key = one_time_key or values.get("api_key", "")
                    if not api_key:
                        raise ValueError("실험실 상단에 Google Gemini 테스트 키를 입력해 주세요.")
                    prompt_test = test_gemini_prompt(api_key, payload.get("prompt"))
                elif self.path == "/api/prompt-harness/image":
                    values = provider_values("gemini")
                    one_time_key = str(payload.get("api_key", "")).strip()
                    api_key = one_time_key or values.get("api_key", "")
                    if not api_key:
                        raise ValueError("실험실 상단에 Google Gemini 테스트 키를 입력해 주세요.")
                    prompt_test = test_gemini_image(api_key, payload.get("prompt"))
                else:
                    self.send_json(404, {"error": "지원하지 않는 요청입니다."})
                    return
                if self.path not in {"/api/provider-settings", "/api/prompt-harness/test", "/api/prompt-harness/image", "/api/voice/select", "/api/voice/generate-scene", "/api/storyboard/image-generate", "/api/storyboard/image-select", "/api/storyboard/video-generate"}:
                    save_demo_data(data)
                response = {"ok": True, "state": state}
                if self.path == "/api/script/generate":
                    response["generation"] = generation_meta
                    response["document"] = document
                    response["timeline"] = project_timeline
                if self.path == "/api/script/save":
                    response["document"] = document
                    response["timeline"] = project_timeline
                if self.path == "/api/production/prepare":
                    response["handoff"] = handoff
                    response["revision"] = production_draft
                    response["voice_output"] = voice_output
                if self.path == "/api/voice/select":
                    response["voice_profile"] = profile_id
                    response["revision"] = voice_revision
                if self.path == "/api/voice/generate-scene":
                    response["voice"] = scene_voice
                    response["timeline"] = voice_timeline
                if self.path == "/api/storyboard/image-generate":
                    response["image"] = storyboard_image
                if self.path == "/api/storyboard/image-select":
                    response["image"] = selected_image
                if self.path == "/api/storyboard/video-generate":
                    response["video_job"] = scene_video_job
                if self.path == "/api/image/regenerate":
                    response["request"] = request
                if self.path == "/api/provider-settings":
                    response = provider_status_payload()
                    response["message"] = f"{PROVIDER_CONFIG[provider]['label']} 실제 API 인증에 성공했습니다. 키는 현재 서버 프로세스 메모리에만 보관됩니다."
                if self.path in {"/api/prompt-harness/test", "/api/prompt-harness/image"}:
                    response = {"ok": True, **prompt_test}
                self.send_json(200, response)
            except ConflictError as exc:
                self.send_json(409, {"error": str(exc)})
            except ValueError as exc:
                self.send_json(400, {"error": str(exc)})
            except RuntimeError as exc:
                self.send_json(502, {"error": str(exc)})
            except Exception as exc:
                self.send_json(500, {"error": str(exc)})
            return
        if self.path != "/render":
            self.send_json(404, {"error": "지원하지 않는 요청입니다."})
            return
        user = self.current_user()
        if not user:
            self.send_json(401, {"error": "로그인 후 이용해 주세요."})
            return
        if IS_RENDER_HOSTED:
            self.send_json(503, {"error": "Render 공개 미리보기에서는 FFmpeg 출력을 실행하지 않습니다. 로컬 변환 주소를 이용해 주세요."})
            return
        if not render_lock.acquire(blocking=False):
            self.send_json(409, {"error": "이미 변환 작업이 진행 중입니다."})
            return
        job_id = ""
        temporary_caption_roots = set()
        try:
            data = self.read_json()
            project_id = str(data.get("project_id", "")).strip()
            latest = get_auth_store().latest_stage_data(user["user_id"], project_id, 3)
            document = (latest or {}).get("data", {}).get("document")
            if not isinstance(document, dict):
                raise ValueError("최종 출력할 콘텐츠 대본을 찾을 수 없습니다.")
            script, project_timeline = unified_document_view(document)
            voice_clips = get_auth_store().list_scene_voice_clips(
                user["user_id"], project_id, latest["revision_id"]
            )
            project_timeline = timeline_with_voice_durations(project_timeline, voice_clips)
            content_data = {"state": {"script": script}, "timeline": project_timeline}
            selected_images = get_auth_store().list_scene_images(
                user["user_id"], project_id, latest["revision_id"]
            )
            selected_videos = get_auth_store().list_scene_videos(
                user["user_id"], project_id, latest["revision_id"]
            )
            brand_selections = get_auth_store().content_brand_selections(user["user_id"], project_id)
            job_id = str(data.get("job_id", "")).strip()[:100]
            if not job_id:
                job_id = f"render-{time.time_ns()}"
            scene_total = len(timeline_from_data(content_data))
            update_render_progress(job_id, status="queued", progress=0.0, rendered_seconds=0.0, completed_scenes=0, scene_total=scene_total, detail="변환 작업을 준비하고 있습니다.")
            explicit_render_settings = {
                key: data[key] for key in RENDER_SETTING_KEYS if key in data
            }
            render_settings = resolve_render_settings(user["user_id"], explicit_render_settings)
            style = render_settings["type"]
            music = render_settings["music"]
            raw_crop_positions = data.get("scene_crop_positions") or get_auth_store().scene_crop_positions(user['user_id'], project_id)
            scene_crop_positions = {}
            if isinstance(raw_crop_positions, dict):
                for scene_id, formats in list(raw_crop_positions.items())[:200]:
                    if not isinstance(formats, dict):
                        continue
                    scene_crop_positions[str(scene_id)[:100]] = {
                        output_format: max(0.0, min(1.0, float(formats.get(output_format, 50)) / 100))
                        for output_format in ("9x16", "4x5")
                    }
            config = {
                "type": style,
                "music": music,
                "volume": render_settings["volume"],
                "narration": render_settings["narration"],
                "caption_size": render_settings["caption_size"],
                "video_pan_x": render_settings["video_pan_x"],
                "scene_crop_positions": scene_crop_positions,
                "preview_platform": render_settings["preview_platform"],
                "platforms": render_settings["platforms"],
                "scene_dissolve_seconds": render_settings["scene_dissolve_seconds"],
                "scene_videos": selected_videos,
                "scene_images": {item["scene_id"]: item for item in selected_images},
                "voice_clips": voice_clips,
                "content_data": content_data,
                "brand_selections": brand_selections,
            }
            if config["preview_platform"] not in PLATFORM_FORMATS:
                raise ValueError("미리보기 플랫폼 설정이 올바르지 않습니다.")
            started_at = time.monotonic()
            requested_platforms = data.get("platforms")
            if requested_platforms is None:
                requested_platforms = config["platforms"]
            if not isinstance(requested_platforms, list):
                raise ValueError("플랫폼 선택 정보가 올바르지 않습니다.")
            platforms = list(dict.fromkeys(str(item) for item in requested_platforms))
            if not platforms or any(item not in PLATFORM_FORMATS for item in platforms):
                raise ValueError("출력할 플랫폼을 한 개 이상 선택해 주세요.")
            format_groups = group_platform_formats(platforms)
            current_demo_data = content_data
            caption_count = len(timed_script_scenes(current_demo_data))
            prepared_overlays = {}
            for format_index, format_group in enumerate(format_groups):
                platform = format_group["render_platform"]
                platform_config = {
                    **config,
                    "preview_platform": platform,
                    "caption_progress_offset": format_index * caption_count,
                    "caption_progress_total": len(format_groups) * caption_count,
                }
                width, height, _ = PLATFORM_FORMATS[platform]
                prepared_overlays[platform] = prepare_caption_overlays(platform_config, job_id, width, height, current_demo_data)
                temporary_caption_roots.update(path.parent for path, _, _ in prepared_overlays[platform])
            expected_caption_total = len(format_groups) * caption_count
            validate_caption_overlays(prepared_overlays, expected_caption_total)
            update_render_progress(
                job_id, status="running", phase="caption_ready",
                completed_captions=expected_caption_total, caption_total=expected_caption_total,
                detail=f"자막 PNG {expected_caption_total:02d}개 검증 완료 · FFmpeg 합성을 준비합니다.",
            )
            rendered_outputs = []
            artifacts = []
            for format_index, format_group in enumerate(format_groups):
                platform = format_group["render_platform"]
                width, height, format_label = PLATFORM_FORMATS[platform]
                platform_config = {
                    **config,
                    "preview_platform": platform,
                    "prepared_caption_overlays": prepared_overlays[platform],
                    "format_id": format_label.replace("x", ":"),
                    "format_index": format_index + 1,
                    "format_total": len(format_groups),
                }
                rendered = render_video(platform_config, job_id)
                artifact_uri = "/" + quote(f"04_exports/{rendered['filename']}")
                rendered_outputs.append({
                    "platform": platform,
                    "platforms": format_group["platforms"],
                    "filename": rendered["filename"],
                    "url": artifact_uri,
                    "width": rendered["width"],
                    "height": rendered["height"],
                    "aspect_ratio": format_label.replace("x", ":"),
                    "created_at": datetime.fromtimestamp(
                        rendered["path"].stat().st_mtime, timezone.utc
                    ).isoformat(),
                })
                artifacts.append({
                    "name": rendered["filename"],
                    "uri": artifact_uri,
                    "media_type": "video/mp4",
                    "checksum": f"sha256:{sha256_file(rendered['path'])}",
                    "metadata": {
                        "platforms": format_group["platforms"],
                        "duration": rendered["duration"],
                        "width": rendered["width"],
                        "height": rendered["height"],
                        "scene_count": rendered["scene_count"],
                        "video_codec": "h264",
                        "audio_codec": "aac",
                        "brand_assets": [
                            {"role": item["role"], "version_id": item.get("version_id"),
                             "settings": item.get("settings") or {}}
                            for item in brand_selections if item.get("enabled")
                        ],
                    },
                })
            for output, artifact in zip(rendered_outputs, artifacts):
                completed_at = datetime.fromisoformat(output["created_at"])
                local_date = completed_at.astimezone(timezone(timedelta(hours=9))).date().isoformat()
                registered = get_auth_store().register_final_export(
                    user["user_id"], project_id, latest["revision_id"],
                    artifact["uri"], artifact["checksum"], {
                        **artifact["metadata"],
                        "filename": artifact["name"],
                        "job_id": job_id,
                        "aspect_ratio": output["aspect_ratio"],
                    }, local_date, output["platforms"], output["created_at"],
                )
                output["artifact_id"] = registered["artifact_id"]
                artifact["artifact_id"] = registered["artifact_id"]
                get_auth_store().snapshot_final_export_brand_assets(
                    registered["artifact_id"], brand_selections
                )
            latest_completed_at = max(output["created_at"] for output in rendered_outputs)
            latest_local_date = datetime.fromisoformat(latest_completed_at).astimezone(
                timezone(timedelta(hours=9))
            ).date().isoformat()
            get_auth_store().consolidate_production_calendar(
                user["user_id"], project_id, latest_local_date, latest_completed_at
            )
            primary = rendered_outputs[0]
            result = {
                "schema_version": "1.0.0",
                "job_id": job_id,
                "stage": "format_optimize",
                "status": "succeeded",
                "artifacts": artifacts,
                "metrics": {"provider": "ffmpeg", "latency_ms": round((time.monotonic() - started_at) * 1000), "cost_usd": 0},
                "error": None,
            }
            response_payload = {"ok": True, "job_id": job_id, "filename": primary["filename"], "url": primary["url"], "exports": rendered_outputs, "result": result}
            update_render_progress(job_id, status="succeeded", progress=1.0, response=response_payload, detail="모든 출력 규격의 최종 MP4 합성이 완료됐습니다.")
            try:
                self.send_json(200, response_payload)
            except (BrokenPipeError, ConnectionResetError):
                pass
        except Exception as exc:
            update_render_progress(job_id, status="failed", detail=str(exc))
            self.send_json(500, {"error": str(exc)})
        finally:
            try:
                clean_caption_artifacts(temporary_caption_roots)
            finally:
                render_lock.release()


if __name__ == "__main__":
    os.chdir(ROOT)
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    local_url = f"http://127.0.0.1:{PORT}/01_app/P1_title_design_preview.html"
    network_url = f"http://{get_lan_ip()}:{PORT}/01_app/P1_title_design_preview.html"
    print(f"이 PC에서 열기: {local_url}")
    print(f"다른 PC/갤럭시에서 열기: {network_url}")
    print("두 기기가 같은 Wi-Fi에 연결되어 있어야 합니다.")
    print("창을 닫거나 Ctrl+C를 누르면 종료됩니다.")
    if os.environ.get("P1_NO_BROWSER") != "1":
        threading.Timer(0.7, lambda: webbrowser.open(local_url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
