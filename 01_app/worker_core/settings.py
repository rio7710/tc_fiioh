"""Validated runtime settings for the worker and automation runner."""

from __future__ import annotations

import os
import math
from dataclasses import dataclass
from typing import Mapping


class ConfigurationError(ValueError):
    """Raised when an operational environment value is unsafe to use."""


def _raw(environ: Mapping[str, str], name: str) -> str | None:
    value = environ.get(name)
    return value.strip() if value is not None else None


def _number(environ: Mapping[str, str], name: str, default: float, *, minimum: float, integer: bool = False) -> float | int:
    raw = _raw(environ, name)
    if raw in (None, ""):
        return int(default) if integer else default
    try:
        value = int(raw) if integer else float(raw)
    except ValueError as exc:
        raise ConfigurationError(f"{name} must be a number, got {raw!r}") from exc
    if isinstance(value, float) and not math.isfinite(value):
        raise ConfigurationError(f"{name} must be finite, got {raw!r}")
    if value < minimum:
        raise ConfigurationError(f"{name} must be >= {minimum}, got {value}")
    return value


def _bounded_float(environ: Mapping[str, str], name: str, default: float) -> float:
    value = float(_number(environ, name, default, minimum=0.0))
    if value > 1.0:
        raise ConfigurationError(f"{name} must be between 0 and 1, got {value}")
    return value


def _text(environ: Mapping[str, str], name: str, default: str) -> str:
    value = _raw(environ, name)
    return value if value else default


@dataclass(frozen=True)
class WorkerRuntimeSettings:
    heartbeat_interval_seconds: float = 15.0
    idle_poll_seconds: float = 5.0
    api_timeout_seconds: float = 7200.0
    api_retry_count: int = 3
    api_retry_backoff_seconds: float = 2.0
    automation_heartbeat_interval_seconds: float = 15.0
    i2v_poll_interval_seconds: float = 5.0
    i2v_timeout_seconds: float = 3600.0
    job_lease_seconds: float = 300.0
    render_type: str = "editorial"
    render_music: str = "satie"
    render_volume: float = 0.5
    render_pan_x: float = 0.5

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> "WorkerRuntimeSettings":
        source = os.environ if environ is None else environ
        return cls(
            heartbeat_interval_seconds=float(_number(source, "WORKER_HEARTBEAT_INTERVAL_SECONDS", 15.0, minimum=0.1)),
            idle_poll_seconds=float(_number(source, "WORKER_IDLE_POLL_SECONDS", 5.0, minimum=0.1)),
            api_timeout_seconds=float(_number(source, "AUTOMATION_API_TIMEOUT_SECONDS", 7200.0, minimum=0.1)),
            api_retry_count=int(_number(source, "AUTOMATION_API_RETRY_COUNT", 3, minimum=1, integer=True)),
            api_retry_backoff_seconds=float(_number(source, "AUTOMATION_API_RETRY_BACKOFF_SECONDS", 2.0, minimum=0.0)),
            automation_heartbeat_interval_seconds=float(_number(source, "AUTOMATION_HEARTBEAT_INTERVAL_SECONDS", 15.0, minimum=0.1)),
            i2v_poll_interval_seconds=float(_number(source, "AUTOMATION_I2V_POLL_INTERVAL_SECONDS", 5.0, minimum=0.1)),
            i2v_timeout_seconds=float(_number(source, "AUTOMATION_I2V_TIMEOUT_SECONDS", 3600.0, minimum=0.1)),
            job_lease_seconds=float(_number(source, "WORKER_JOB_LEASE_SECONDS", 300.0, minimum=0.1)),
            render_type=_text(source, "AUTOMATION_RENDER_TYPE", "editorial"),
            render_music=_text(source, "AUTOMATION_RENDER_MUSIC", "satie"),
            render_volume=_bounded_float(source, "AUTOMATION_RENDER_VOLUME", 0.5),
            render_pan_x=_bounded_float(source, "AUTOMATION_RENDER_PAN_X", 0.5),
        )
