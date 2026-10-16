"""Read-only queue metrics kept outside the queue state machine."""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path


def queue_position(path: Path, job_id: str, user_id: str) -> int:
    with closing(sqlite3.connect(path, timeout=30)) as db:
        row = db.execute(
            "SELECT status,created_at FROM final_export_jobs WHERE job_id=? AND user_id=?",
            (job_id, user_id),
        ).fetchone()
        if row is None or row[0] != "queued":
            return 0
        ahead = db.execute(
            """SELECT COUNT(*) FROM final_export_jobs
                WHERE status='queued' AND (created_at < ? OR (created_at=? AND job_id < ?))""",
            (row[1], row[1], job_id),
        ).fetchone()[0]
        return int(ahead) + 1
