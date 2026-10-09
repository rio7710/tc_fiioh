"""Dedicated process for durable final-export jobs.

Integration contract: ``render_server.execute_render_request`` must accept
``(user_id: str, payload: dict, progress_callback: callable)`` and return the
same JSON object formerly returned by ``POST /render``. The callable performs
validation, staged FFmpeg composition, artifact registration and calendar
consolidation. It must not start an HTTP server when imported.
"""

from __future__ import annotations

import importlib
import os
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Callable, Mapping

from final_export_queue import FinalExportConflict, FinalExportQueue


DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
QUEUE_PATH = Path(os.environ.get("FINAL_EXPORT_QUEUE_PATH", os.environ.get("SQLITE_PATH", str(DATA_DIR / "tc.sqlite"))))


class RetryableFinalExportError(RuntimeError):
    """Executor failure that may safely run again within the attempt bound."""


def _positive_number(name: str, default: float) -> float:
    raw = os.environ.get(name, str(default))
    try:
        value = float(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a number") from exc
    if value <= 0:
        raise RuntimeError(f"{name} must be positive")
    return value


def load_executor() -> Callable:
    module = importlib.import_module("render_server")
    executor = getattr(module, "execute_render_request", None)
    if not callable(executor):
        raise RuntimeError(
            "render_server.execute_render_request(user_id, payload, progress_callback=...) is required"
        )
    return executor


def execute_once(
    queue: FinalExportQueue,
    executor: Callable,
    worker_id: str,
    *,
    lease_seconds: float = 300,
    heartbeat_seconds: float = 30,
) -> dict | None:
    job = queue.claim(worker_id, lease_seconds=lease_seconds)
    if job is None:
        return None
    stopped = threading.Event()

    def heartbeat():
        while not stopped.wait(heartbeat_seconds):
            try:
                queue.heartbeat(job["job_id"], worker_id, lease_seconds=lease_seconds)
            except FinalExportConflict:
                return

    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()

    def progress_callback(progress=None, **changes):
        value = dict(progress) if isinstance(progress, Mapping) else {}
        value.update(changes)
        queue.update_progress(job["job_id"], worker_id, value)

    try:
        result = executor(job["user_id"], dict(job["payload"]), progress_callback=progress_callback)
        if not isinstance(result, Mapping):
            raise TypeError("execute_render_request must return a JSON object")
        return queue.succeed(job["job_id"], worker_id, dict(result))
    except Exception as exc:
        current = queue.get(job["job_id"])
        if current["status"] == "cancelled":
            return current
        retryable = isinstance(exc, RetryableFinalExportError)
        try:
            return queue.fail(
                job["job_id"], worker_id,
                {"code": type(exc).__name__, "message": "최종 영상 워커 실행에 실패했습니다."},
                retryable=retryable,
            )
        except FinalExportConflict:
            return queue.get(job["job_id"])
    finally:
        stopped.set()
        thread.join(timeout=min(heartbeat_seconds, 2))


def main() -> None:
    queue = FinalExportQueue(QUEUE_PATH)
    executor = load_executor()
    worker_id = os.environ.get("FINAL_EXPORT_WORKER_ID") or "final-export-" + str(uuid.uuid4())
    lease_seconds = _positive_number("FINAL_EXPORT_LEASE_SECONDS", 300)
    heartbeat_seconds = _positive_number("FINAL_EXPORT_HEARTBEAT_SECONDS", 30)
    poll_seconds = _positive_number("FINAL_EXPORT_POLL_SECONDS", 2)
    print(f"[final_export_worker] started worker_id={worker_id}")
    while True:
        try:
            executed = execute_once(
                queue, executor, worker_id,
                lease_seconds=lease_seconds, heartbeat_seconds=heartbeat_seconds,
            )
        except Exception as exc:
            print(f"[final_export_worker] queue error: {type(exc).__name__}", file=sys.stderr)
            executed = None
        if executed is None:
            time.sleep(poll_seconds)


if __name__ == "__main__":
    main()
