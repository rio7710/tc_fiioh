"""Durable SQLite queue shared by the API and isolated final-export worker.

The API may enqueue and read status through :class:`FinalExportQueue`; only a
worker that owns the active lease may publish progress or a terminal result.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping


STATUSES = ("queued", "running", "succeeded", "failed", "cancelled")


class FinalExportQueueError(RuntimeError):
    pass


class FinalExportConflict(FinalExportQueueError):
    pass


class FinalExportNotFound(FinalExportQueueError):
    pass


def _timestamp(value: datetime | str | None = None) -> str:
    if value is None:
        value = datetime.now(timezone.utc)
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat(timespec="seconds")


def _instant(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _json(value: Any, label: str) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be JSON-serializable") from exc


class FinalExportQueue:
    """SQLite-backed final-export jobs with leases and bounded recovery."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=30000")
        return connection

    def _initialize(self):
        with closing(self._connect()) as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS final_export_jobs (
                    job_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    project_id TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
                    attempt INTEGER NOT NULL CHECK(attempt >= 1),
                    max_attempts INTEGER NOT NULL CHECK(max_attempts >= 1),
                    payload_hash TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    result_json TEXT,
                    error_json TEXT,
                    progress_json TEXT NOT NULL,
                    lease_owner TEXT,
                    lease_until TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            db.execute("CREATE INDEX IF NOT EXISTS final_export_jobs_claim ON final_export_jobs(status, created_at)")
            db.commit()

    @staticmethod
    def _row(row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        item = dict(row)
        for source, target in (
            ("payload_json", "payload"), ("result_json", "result"),
            ("error_json", "error"), ("progress_json", "progress"),
        ):
            raw = item.pop(source)
            item[target] = json.loads(raw) if raw is not None else None
        return item

    def enqueue(
        self, job_id: str, user_id: str, payload: Mapping[str, Any], *,
        project_id: str | None = None, max_attempts: int = 3,
        now: datetime | str | None = None,
    ) -> dict[str, Any]:
        if not isinstance(job_id, str) or len(job_id.strip()) < 8:
            raise ValueError("job_id must contain at least 8 characters")
        if not isinstance(user_id, str) or not user_id.strip():
            raise ValueError("user_id is required")
        if not isinstance(payload, Mapping):
            raise ValueError("payload must be an object")
        payload_copy = dict(payload)
        resolved_project = str(project_id or payload_copy.get("project_id") or "").strip()
        if not resolved_project:
            raise ValueError("project_id is required")
        if isinstance(max_attempts, bool) or not isinstance(max_attempts, int) or max_attempts < 1:
            raise ValueError("max_attempts must be a positive integer")
        payload_json = _json(payload_copy, "payload")
        payload_hash = hashlib.sha256(payload_json.encode("utf-8")).hexdigest()
        stamp = _timestamp(now)
        progress_json = _json({"phase": "queued", "progress": 0.0}, "progress")
        with closing(self._connect()) as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT * FROM final_export_jobs WHERE job_id=?", (job_id,)).fetchone()
            if existing:
                if (
                    existing["user_id"] != user_id or existing["project_id"] != resolved_project
                    or existing["payload_hash"] != payload_hash
                ):
                    db.rollback()
                    raise FinalExportConflict("job_id already belongs to a different final-export request")
                db.commit()
                return self._row(existing)
            db.execute(
                """INSERT INTO final_export_jobs
                   (job_id,user_id,project_id,status,attempt,max_attempts,payload_hash,payload_json,
                    result_json,error_json,progress_json,lease_owner,lease_until,created_at,updated_at)
                   VALUES(?,?,?,'queued',1,?,?,?,NULL,NULL,?,NULL,NULL,?,?)""",
                (job_id, user_id, resolved_project, max_attempts, payload_hash, payload_json,
                 progress_json, stamp, stamp),
            )
            row = db.execute("SELECT * FROM final_export_jobs WHERE job_id=?", (job_id,)).fetchone()
            db.commit()
            return self._row(row)

    def get(self, job_id: str, *, user_id: str | None = None) -> dict[str, Any]:
        with closing(self._connect()) as db:
            if user_id is None:
                row = db.execute("SELECT * FROM final_export_jobs WHERE job_id=?", (job_id,)).fetchone()
            else:
                row = db.execute("SELECT * FROM final_export_jobs WHERE job_id=? AND user_id=?", (job_id, user_id)).fetchone()
        if row is None:
            raise FinalExportNotFound(job_id)
        return self._row(row)

    def recover_expired(self, *, now: datetime | str | None = None) -> list[dict[str, Any]]:
        stamp = _timestamp(now)
        recovered: list[dict[str, Any]] = []
        with closing(self._connect()) as db:
            db.execute("BEGIN IMMEDIATE")
            rows = db.execute(
                "SELECT * FROM final_export_jobs WHERE status='running' AND lease_until IS NOT NULL AND lease_until<=?",
                (stamp,),
            ).fetchall()
            for row in rows:
                exhausted = row["attempt"] >= row["max_attempts"]
                status = "failed" if exhausted else "queued"
                attempt = row["attempt"] if exhausted else row["attempt"] + 1
                error = {
                    "code": "lease_expired",
                    "message": "최종 영상 워커의 실행 임대가 만료되었습니다.",
                    "retryable": not exhausted,
                }
                db.execute(
                    """UPDATE final_export_jobs SET status=?,attempt=?,error_json=?,lease_owner=NULL,
                       lease_until=NULL,updated_at=? WHERE job_id=? AND status='running'""",
                    (status, attempt, _json(error, "error"), stamp, row["job_id"]),
                )
                updated = db.execute(
                    "SELECT * FROM final_export_jobs WHERE job_id=?", (row["job_id"],)
                ).fetchone()
                recovered.append(self._row(updated))
            db.commit()
        return recovered

    def claim(self, worker_id: str, *, lease_seconds: float = 300, now: datetime | str | None = None) -> dict[str, Any] | None:
        if not worker_id:
            raise ValueError("worker_id is required")
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive")
        stamp = _timestamp(now)
        lease_until = _timestamp(_instant(stamp) + timedelta(seconds=lease_seconds))
        self.recover_expired(now=stamp)
        with closing(self._connect()) as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT job_id FROM final_export_jobs WHERE status='queued' ORDER BY created_at,job_id LIMIT 1"
            ).fetchone()
            if row is None:
                db.commit()
                return None
            updated = db.execute(
                """UPDATE final_export_jobs SET status='running',lease_owner=?,lease_until=?,updated_at=?
                   WHERE job_id=? AND status='queued'""",
                (worker_id, lease_until, stamp, row["job_id"]),
            ).rowcount
            if updated != 1:
                db.rollback()
                return None
            claimed = db.execute("SELECT * FROM final_export_jobs WHERE job_id=?", (row["job_id"],)).fetchone()
            db.commit()
            return self._row(claimed)

    def _owned(self, db, job_id: str, worker_id: str):
        row = db.execute("SELECT * FROM final_export_jobs WHERE job_id=?", (job_id,)).fetchone()
        if row is None:
            raise FinalExportNotFound(job_id)
        if row["status"] != "running" or row["lease_owner"] != worker_id:
            raise FinalExportConflict("worker does not own the running final-export job")
        return row

    def heartbeat(self, job_id: str, worker_id: str, *, lease_seconds: float = 300, now: datetime | str | None = None) -> dict[str, Any]:
        stamp = _timestamp(now)
        lease_until = _timestamp(_instant(stamp) + timedelta(seconds=lease_seconds))
        with closing(self._connect()) as db:
            db.execute("BEGIN IMMEDIATE")
            self._owned(db, job_id, worker_id)
            db.execute(
                "UPDATE final_export_jobs SET lease_until=?,updated_at=? WHERE job_id=?",
                (lease_until, stamp, job_id),
            )
            row = db.execute("SELECT * FROM final_export_jobs WHERE job_id=?", (job_id,)).fetchone()
            db.commit()
            return self._row(row)

    def update_progress(self, job_id: str, worker_id: str, progress: Mapping[str, Any], *, now: datetime | str | None = None) -> dict[str, Any]:
        if not isinstance(progress, Mapping):
            raise ValueError("progress must be an object")
        progress_copy = dict(progress)
        # Lifecycle state belongs to the queue row. A compositor callback may
        # report a display status, but it must never shadow a terminal state.
        progress_copy.pop("status", None)
        progress_json = _json(progress_copy, "progress")
        stamp = _timestamp(now)
        with closing(self._connect()) as db:
            db.execute("BEGIN IMMEDIATE")
            self._owned(db, job_id, worker_id)
            db.execute(
                "UPDATE final_export_jobs SET progress_json=?,updated_at=? WHERE job_id=?",
                (progress_json, stamp, job_id),
            )
            row = db.execute("SELECT * FROM final_export_jobs WHERE job_id=?", (job_id,)).fetchone()
            db.commit()
            return self._row(row)

    def succeed(self, job_id: str, worker_id: str, result: Mapping[str, Any], *, now: datetime | str | None = None) -> dict[str, Any]:
        result_json = _json(dict(result), "result")
        stamp = _timestamp(now)
        with closing(self._connect()) as db:
            db.execute("BEGIN IMMEDIATE")
            self._owned(db, job_id, worker_id)
            db.execute(
                """UPDATE final_export_jobs SET status='succeeded',result_json=?,error_json=NULL,
                   progress_json=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE job_id=?""",
                (result_json, _json({"phase": "completed", "progress": 1.0}, "progress"), stamp, job_id),
            )
            row = db.execute("SELECT * FROM final_export_jobs WHERE job_id=?", (job_id,)).fetchone()
            db.commit()
            return self._row(row)

    def fail(self, job_id: str, worker_id: str, error: Mapping[str, Any], *, retryable: bool = False, now: datetime | str | None = None) -> dict[str, Any]:
        stamp = _timestamp(now)
        with closing(self._connect()) as db:
            db.execute("BEGIN IMMEDIATE")
            row = self._owned(db, job_id, worker_id)
            will_retry = bool(retryable and row["attempt"] < row["max_attempts"])
            status = "queued" if will_retry else "failed"
            attempt = row["attempt"] + 1 if will_retry else row["attempt"]
            safe_error = {
                "code": str(error.get("code") or "final_export_failed")[:100],
                "message": str(error.get("message") or "최종 영상 제작에 실패했습니다.")[:500],
                "retryable": will_retry,
            }
            db.execute(
                """UPDATE final_export_jobs SET status=?,attempt=?,error_json=?,lease_owner=NULL,
                   lease_until=NULL,updated_at=? WHERE job_id=?""",
                (status, attempt, _json(safe_error, "error"), stamp, job_id),
            )
            result = db.execute("SELECT * FROM final_export_jobs WHERE job_id=?", (job_id,)).fetchone()
            db.commit()
            return self._row(result)

    def cancel(self, job_id: str, *, user_id: str | None = None, now: datetime | str | None = None) -> dict[str, Any]:
        stamp = _timestamp(now)
        with closing(self._connect()) as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM final_export_jobs WHERE job_id=?", (job_id,)).fetchone()
            if row is None or (user_id is not None and row["user_id"] != user_id):
                db.rollback()
                raise FinalExportNotFound(job_id)
            if row["status"] in ("succeeded", "failed", "cancelled"):
                db.commit()
                return self._row(row)
            error = {"code": "cancelled", "message": "최종 영상 제작이 취소되었습니다.", "retryable": False}
            db.execute(
                """UPDATE final_export_jobs SET status='cancelled',error_json=?,lease_owner=NULL,
                   lease_until=NULL,updated_at=? WHERE job_id=?""",
                (_json(error, "error"), stamp, job_id),
            )
            result = db.execute("SELECT * FROM final_export_jobs WHERE job_id=?", (job_id,)).fetchone()
            db.commit()
            return self._row(result)
