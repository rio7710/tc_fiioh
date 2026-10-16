"""Additive queue schema and active-idempotency lookup helpers."""

from __future__ import annotations


def ensure_idempotency_schema(db) -> None:
    columns = {row[1] for row in db.execute("PRAGMA table_info(final_export_jobs)")}
    if "idempotency_key" not in columns:
        db.execute("ALTER TABLE final_export_jobs ADD COLUMN idempotency_key TEXT")
    if "cancel_requested_at" not in columns:
        db.execute("ALTER TABLE final_export_jobs ADD COLUMN cancel_requested_at TEXT")
    db.execute(
        """CREATE UNIQUE INDEX IF NOT EXISTS final_export_jobs_active_idempotency
           ON final_export_jobs(user_id,project_id,idempotency_key)
           WHERE idempotency_key IS NOT NULL AND status IN ('queued','running')"""
    )


def active_idempotent_job(db, user_id: str, project_id: str, key: str):
    if not key:
        return None
    return db.execute(
        """SELECT * FROM final_export_jobs
           WHERE user_id=? AND project_id=? AND idempotency_key=?
             AND status IN ('queued','running')
           ORDER BY created_at,job_id LIMIT 1""",
        (user_id, project_id, key),
    ).fetchone()
