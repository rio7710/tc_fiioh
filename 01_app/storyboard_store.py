from __future__ import annotations

import hashlib
import json
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def keyword_signature(keywords: list[str]) -> str:
    normalized = sorted({str(value).strip() for value in keywords if str(value).strip()})
    return hashlib.sha256("\x1f".join(normalized).encode("utf-8")).hexdigest()


class StoryboardStore:
    """Durable validated-script store; callers validate before save."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self):
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self):
        with closing(self._connect()) as connection:
            connection.execute("""
                CREATE TABLE IF NOT EXISTS storyboards (
                    idempotency_key TEXT PRIMARY KEY,
                    document_id TEXT NOT NULL,
                    keyword_signature TEXT NOT NULL,
                    content_hash TEXT NOT NULL,
                    document_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            """)
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_storyboards_keywords ON storyboards(keyword_signature, created_at)"
            )
            connection.commit()

    def load(self, idempotency_key: str) -> dict[str, Any] | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT document_json FROM storyboards WHERE idempotency_key = ?", (idempotency_key,)
            ).fetchone()
        return json.loads(row["document_json"]) if row else None

    def save(self, idempotency_key: str, document: dict[str, Any]) -> dict[str, Any]:
        existing = self.load(idempotency_key)
        if existing is not None:
            return existing
        payload = json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        signature = keyword_signature(document["project"]["selected_keywords"])
        with closing(self._connect()) as connection:
            connection.execute(
                "INSERT OR IGNORE INTO storyboards VALUES (?, ?, ?, ?, ?, ?)",
                (idempotency_key, document["document_id"], signature,
                 hashlib.sha256(payload.encode("utf-8")).hexdigest(), payload,
                 datetime.now(timezone.utc).isoformat()),
            )
            connection.commit()
        return self.load(idempotency_key) or document

    def recent_for_keywords(self, keywords: list[str], limit: int = 5) -> list[dict[str, Any]]:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                "SELECT document_json FROM storyboards WHERE keyword_signature = ? ORDER BY created_at DESC LIMIT ?",
                (keyword_signature(keywords), limit),
            ).fetchall()
        return [json.loads(row["document_json"]) for row in rows]
