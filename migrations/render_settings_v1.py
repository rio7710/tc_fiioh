"""Additive, owner-scoped storage for render setting overrides."""

from __future__ import annotations


def ensure_render_settings_schema(connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS render_settings_schema_versions (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS user_render_settings (
            user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
            version INTEGER NOT NULL CHECK(version > 0),
            overrides_json TEXT NOT NULL CHECK(json_valid(overrides_json)),
            updated_at TEXT NOT NULL
        );
        INSERT OR IGNORE INTO render_settings_schema_versions
            (version, applied_at)
        VALUES (1, strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'));
        """
    )
