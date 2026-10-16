"""Dedicated process for durable final-export jobs.

Integration contract: ``render_server.execute_render_request`` must accept
``(user_id: str, payload: dict, progress_callback: callable)`` and return the
same JSON object formerly returned by ``POST /render``. The callable performs
validation, staged FFmpeg composition, artifact registration and calendar
consolidation. It must not start an HTTP server when imported.
"""

from __future__ import annotations

import importlib
import inspect
import logging
import os
import signal
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Callable, Mapping

from final_export_cancellation import QueueCancellationProbe
from final_export_errors import RetryableFinalExportError, classify_final_export_error, public_error
from final_export_queue import FinalExportConflict, FinalExportQueue
from final_export_progress import ProgressThrottle


DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
QUEUE_PATH = Path(os.environ.get("FINAL_EXPORT_QUEUE_PATH", os.environ.get("SQLITE_PATH", str(DATA_DIR / "tc.sqlite"))))
LOGGER = logging.getLogger("final_export_worker")


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
    shutdown_requested: Callable[[], bool] = lambda: False,
) -> dict | None:
    if shutdown_requested():
        return None
    job = queue.claim(worker_id, lease_seconds=lease_seconds)
    if job is None:
        return None
    if job.get("cancel_requested_at"):
        return queue.finish_cancel(job["job_id"], worker_id)
    stopped = threading.Event()

    def heartbeat():
        while not stopped.wait(heartbeat_seconds):
            try:
                queue.heartbeat(job["job_id"], worker_id, lease_seconds=lease_seconds)
            except FinalExportConflict:
                return

    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()

    def persist_progress(value):
        queue.update_progress(job["job_id"], worker_id, value)

    progress_callback = ProgressThrottle(persist_progress)

    try:
        keywords = {"progress_callback": progress_callback}
        if "cancel_callback" in inspect.signature(executor).parameters:
            keywords["cancel_callback"] = QueueCancellationProbe(
                lambda: shutdown_requested() or bool(
                    queue.get(job["job_id"]).get("cancel_requested_at")
                )
            )
        if "finalize_callback" in inspect.signature(executor).parameters:
            keywords["finalize_callback"] = lambda: queue.begin_finalize(job["job_id"], worker_id)
        result = executor(job["user_id"], dict(job["payload"]), **keywords)
        if not isinstance(result, Mapping):
            raise TypeError("execute_render_request must return a JSON object")
        return queue.succeed(job["job_id"], worker_id, dict(result))
    except Exception as exc:
        current = queue.get(job["job_id"])
        if current["status"] == "cancelled":
            return current
        if current.get("cancel_requested_at"):
            return queue.finish_cancel(job["job_id"], worker_id)
        failure = classify_final_export_error(
            RetryableFinalExportError("worker shutdown") if shutdown_requested() else exc
        )
        stage = str((current.get("progress") or {}).get("phase") or "executor")
        error = public_error(
            failure,
            job_id=job["job_id"],
            stage=stage,
            attempt=int(current.get("attempt") or job.get("attempt") or 1),
        )
        LOGGER.exception(
            "final export failed job_id=%s stage=%s attempt=%s category=%s",
            job["job_id"], stage, error["attempt"], failure.category,
        )
        try:
            return queue.fail(
                job["job_id"], worker_id,
                error,
                retryable=failure.retryable,
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
    shutdown_requested = threading.Event()

    def request_shutdown(_signum, _frame):
        shutdown_requested.set()

    signal.signal(signal.SIGTERM, request_shutdown)
    signal.signal(signal.SIGINT, request_shutdown)
    print(f"[final_export_worker] started worker_id={worker_id}")
    while not shutdown_requested.is_set():
        try:
            executed = execute_once(
                queue, executor, worker_id,
                lease_seconds=lease_seconds, heartbeat_seconds=heartbeat_seconds,
                shutdown_requested=shutdown_requested.is_set,
            )
        except Exception as exc:
            print(f"[final_export_worker] queue error: {type(exc).__name__}", file=sys.stderr)
            executed = None
        if executed is None:
            shutdown_requested.wait(poll_seconds)


if __name__ == "__main__":
    main()
