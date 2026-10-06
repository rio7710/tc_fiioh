import json
import os
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path
from worker_core import JobStore, WorkerRuntimeSettings
from auth_store import AuthStore
from automation_store import AutomationStore
from automation_runner import AutomationRunner
import uuid
import threading

DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
SQLITE_PATH = Path(os.environ.get("SQLITE_PATH", str(DATA_DIR / "tc.sqlite")))
HEALTH_PATH = Path(os.environ.get("WORKER_HEALTH_PATH", str(DATA_DIR / "worker_health.json")))
JOB_STORE_PATH = Path(os.environ.get("WORKER_JOB_STORE_PATH", str(DATA_DIR / "worker_jobs.json")))

SCHEMA_VERSION = 1
VALID_STATUSES = ("queued", "running", "succeeded", "failed", "cancelled")


def init_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            )
            """
        )
        conn.commit()

        cursor.execute("SELECT MAX(version) FROM schema_migrations")
        row = cursor.fetchone()
        current_version = row[0] if row and row[0] is not None else 0

        cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='jobs'")
        jobs_def = cursor.fetchone()

        if jobs_def and ("CHECK" not in jobs_def[0].upper() or current_version < SCHEMA_VERSION):
            placeholders = ", ".join("?" for _ in VALID_STATUSES)
            cursor.execute(
                f"SELECT COUNT(*) FROM jobs WHERE status NOT IN ({placeholders})",
                VALID_STATUSES,
            )
            invalid_count = cursor.fetchone()[0]
            if invalid_count > 0:
                raise RuntimeError(
                    f"Worker migration aborted: found {invalid_count} rows with invalid status values"
                )

            cursor.execute("SELECT COUNT(*) FROM jobs")
            old_count = cursor.fetchone()[0]
            conn.execute("BEGIN TRANSACTION")
            try:
                cursor.execute("DROP TABLE IF EXISTS jobs_new")
                cursor.execute(
                    """
                    CREATE TABLE jobs_new (
                        job_id TEXT PRIMARY KEY,
                        project_id TEXT NOT NULL,
                        stage TEXT NOT NULL,
                        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
                        attempt INTEGER NOT NULL DEFAULT 1,
                        input TEXT,
                        trace TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                cursor.execute(
                    """
                    INSERT INTO jobs_new (job_id, project_id, stage, status, attempt, input, trace, created_at, updated_at)
                    SELECT job_id, project_id, stage, status, attempt, input, trace, created_at, updated_at FROM jobs
                    """
                )
                cursor.execute("SELECT COUNT(*) FROM jobs_new")
                if old_count != cursor.fetchone()[0]:
                    raise RuntimeError("Worker migration row count mismatch")
                cursor.execute("DROP TABLE jobs")
                cursor.execute("ALTER TABLE jobs_new RENAME TO jobs")
                cursor.execute(
                    "INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)",
                    (SCHEMA_VERSION, datetime.now().astimezone().isoformat(timespec="seconds")),
                )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
        elif not jobs_def:
            conn.execute("BEGIN TRANSACTION")
            try:
                cursor.execute(
                    """
                    CREATE TABLE jobs (
                        job_id TEXT PRIMARY KEY,
                        project_id TEXT NOT NULL,
                        stage TEXT NOT NULL,
                        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
                        attempt INTEGER NOT NULL DEFAULT 1,
                        input TEXT,
                        trace TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                cursor.execute(
                    "INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)",
                    (SCHEMA_VERSION, datetime.now().astimezone().isoformat(timespec="seconds")),
                )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise


def update_health(health_path: Path) -> None:
    health_path.parent.mkdir(parents=True, exist_ok=True)
    health_data = {
        "status": "healthy",
        "worker_id": "tc_temp_worker",
        "mode": "scheduled_content_automation",
        "schema_version": SCHEMA_VERSION,
        "last_heartbeat": datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    tmp_path = health_path.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(health_data, indent=2), encoding="utf-8")
    tmp_path.replace(health_path)


def create_job_store(path: Path = JOB_STORE_PATH) -> JobStore:
    """Open the worker-owned persistent job store and recover expired leases."""
    job_store = JobStore(path)
    job_store.recover_stale()
    return job_store


def main() -> None:
    print("[tc_temp_worker] Starting scheduled content automation")
    settings = WorkerRuntimeSettings.from_env()
    init_db(SQLITE_PATH)
    store = AutomationStore(AuthStore(SQLITE_PATH))
    runner = AutomationRunner(store, job_store=create_job_store(), settings=settings)
    owner = str(uuid.uuid4())
    def health_loop():
        while True:
            try:
                update_health(HEALTH_PATH)
            except Exception:
                pass
            time.sleep(settings.heartbeat_interval_seconds)
    threading.Thread(target=health_loop, daemon=True).start()
    while True:
        try:
            run = store.claim(owner)
            if run:
                runner.execute(run)
            else:
                store.enqueue_due()
        except Exception as exc:
            print(f"[tc_temp_worker] Health update failed: {type(exc).__name__}", file=sys.stderr)
        time.sleep(settings.idle_poll_seconds)


if __name__ == "__main__":
    main()
