"""Persistent job state and idempotency primitives for independent workers."""

from __future__ import annotations

import copy
import fcntl
import hashlib
import json
import os
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator, Mapping


SCHEMA_VERSION = "1.0.0"
STATUSES = ("queued", "running", "succeeded", "failed", "cancelled", "stale")
TERMINAL_STATUSES = ("succeeded", "cancelled")
RETRYABLE_STATUSES = ("failed", "stale")
_TRANSITIONS = {
    "queued": {"running", "cancelled"},
    "running": {"succeeded", "failed", "cancelled", "stale"},
    "failed": {"queued"},
    "stale": {"queued"},
    "succeeded": set(),
    "cancelled": set(),
}


class JobError(RuntimeError):
    """Base class for job-store errors."""


class JobConflict(JobError):
    """Raised when a requested operation would violate job ownership/state."""


class JobNotFound(JobError):
    """Raised when a job ID is not in the persisted store."""


class JobValidationError(JobError, ValueError):
    """Raised when a job field or JSON payload is invalid."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _timestamp(value: datetime | str | None = None) -> str:
    if value is None:
        value = _now()
    if isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    else:
        parsed = value
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat(timespec="seconds")


def _instant(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def compute_input_hash(value: Mapping[str, Any]) -> str:
    """Return a stable SHA-256 hash for a JSON object."""
    try:
        encoded = json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise JobValidationError("input must be JSON-serializable") from exc
    return hashlib.sha256(encoded).hexdigest()


def _json_copy(value: Any, label: str) -> Any:
    try:
        return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))
    except (TypeError, ValueError) as exc:
        raise JobValidationError(f"{label} must be JSON-serializable") from exc


class JobStore:
    """A small atomic JSON job store suitable for a worker process.

    The uniqueness key is ``project_id + stage + input_hash``. Every mutation
    writes a complete document to a sibling temporary file and atomically
    replaces the target, so a restart observes either the old or new snapshot.
    """

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self._lock = threading.RLock()
        self._lock_path = self.path.with_name(f".{self.path.name}.lock")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._guard():
            if not self.path.exists():
                self._write({"schema_version": SCHEMA_VERSION, "jobs": {}})

    @contextmanager
    def _guard(self) -> Iterator[None]:
        """Serialize mutations across threads and independent worker processes."""
        with self._lock:
            with self._lock_path.open("a+", encoding="utf-8") as lock_file:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)

    def _read(self) -> dict[str, Any]:
        try:
            document = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise JobError(f"cannot read job store: {self.path}") from exc
        if document.get("schema_version") != SCHEMA_VERSION or not isinstance(document.get("jobs"), dict):
            raise JobError("unsupported or invalid job store schema")
        return document

    def _write(self, document: dict[str, Any]) -> None:
        temporary = self.path.with_name(f".{self.path.name}.{uuid.uuid4().hex}.tmp")
        temporary.write_text(
            json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, self.path)

    def _job(self, document: dict[str, Any], job_id: str) -> dict[str, Any]:
        job = document["jobs"].get(job_id)
        if job is None:
            raise JobNotFound(job_id)
        return job

    @staticmethod
    def _copy_job(job: Mapping[str, Any]) -> dict[str, Any]:
        return copy.deepcopy(dict(job))

    def create(
        self,
        project_id: str,
        stage: str,
        input: Mapping[str, Any],
        *,
        trace_id: str | None = None,
        parent_job_id: str | None = None,
        now: datetime | str | None = None,
    ) -> dict[str, Any]:
        if not project_id or not isinstance(project_id, str):
            raise JobValidationError("project_id must be a non-empty string")
        if not stage or not isinstance(stage, str):
            raise JobValidationError("stage must be a non-empty string")
        if not isinstance(input, Mapping):
            raise JobValidationError("input must be an object")
        input_copy = _json_copy(dict(input), "input")
        input_hash = compute_input_hash(input_copy)
        unique_key = f"{project_id}:{stage}:{input_hash}"
        created_at = _timestamp(now)
        job = {
            "schema_version": SCHEMA_VERSION,
            "job_id": str(uuid.uuid4()),
            "project_id": project_id,
            "stage": stage,
            "status": "queued",
            "attempt": 1,
            "idempotency_key": unique_key,
            "input_hash": input_hash,
            "input": input_copy,
            "trace": {
                "trace_id": trace_id or str(uuid.uuid4()),
                "parent_job_id": parent_job_id,
                "created_at": created_at,
            },
            "created_at": created_at,
            "updated_at": created_at,
            "lease_expires_at": None,
            "worker_id": None,
            "result": None,
            "error": None,
        }
        with self._guard():
            document = self._read()
            for existing in document["jobs"].values():
                if existing["idempotency_key"] == unique_key:
                    return self._copy_job(existing)
            document["jobs"][job["job_id"]] = job
            self._write(document)
        return self._copy_job(job)

    def get(self, job_id: str) -> dict[str, Any]:
        with self._guard():
            return self._copy_job(self._job(self._read(), job_id))

    def list(self, *, status: str | None = None) -> list[dict[str, Any]]:
        if status is not None and status not in STATUSES:
            raise JobValidationError(f"unknown status: {status}")
        with self._guard():
            jobs = self._read()["jobs"].values()
            return [self._copy_job(job) for job in jobs if status is None or job["status"] == status]

    def claim(
        self,
        job_id: str,
        worker_id: str,
        *,
        lease_seconds: int = 300,
        now: datetime | str | None = None,
    ) -> dict[str, Any]:
        if not worker_id:
            raise JobValidationError("worker_id must be a non-empty string")
        if lease_seconds <= 0:
            raise JobValidationError("lease_seconds must be positive")
        current = _timestamp(now)
        expires = _timestamp(_instant(current) + timedelta(seconds=lease_seconds))
        with self._guard():
            document = self._read()
            job = self._job(document, job_id)
            if job["status"] != "queued":
                raise JobConflict(f"job {job_id} is {job['status']}, not queued")
            job.update(
                status="running",
                updated_at=current,
                lease_expires_at=expires,
                worker_id=worker_id,
            )
            self._write(document)
            return self._copy_job(job)

    def transition(
        self,
        job_id: str,
        status: str,
        *,
        result: Mapping[str, Any] | None = None,
        error: Mapping[str, Any] | None = None,
        now: datetime | str | None = None,
    ) -> dict[str, Any]:
        if status not in STATUSES:
            raise JobValidationError(f"unknown status: {status}")
        result_copy = _json_copy(dict(result), "result") if result is not None else None
        error_copy = _json_copy(dict(error), "error") if error is not None else None
        current = _timestamp(now)
        with self._guard():
            document = self._read()
            job = self._job(document, job_id)
            old_status = job["status"]
            if status not in _TRANSITIONS[old_status]:
                raise JobConflict(f"invalid transition {old_status} -> {status}")
            if status == "succeeded" and result_copy is None:
                raise JobValidationError("succeeded jobs require a result")
            if status == "failed" and error_copy is None:
                raise JobValidationError("failed jobs require an error")
            job.update(status=status, updated_at=current, result=result_copy, error=error_copy)
            if status in TERMINAL_STATUSES or status == "stale":
                job["lease_expires_at"] = None
            self._write(document)
            return self._copy_job(job)

    def retry(self, job_id: str, *, now: datetime | str | None = None) -> dict[str, Any]:
        current = _timestamp(now)
        with self._guard():
            document = self._read()
            job = self._job(document, job_id)
            if job["status"] not in RETRYABLE_STATUSES:
                raise JobConflict(f"job {job_id} is not retryable from {job['status']}")
            job.update(
                status="queued",
                attempt=job["attempt"] + 1,
                updated_at=current,
                lease_expires_at=None,
                worker_id=None,
                result=None,
                error=None,
            )
            self._write(document)
            return self._copy_job(job)

    def recover_stale(self, *, now: datetime | str | None = None) -> list[dict[str, Any]]:
        current = _timestamp(now)
        recovered = []
        with self._guard():
            document = self._read()
            for job in document["jobs"].values():
                expires = job.get("lease_expires_at")
                if job["status"] == "running" and expires and _instant(expires) <= _instant(current):
                    job.update(
                        status="stale",
                        updated_at=current,
                        lease_expires_at=None,
                        worker_id=None,
                        error={"code": "lease_expired", "message": "worker lease expired"},
                    )
                    recovered.append(self._copy_job(job))
            if recovered:
                self._write(document)
        return recovered

    def dispatch(
        self,
        project_id: str,
        stage: str,
        input: Mapping[str, Any],
        adapter: Any,
        *,
        worker_id: str,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        """Create or resume one logical job, then execute it at most once per claim.

        A failed or recovered-stale job is retried with the same idempotency key.
        An already-running job is never claimed by a second dispatcher.
        """
        job = self.create(project_id, stage, input, trace_id=trace_id)
        if job["status"] in RETRYABLE_STATUSES:
            job = self.retry(job["job_id"])
        if job["status"] == "succeeded":
            return job
        if job["status"] == "cancelled":
            raise JobConflict(f"job {job['job_id']} was cancelled")
        if job["status"] == "running":
            raise JobConflict(f"job {job['job_id']} is already running")
        return self.execute(job["job_id"], worker_id, adapter)

    def execute(self, job_id: str, worker_id: str, adapter: Any, *, lease_seconds: int = 300) -> dict[str, Any]:
        """Claim, execute through an adapter, and persist the terminal state."""
        job = self.claim(job_id, worker_id, lease_seconds=lease_seconds)
        try:
            result = adapter.run(self._copy_job(job))
            if not isinstance(result, Mapping):
                raise JobValidationError("adapter result must be an object")
        except InterruptedError:
            return self.transition(
                job_id,
                "cancelled",
                error={"code": "cancelled", "message": "작업이 취소되었습니다."},
            )
        except Exception as exc:
            safe_message = (
                str(exc)
                if isinstance(exc, JobValidationError)
                else "작업 실행을 완료하지 못했습니다. 결과를 확인한 뒤 다시 시도해 주세요."
            )
            return self.transition(
                job_id,
                "failed",
                error={"code": type(exc).__name__, "message": safe_message},
            )
        return self.transition(job_id, "succeeded", result=result)
