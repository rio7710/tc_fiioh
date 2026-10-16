"""Atomic cancellation/finalization transitions for final-export jobs."""

from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path


class QueueControlConflict(RuntimeError):
    pass


class QueueControlNotFound(RuntimeError):
    pass


def _stamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _connect(path: Path):
    db = sqlite3.connect(path, timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout=30000")
    return db


def request_cancel(path: Path, job_id: str, user_id: str):
    with closing(_connect(path)) as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute(
            "SELECT * FROM final_export_jobs WHERE job_id=? AND user_id=?",
            (job_id, user_id),
        ).fetchone()
        if row is None:
            raise QueueControlNotFound(job_id)
        if row["status"] in ("succeeded", "failed", "cancelled"):
            db.commit()
            return row
        progress = json.loads(row["progress_json"] or "{}")
        if progress.get("phase") == "finalize":
            raise QueueControlConflict("배포 파일 등록이 시작되어 작업을 취소할 수 없습니다.")
        stamp = _stamp()
        if row["status"] == "queued":
            error = json.dumps({
                "code": "cancelled", "message": "최종 영상 제작이 취소되었습니다.",
                "retryable": False,
            }, ensure_ascii=False)
            db.execute(
                """UPDATE final_export_jobs SET status='cancelled',cancel_requested_at=?,
                   error_json=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE job_id=?""",
                (stamp, error, stamp, job_id),
            )
        else:
            db.execute(
                "UPDATE final_export_jobs SET cancel_requested_at=?,updated_at=? WHERE job_id=?",
                (stamp, stamp, job_id),
            )
        result = db.execute("SELECT * FROM final_export_jobs WHERE job_id=?", (job_id,)).fetchone()
        db.commit()
        return result


def begin_finalize(path: Path, job_id: str, worker_id: str):
    with closing(_connect(path)) as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM final_export_jobs WHERE job_id=?", (job_id,)).fetchone()
        if row is None:
            raise QueueControlNotFound(job_id)
        if row["status"] != "running" or row["lease_owner"] != worker_id:
            raise QueueControlConflict("worker does not own the running final-export job")
        if row["cancel_requested_at"]:
            raise QueueControlConflict("final-export cancellation was requested")
        progress = json.loads(row["progress_json"] or "{}")
        progress.update({
            "phase": "finalize", "progress": 0.99,
            "detail": "MP4 파일과 콘텐츠 캘린더를 확정하고 있습니다.",
        })
        db.execute(
            "UPDATE final_export_jobs SET progress_json=?,updated_at=? WHERE job_id=?",
            (json.dumps(progress, ensure_ascii=False), _stamp(), job_id),
        )
        result = db.execute("SELECT * FROM final_export_jobs WHERE job_id=?", (job_id,)).fetchone()
        db.commit()
        return result


def finish_cancel(path: Path, job_id: str, worker_id: str):
    with closing(_connect(path)) as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM final_export_jobs WHERE job_id=?", (job_id,)).fetchone()
        if row is None:
            raise QueueControlNotFound(job_id)
        if row["status"] != "running" or row["lease_owner"] != worker_id or not row["cancel_requested_at"]:
            raise QueueControlConflict("running cancellation is not owned by this worker")
        error = json.dumps({
            "code": "cancelled", "message": "최종 영상 제작이 취소되었습니다.",
            "retryable": False,
        }, ensure_ascii=False)
        db.execute(
            """UPDATE final_export_jobs SET status='cancelled',error_json=?,lease_owner=NULL,
               lease_until=NULL,updated_at=? WHERE job_id=?""",
            (error, _stamp(), job_id),
        )
        result = db.execute("SELECT * FROM final_export_jobs WHERE job_id=?", (job_id,)).fetchone()
        db.commit()
        return result
