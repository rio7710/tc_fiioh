"""Safe, structured error contract for final-export jobs."""

from __future__ import annotations

import sqlite3
import subprocess
from dataclasses import dataclass
from typing import Any, Mapping


@dataclass(frozen=True)
class FinalExportFailure:
    code: str
    category: str
    message: str
    retryable: bool


class RetryableFinalExportError(RuntimeError):
    """Executor failure that may safely run again within the attempt bound."""


def classify_final_export_error(exc: Exception) -> FinalExportFailure:
    if isinstance(exc, RetryableFinalExportError):
        return FinalExportFailure(
            "transient_io", "transient_io", "일시적인 처리 오류가 발생했습니다.", True,
        )
    if isinstance(exc, (FileNotFoundError, ValueError)):
        category = "asset_missing" if isinstance(exc, FileNotFoundError) else "input_invalid"
        message = "필수 제작 자산을 찾을 수 없습니다." if category == "asset_missing" else "최종 영상 입력값이 올바르지 않습니다."
        return FinalExportFailure(category, category, message, False)
    if isinstance(exc, sqlite3.OperationalError) and "lock" in str(exc).lower():
        return FinalExportFailure(
            "storage_busy", "transient_io", "저장소가 사용 중입니다. 잠시 후 다시 시도합니다.", True,
        )
    if isinstance(exc, (TimeoutError, subprocess.TimeoutExpired)):
        return FinalExportFailure("render_timeout", "timeout", "최종 영상 처리 시간이 초과되었습니다.", True)
    return FinalExportFailure(
        "final_export_failed", "internal", "최종 영상 워커 실행에 실패했습니다.", False,
    )


def public_error(
    failure: FinalExportFailure,
    *,
    job_id: str,
    stage: str,
    attempt: int,
) -> dict[str, Any]:
    return {
        "code": failure.code,
        "category": failure.category,
        "message": failure.message,
        "retryable": failure.retryable,
        "stage": str(stage or "unknown")[:100],
        "attempt": max(1, int(attempt)),
        "job_id": str(job_id)[:200],
    }


def sanitize_public_error(error: Mapping[str, Any], *, retryable: bool) -> dict[str, Any]:
    categories = {"input_invalid", "asset_missing", "transient_io", "ffmpeg_failed", "timeout", "internal"}
    category = str(error.get("category") or "internal")
    if category not in categories:
        category = "internal"
    return {
        "code": str(error.get("code") or "final_export_failed")[:100],
        "category": category,
        "message": str(error.get("message") or "최종 영상 제작에 실패했습니다.")[:500],
        "retryable": bool(retryable),
        "stage": str(error.get("stage") or "unknown")[:100],
        "attempt": max(1, int(error.get("attempt") or 1)),
        "job_id": str(error.get("job_id") or "")[:200],
    }
