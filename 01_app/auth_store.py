from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import re
import uuid
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from migrations.brand_variant_v1 import ensure_brand_variant_schema
from migrations.render_settings_v1 import ensure_render_settings_schema


def _safe_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


SQLITE_TIMEOUT_SECONDS = _safe_env_int("SQLITE_TIMEOUT_SECONDS", 15, 1, 120)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _password_hash(password: str, salt: bytes | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310_000)
    return salt.hex(), digest.hex()


class AuthStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=SQLITE_TIMEOUT_SECONDS)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _initialize(self) -> None:
        with closing(self._connect()) as connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS users (
                    user_id TEXT PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    password_salt TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                    expires_at TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS groups (
                    group_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    owner_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS group_members (
                    group_id TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
                    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                    role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner')),
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (group_id, user_id)
                );
                CREATE TABLE IF NOT EXISTS projects (
                    project_id TEXT PRIMARY KEY,
                    owner_user_id TEXT NOT NULL REFERENCES users(user_id),
                    group_id TEXT REFERENCES groups(group_id),
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS automated_projects (
                    project_id TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
                    run_id TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'queued',
                    stage TEXT NOT NULL DEFAULT 'create_project',
                    error_message TEXT,
                    endpoint TEXT NOT NULL DEFAULT 'manual'
                );
                CREATE TABLE IF NOT EXISTS scene_crop_positions (
                    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
                    scene_id TEXT NOT NULL,
                    output_format TEXT NOT NULL CHECK (output_format IN ('9x16', '4x5')),
                    pan_x REAL NOT NULL CHECK (pan_x >= 0 AND pan_x <= 100),
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (project_id, scene_id, output_format)
                );
                CREATE TABLE IF NOT EXISTS scene_transition_modes (
                    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
                    scene_id TEXT NOT NULL,
                    mode TEXT NOT NULL CHECK (mode IN ('auto', 'connect', 'cut')),
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (project_id, scene_id)
                );
                CREATE TABLE IF NOT EXISTS project_stage_revisions (
                    revision_id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
                    stage INTEGER NOT NULL CHECK (stage BETWEEN 2 AND 5),
                    revision INTEGER NOT NULL CHECK (revision >= 1),
                    status TEXT NOT NULL CHECK (
                        status IN ('draft', 'confirmed', 'superseded', 'invalidated')
                    ),
                    schema_version TEXT NOT NULL,
                    data_json TEXT NOT NULL CHECK (json_valid(data_json)),
                    content_hash TEXT NOT NULL,
                    created_by TEXT NOT NULL REFERENCES users(user_id),
                    created_at TEXT NOT NULL,
                    confirmed_at TEXT,
                    invalidated_at TEXT,
                    UNIQUE (project_id, stage, revision)
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_stage_one_confirmed
                    ON project_stage_revisions(project_id, stage)
                    WHERE status = 'confirmed';

                CREATE TABLE IF NOT EXISTS ai_conversations (
                    conversation_id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
                    stage INTEGER NOT NULL CHECK (stage BETWEEN 2 AND 5),
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    previous_response_id TEXT,
                    status TEXT NOT NULL DEFAULT 'active' CHECK (
                        status IN ('active', 'closed')
                    ),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS ai_messages (
                    message_id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL REFERENCES ai_conversations(conversation_id) ON DELETE CASCADE,
                    sequence INTEGER NOT NULL CHECK (sequence >= 1),
                    role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
                    content_json TEXT NOT NULL CHECK (json_valid(content_json)),
                    provider_response_id TEXT,
                    usage_json TEXT CHECK (usage_json IS NULL OR json_valid(usage_json)),
                    created_at TEXT NOT NULL,
                    UNIQUE (conversation_id, sequence)
                );
                CREATE TABLE IF NOT EXISTS stage_candidates (
                    candidate_id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
                    stage INTEGER NOT NULL CHECK (stage BETWEEN 2 AND 5),
                    conversation_id TEXT REFERENCES ai_conversations(conversation_id) ON DELETE SET NULL,
                    source_message_id TEXT REFERENCES ai_messages(message_id) ON DELETE SET NULL,
                    schema_version TEXT NOT NULL,
                    data_json TEXT NOT NULL CHECK (json_valid(data_json)),
                    status TEXT NOT NULL DEFAULT 'draft' CHECK (
                        status IN ('draft', 'accepted', 'rejected')
                    ),
                    created_at TEXT NOT NULL,
                    decided_at TEXT
                );
                CREATE TABLE IF NOT EXISTS stage_dependencies (
                    downstream_revision_id TEXT NOT NULL REFERENCES project_stage_revisions(revision_id) ON DELETE CASCADE,
                    upstream_revision_id TEXT NOT NULL REFERENCES project_stage_revisions(revision_id),
                    PRIMARY KEY (downstream_revision_id, upstream_revision_id),
                    CHECK (downstream_revision_id <> upstream_revision_id)
                );
                CREATE TABLE IF NOT EXISTS artifacts (
                    artifact_id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
                    revision_id TEXT REFERENCES project_stage_revisions(revision_id),
                    scene_id TEXT,
                    artifact_type TEXT NOT NULL,
                    uri TEXT NOT NULL,
                    checksum TEXT,
                    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
                    status TEXT NOT NULL DEFAULT 'active' CHECK (
                        status IN ('active', 'invalidated', 'deleted')
                    ),
                    created_at TEXT NOT NULL,
                    invalidated_at TEXT
                );
                CREATE TABLE IF NOT EXISTS publications (
                    publication_id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
                    local_date TEXT NOT NULL,
                    platform TEXT NOT NULL,
                    status TEXT NOT NULL,
                    settings_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings_json)),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE (project_id, local_date, platform)
                );
                CREATE TABLE IF NOT EXISTS brand_assets (
                    asset_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK (role IN ('intro','outro','watermark')),
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS brand_asset_versions (
                    version_id TEXT PRIMARY KEY,
                    asset_id TEXT NOT NULL REFERENCES brand_assets(asset_id) ON DELETE CASCADE,
                    version INTEGER NOT NULL,
                    uri TEXT NOT NULL,
                    media_type TEXT NOT NULL CHECK (media_type IN ('image','video')),
                    mime_type TEXT NOT NULL,
                    active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    UNIQUE (asset_id, version)
                );
                CREATE TABLE IF NOT EXISTS content_brand_selections (
                    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK (role IN ('intro','outro','watermark')),
                    enabled INTEGER NOT NULL DEFAULT 0,
                    version_id TEXT REFERENCES brand_asset_versions(version_id),
                    settings_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings_json)),
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (project_id, role)
                );
                CREATE TABLE IF NOT EXISTS user_brand_selections (
                    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK (role IN ('intro','outro','watermark')),
                    enabled INTEGER NOT NULL DEFAULT 0,
                    version_id TEXT REFERENCES brand_asset_versions(version_id),
                    settings_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings_json)),
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, role)
                );
                CREATE TABLE IF NOT EXISTS final_export_brand_assets (
                    artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK (role IN ('intro','outro','watermark')),
                    version_id TEXT NOT NULL REFERENCES brand_asset_versions(version_id),
                    settings_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings_json)),
                    PRIMARY KEY (artifact_id, role)
                );
                INSERT OR IGNORE INTO user_brand_selections
                    (user_id, role, enabled, version_id, settings_json, updated_at)
                SELECT p.owner_user_id, s.role, s.enabled, s.version_id, s.settings_json, s.updated_at
                  FROM content_brand_selections s JOIN projects p ON p.project_id=s.project_id
                 WHERE s.updated_at=(
                    SELECT MAX(s2.updated_at)
                      FROM content_brand_selections s2 JOIN projects p2 ON p2.project_id=s2.project_id
                     WHERE p2.owner_user_id=p.owner_user_id AND s2.role=s.role
                 );
                CREATE TABLE IF NOT EXISTS api_usage_events (
                    usage_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                    project_id TEXT REFERENCES projects(project_id) ON DELETE CASCADE,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    operation TEXT NOT NULL,
                    provider_response_id TEXT,
                    input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
                    output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
                    total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS keyword_pool_draws (
                    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                    scope TEXT NOT NULL,
                    month TEXT NOT NULL,
                    pool_hash TEXT NOT NULL,
                    remaining_json TEXT NOT NULL,
                    last_json TEXT NOT NULL,
                    PRIMARY KEY(user_id, scope, month)
                );
                CREATE TABLE IF NOT EXISTS seasonal_keyword_sets (
                    recommendation_id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
                    local_date TEXT NOT NULL,
                    keywords_json TEXT NOT NULL CHECK (json_valid(keywords_json)),
                    usage_id TEXT REFERENCES api_usage_events(usage_id),
                    created_at TEXT NOT NULL,
                    UNIQUE (project_id, local_date)
                );
                CREATE TABLE IF NOT EXISTS group_resources (
                    resource_id TEXT PRIMARY KEY,
                    group_id TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
                    resource_type TEXT NOT NULL,
                    resource_key TEXT NOT NULL,
                    schema_version TEXT NOT NULL,
                    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
                    source_uri TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE (group_id, resource_type, resource_key)
                );
                CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
                CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_user_id);
                CREATE INDEX IF NOT EXISTS idx_stage_history
                    ON project_stage_revisions(project_id, stage, revision DESC);
                CREATE INDEX IF NOT EXISTS idx_conversations_project_stage
                    ON ai_conversations(project_id, stage, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_messages_conversation
                    ON ai_messages(conversation_id, sequence);
                CREATE INDEX IF NOT EXISTS idx_candidates_project_stage
                    ON stage_candidates(project_id, stage, status);
                CREATE INDEX IF NOT EXISTS idx_artifacts_project_status
                    ON artifacts(project_id, status);
                CREATE INDEX IF NOT EXISTS idx_publications_project_date
                    ON publications(project_id, local_date);
                CREATE INDEX IF NOT EXISTS idx_brand_assets_user_role
                    ON brand_assets(user_id, role);
                CREATE INDEX IF NOT EXISTS idx_api_usage_user_created
                    ON api_usage_events(user_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_api_usage_project_created
                    ON api_usage_events(project_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_group_members_user
                    ON group_members(user_id, group_id);
                CREATE INDEX IF NOT EXISTS idx_group_resources_lookup
                    ON group_resources(group_id, resource_type, resource_key);
            """)
            project_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(projects)")
            }
            if "group_id" not in project_columns:
                connection.execute("ALTER TABLE projects ADD COLUMN group_id TEXT REFERENCES groups(group_id)")
            now = _now().isoformat()
            users = connection.execute("SELECT user_id, username FROM users").fetchall()
            for user in users:
                group_id = f"group_{user['user_id'].removeprefix('user_')}"
                connection.execute(
                    "INSERT OR IGNORE INTO groups VALUES (?, ?, ?, ?, ?)",
                    (group_id, f"{user['username']} 개인 그룹", user["user_id"], now, now),
                )
                connection.execute(
                    "INSERT OR IGNORE INTO group_members VALUES (?, ?, 'owner', ?)",
                    (group_id, user["user_id"], now),
                )
                connection.execute(
                    "UPDATE projects SET group_id = ? WHERE owner_user_id = ? AND group_id IS NULL",
                    (group_id, user["user_id"]),
                )
            connection.execute("CREATE INDEX IF NOT EXISTS idx_projects_group ON projects(group_id, updated_at DESC)")
            connection.execute(
                """DELETE FROM projects
                   WHERE project_id LIKE 'project_%'
                     AND name = '내 콘텐츠'
                     AND NOT EXISTS (
                         SELECT 1 FROM project_stage_revisions
                         WHERE project_stage_revisions.project_id = projects.project_id
                     )
                     AND NOT EXISTS (
                         SELECT 1 FROM artifacts
                         WHERE artifacts.project_id = projects.project_id
                     )
                     AND NOT EXISTS (
                         SELECT 1 FROM publications
                         WHERE publications.project_id = projects.project_id
                     )"""
            )
            automated_columns = {row['name'] for row in connection.execute('PRAGMA table_info(automated_projects)')}
            for column, definition in (
                ('status', "TEXT NOT NULL DEFAULT 'queued'"),
                ('stage', "TEXT NOT NULL DEFAULT 'create_project'"),
                ('error_message', 'TEXT'),
                ('endpoint', "TEXT NOT NULL DEFAULT 'manual'"),
            ):
                if column not in automated_columns:
                    connection.execute(f'ALTER TABLE automated_projects ADD COLUMN {column} {definition}')
            ensure_brand_variant_schema(connection)
            ensure_render_settings_schema(connection)
            connection.commit()

    def get_render_settings(self, user_id: str) -> dict:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT overrides_json FROM user_render_settings WHERE user_id=?", (user_id,)
            ).fetchone()
        if not row:
            return {}
        try:
            value = json.loads(row["overrides_json"])
        except (TypeError, json.JSONDecodeError) as exc:
            raise ValueError("렌더 설정을 읽을 수 없습니다.") from exc
        return value if isinstance(value, dict) else {}

    def save_render_settings(self, user_id: str, overrides: dict, merge: bool = False) -> dict:
        if not isinstance(overrides, dict):
            raise ValueError("렌더 설정 형식이 올바르지 않습니다.")
        encoded = json.dumps(overrides, ensure_ascii=False, sort_keys=True, allow_nan=False)
        now = _now().isoformat()
        with closing(self._connect()) as connection:
            if not connection.execute("SELECT 1 FROM users WHERE user_id=?", (user_id,)).fetchone():
                raise ValueError("사용자를 찾을 수 없습니다.")
            current = connection.execute(
                "SELECT version, overrides_json FROM user_render_settings WHERE user_id=?", (user_id,)
            ).fetchone()
            if merge and current:
                previous = json.loads(current["overrides_json"] or "{}")
                if not isinstance(previous, dict):
                    previous = {}
                merged = {**previous, **overrides}
                encoded = json.dumps(merged, ensure_ascii=False, sort_keys=True, allow_nan=False)
            version = int(current["version"]) + 1 if current else 1
            connection.execute(
                """INSERT INTO user_render_settings(user_id,version,overrides_json,updated_at)
                   VALUES(?,?,?,?)
                   ON CONFLICT(user_id) DO UPDATE SET version=excluded.version,
                     overrides_json=excluded.overrides_json, updated_at=excluded.updated_at""",
                (user_id, version, encoded, now),
            )
            connection.commit()
        return json.loads(encoded)

    def ensure_user(self, username: str, password: str) -> dict:
        username = username.strip()
        if not username or not password:
            raise ValueError("아이디와 비밀번호를 입력해 주세요.")
        with closing(self._connect()) as connection:
            existing = connection.execute(
                "SELECT user_id, username FROM users WHERE username = ?", (username,)
            ).fetchone()
            if existing:
                return dict(existing)
            salt, digest = _password_hash(password)
            user_id = f"user_{secrets.token_hex(8)}"
            connection.execute(
                "INSERT INTO users VALUES (?, ?, ?, ?, ?)",
                (user_id, username, salt, digest, _now().isoformat()),
            )
            connection.commit()
            return {"user_id": user_id, "username": username}

    def create_user(self, username: str, password: str) -> dict:
        username = username.strip()
        if not re.fullmatch(r"[A-Za-z0-9._-]{3,40}", username):
            raise ValueError("아이디는 영문, 숫자, 마침표, 밑줄, 하이픈으로 3~40자 입력해 주세요.")
        if not 8 <= len(password) <= 200:
            raise ValueError("비밀번호는 8자 이상 입력해 주세요.")
        salt, digest = _password_hash(password)
        user_id = f"user_{secrets.token_hex(8)}"
        try:
            with closing(self._connect()) as connection:
                connection.execute(
                    "INSERT INTO users VALUES (?, ?, ?, ?, ?)",
                    (user_id, username, salt, digest, _now().isoformat()),
                )
                group_id = f"group_{user_id.removeprefix('user_')}"
                now = _now().isoformat()
                connection.execute(
                    "INSERT INTO groups VALUES (?, ?, ?, ?, ?)",
                    (group_id, f"{username} 개인 그룹", user_id, now, now),
                )
                connection.execute(
                    "INSERT INTO group_members VALUES (?, ?, 'owner', ?)",
                    (group_id, user_id, now),
                )
                connection.commit()
        except sqlite3.IntegrityError:
            raise ValueError("이미 사용 중인 아이디입니다.") from None
        return {"user_id": user_id, "username": username}

    def authenticate(self, username: str, password: str) -> dict | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT * FROM users WHERE username = ?", (username.strip(),)
            ).fetchone()
        if not row:
            return None
        _, candidate = _password_hash(password, bytes.fromhex(row["password_salt"]))
        if not hmac.compare_digest(candidate, row["password_hash"]):
            return None
        return {"user_id": row["user_id"], "username": row["username"]}

    def create_session(self, user_id: str, days: int = 7) -> str:
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        now = _now()
        with closing(self._connect()) as connection:
            connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (now.isoformat(),))
            connection.execute(
                "INSERT INTO sessions VALUES (?, ?, ?, ?)",
                (token_hash, user_id, (now + timedelta(days=days)).isoformat(), now.isoformat()),
            )
            connection.commit()
        return token

    def session_user(self, token: str) -> dict | None:
        if not token:
            return None
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with closing(self._connect()) as connection:
            row = connection.execute(
                """SELECT users.user_id, users.username FROM sessions
                   JOIN users USING (user_id)
                   WHERE token_hash = ? AND expires_at > ?""",
                (token_hash, _now().isoformat()),
            ).fetchone()
        return dict(row) if row else None

    def delete_session(self, token: str) -> None:
        if not token:
            return
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with closing(self._connect()) as connection:
            connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
            connection.commit()

    def personal_group(self, user_id: str) -> dict:
        group_id = f"group_{user_id.removeprefix('user_')}"
        now = _now().isoformat()
        with closing(self._connect()) as connection:
            user = connection.execute(
                "SELECT username FROM users WHERE user_id = ?", (user_id,)
            ).fetchone()
            if not user:
                raise ValueError("사용자를 찾을 수 없습니다.")
            connection.execute(
                "INSERT OR IGNORE INTO groups VALUES (?, ?, ?, ?, ?)",
                (group_id, f"{user['username']} 개인 그룹", user_id, now, now),
            )
            connection.execute(
                "INSERT OR IGNORE INTO group_members VALUES (?, ?, 'owner', ?)",
                (group_id, user_id, now),
            )
            row = connection.execute(
                """SELECT g.group_id, g.name, gm.role
                   FROM groups g JOIN group_members gm USING (group_id)
                   WHERE gm.user_id = ? AND g.group_id = ?""",
                (user_id, group_id),
            ).fetchone()
            connection.commit()
        return dict(row)

    def put_group_resource(self, user_id: str, resource_type: str, resource_key: str,
                           schema_version: str, payload: dict, source_uri: str | None = None) -> dict:
        group = self.personal_group(user_id)
        now = _now().isoformat()
        payload_json = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        with closing(self._connect()) as connection:
            existing = connection.execute(
                """SELECT resource_id, created_at FROM group_resources
                   WHERE group_id = ? AND resource_type = ? AND resource_key = ?""",
                (group["group_id"], resource_type, resource_key),
            ).fetchone()
            resource_id = existing["resource_id"] if existing else str(uuid.uuid4())
            created_at = existing["created_at"] if existing else now
            connection.execute(
                """INSERT OR REPLACE INTO group_resources
                   (resource_id, group_id, resource_type, resource_key, schema_version,
                    payload_json, source_uri, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (resource_id, group["group_id"], resource_type, resource_key, schema_version,
                 payload_json, source_uri, created_at, now),
            )
            connection.commit()
        return {"resource_id": resource_id, "group_id": group["group_id"],
                "resource_type": resource_type, "resource_key": resource_key,
                "schema_version": schema_version}

    def list_group_resources(self, user_id: str) -> list[dict]:
        group = self.personal_group(user_id)
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """SELECT resource_id, resource_type, resource_key, schema_version,
                          source_uri, created_at, updated_at
                   FROM group_resources WHERE group_id = ? ORDER BY resource_type, resource_key""",
                (group["group_id"],),
            ).fetchall()
        return [dict(row) for row in rows]

    def project_group_resources(self, user_id: str, project_id: str,
                                resource_types: tuple[str, ...] | None = None) -> list[dict]:
        """Return only resources inherited by a project group the user belongs to."""
        values: list[str] = [user_id, project_id]
        type_filter = ""
        if resource_types:
            placeholders = ",".join("?" for _ in resource_types)
            type_filter = f" AND r.resource_type IN ({placeholders})"
            values.extend(resource_types)
        with closing(self._connect()) as connection:
            rows = connection.execute(
                f"""SELECT r.resource_id, r.group_id, r.resource_type, r.resource_key,
                           r.schema_version, r.payload_json, r.source_uri, r.updated_at
                    FROM projects p
                    JOIN group_members gm ON gm.group_id = p.group_id AND gm.user_id = ?
                    JOIN group_resources r ON r.group_id = p.group_id
                    WHERE p.project_id = ?{type_filter}
                    ORDER BY r.resource_type, r.resource_key""",
                values,
            ).fetchall()
        resources = []
        for row in rows:
            item = dict(row)
            item["payload"] = json.loads(item.pop("payload_json"))
            resources.append(item)
        return resources

    def save_stage_draft(self, user_id: str, project_id: str, stage: int, data: dict,
                         schema_version: str = "1.0.0") -> dict:
        if stage not in {2, 3, 4, 5}:
            raise ValueError("작업 단계가 올바르지 않습니다.")
        project = self.get_project(user_id, project_id)
        if not project:
            raise ValueError("이 프로젝트에 접근할 수 없습니다.")
        now = _now().isoformat()
        encoded = json.dumps(data, ensure_ascii=False, sort_keys=True)
        content_hash = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
        with closing(self._connect()) as connection:
            latest = connection.execute(
                "SELECT COALESCE(MAX(revision), 0) AS revision FROM project_stage_revisions WHERE project_id = ? AND stage = ?",
                (project_id, stage),
            ).fetchone()
            revision = int(latest["revision"]) + 1
            connection.execute(
                "UPDATE project_stage_revisions SET status = 'superseded' WHERE project_id = ? AND stage = ? AND status = 'draft'",
                (project_id, stage),
            )
            revision_id = str(uuid.uuid4())
            connection.execute(
                """INSERT INTO project_stage_revisions
                   (revision_id, project_id, stage, revision, status, schema_version,
                    data_json, content_hash, created_by, created_at)
                   VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)""",
                (revision_id, project_id, stage, revision, schema_version, encoded,
                 content_hash, user_id, now),
            )
            connection.execute("UPDATE projects SET updated_at = ? WHERE project_id = ?", (now, project_id))
            connection.commit()
        return {"revision_id": revision_id, "project_id": project_id, "stage": stage,
                "revision": revision, "status": "draft", "data": data}

    def draw_monthly_keywords(self, user_id, pool, count=3, project_id=None, local_date=None):
        from keyword_pool import draw_shuffle_bag
        scope = f'project:{project_id}' if project_id else 'user-preview'
        items = {item['id']: {**item, 'seasonal': True, 'image': 'warmth'} for item in pool['keywords']}
        fingerprint = hashlib.sha256(json.dumps(pool, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        with closing(self._connect()) as connection:
            connection.execute('BEGIN IMMEDIATE')
            if project_id and not connection.execute('SELECT 1 FROM projects WHERE project_id=? AND owner_user_id=?', (project_id,user_id)).fetchone():
                raise ValueError('이 콘텐츠에 접근할 수 없습니다.')
            row = connection.execute('SELECT * FROM keyword_pool_draws WHERE user_id=? AND scope=? AND month=?', (user_id,scope,pool['month'])).fetchone()
            same = row is not None and row['pool_hash'] == fingerprint
            selected, remaining, cycled = draw_shuffle_bag(list(items), json.loads(row['remaining_json']) if same else None, json.loads(row['last_json']) if same else [], count)
            connection.execute('INSERT OR REPLACE INTO keyword_pool_draws VALUES (?,?,?,?,?,?)', (user_id,scope,pool['month'],fingerprint,json.dumps(remaining),json.dumps(selected)))
            keywords = [items[key] for key in selected]
            if project_id:
                if not local_date:
                    raise ValueError('저장 기준 날짜가 필요합니다.')
                previous = connection.execute('SELECT keywords_json FROM seasonal_keyword_sets WHERE project_id=? AND local_date=?', (project_id,local_date)).fetchone()
                merged = {item['id']: item for item in (json.loads(previous['keywords_json']) if previous else [])}
                merged.update({item['id']: item for item in keywords})
                connection.execute('INSERT OR REPLACE INTO seasonal_keyword_sets VALUES (?,?,?,?,?,?)', (str(uuid.uuid4()),project_id,local_date,json.dumps(list(merged.values()),ensure_ascii=False),None,_now().isoformat()))
            connection.commit()
        return {'keywords':keywords,'remaining':len(remaining),'pool_size':len(items),'cycled':cycled,'month':pool['month'],'source':'monthly_pool'}

    def apply_keyword_recommendation(self, user_id, project_id, keywords):
        """Save selected recommendations atomically; never replace scripted content."""
        if not isinstance(keywords, list) or not 1 <= len(keywords) <= 5:
            raise ValueError("키워드는 1~5개여야 합니다.")
        data = {"selected_keyword_ids": [item["id"] for item in keywords],
                "selected_keywords": [item["label"] for item in keywords],
                "seasonal_keywords": keywords}
        encoded = json.dumps(data, ensure_ascii=False, sort_keys=True)
        now = _now().isoformat()
        with closing(self._connect()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            if not connection.execute("SELECT 1 FROM projects WHERE project_id=? AND owner_user_id=?", (project_id, user_id)).fetchone():
                raise ValueError("이 콘텐츠에 접근할 수 없습니다.")
            if connection.execute("SELECT 1 FROM project_stage_revisions WHERE project_id=? AND stage>=3 LIMIT 1", (project_id,)).fetchone():
                raise ValueError("대본 제작이 시작된 콘텐츠는 키워드를 변경할 수 없습니다.")
            latest = connection.execute("SELECT revision_id, revision, data_json FROM project_stage_revisions WHERE project_id=? AND stage=2 ORDER BY revision DESC LIMIT 1", (project_id,)).fetchone()
            if latest and json.loads(latest["data_json"]) == data:
                return {"revision_id": latest["revision_id"], "project_id": project_id, "data": data, "reused": True}
            revision_id = str(uuid.uuid4())
            connection.execute("UPDATE project_stage_revisions SET status='superseded' WHERE project_id=? AND stage=2 AND status IN ('draft','confirmed')", (project_id,))
            connection.execute("""INSERT INTO project_stage_revisions
                (revision_id,project_id,stage,revision,status,schema_version,data_json,content_hash,created_by,created_at,confirmed_at)
                VALUES (?,?,2,?,'confirmed','1.0.0',?,?,?,?,?)""",
                (revision_id, project_id, int(latest['revision'])+1 if latest else 1, encoded,
                 hashlib.sha256(encoded.encode('utf-8')).hexdigest(), user_id, now, now))
            connection.execute("UPDATE projects SET updated_at=? WHERE project_id=?", (now, project_id))
            connection.commit()
        return {"revision_id": revision_id, "project_id": project_id, "data": data, "reused": False}

    def latest_stage_data(self, user_id: str, project_id: str, stage: int) -> dict | None:
        if not self.get_project(user_id, project_id):
            return None
        with closing(self._connect()) as connection:
            row = connection.execute(
                """SELECT revision_id, revision, status, schema_version, data_json, created_at
                   FROM project_stage_revisions
                   WHERE project_id = ? AND stage = ?
                   ORDER BY revision DESC LIMIT 1""",
                (project_id, stage),
            ).fetchone()
        if not row:
            return None
        result = dict(row)
        result["data"] = json.loads(result.pop("data_json"))
        return result

    def inherit_compatible_media_artifacts(self, user_id: str, project_id: str,
                                           revision_id: str) -> dict:
        """Carry storyboard media across metadata-only stage-3 revisions.

        Voice-profile changes create a new stage revision while leaving the
        storyboard document unchanged. Media remains content-owned and is
        inherited only from revisions with an identical document payload.
        """
        if not self.get_project(user_id, project_id):
            raise ValueError("이 프로젝트에 접근할 수 없습니다.")
        media_types = ("scene_image_candidate", "scene_video")
        with closing(self._connect()) as connection:
            target = connection.execute(
                """SELECT data_json FROM project_stage_revisions
                    WHERE project_id = ? AND revision_id = ? AND stage = 3""",
                (project_id, revision_id),
            ).fetchone()
            if not target:
                return {"copied": 0, "source_revision_ids": []}
            target_document = json.loads(target["data_json"] or "{}").get("document")
            if not isinstance(target_document, dict):
                return {"copied": 0, "source_revision_ids": []}
            target_fingerprint = json.dumps(
                target_document, ensure_ascii=False, sort_keys=True, separators=(",", ":")
            )
            revisions = connection.execute(
                """SELECT revision_id, data_json FROM project_stage_revisions
                    WHERE project_id = ? AND stage = 3 AND revision_id <> ?
                    ORDER BY revision DESC""",
                (project_id, revision_id),
            ).fetchall()
            compatible = []
            for row in revisions:
                document = json.loads(row["data_json"] or "{}").get("document")
                if isinstance(document, dict) and json.dumps(
                    document, ensure_ascii=False, sort_keys=True, separators=(",", ":")
                ) == target_fingerprint:
                    compatible.append(row["revision_id"])

            copied = 0
            sources = []
            for artifact_type in media_types:
                existing = connection.execute(
                    """SELECT 1 FROM artifacts WHERE project_id = ? AND revision_id = ?
                         AND artifact_type = ? AND status = 'active' LIMIT 1""",
                    (project_id, revision_id, artifact_type),
                ).fetchone()
                if existing:
                    continue
                for source_revision_id in compatible:
                    rows = connection.execute(
                        """SELECT scene_id, uri, checksum, metadata_json, created_at
                             FROM artifacts WHERE project_id = ? AND revision_id = ?
                              AND artifact_type = ? AND status = 'active'
                             ORDER BY created_at ASC""",
                        (project_id, source_revision_id, artifact_type),
                    ).fetchall()
                    if not rows:
                        continue
                    for row in rows:
                        connection.execute(
                            """INSERT INTO artifacts
                               (artifact_id, project_id, revision_id, scene_id, artifact_type,
                                uri, checksum, metadata_json, status, created_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)""",
                            (str(uuid.uuid4()), project_id, revision_id, row["scene_id"],
                             artifact_type, row["uri"], row["checksum"],
                             row["metadata_json"], row["created_at"]),
                        )
                        copied += 1
                    sources.append(source_revision_id)
                    break
            connection.commit()
        return {"copied": copied, "source_revision_ids": list(dict.fromkeys(sources))}

    def confirm_stage_revision(self, user_id: str, project_id: str, revision_id: str) -> dict:
        if not self.get_project(user_id, project_id):
            raise ValueError("이 프로젝트에 접근할 수 없습니다.")
        now = _now().isoformat()
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT stage FROM project_stage_revisions WHERE revision_id = ? AND project_id = ?",
                (revision_id, project_id),
            ).fetchone()
            if not row:
                raise ValueError("확정할 단계 데이터를 찾을 수 없습니다.")
            connection.execute(
                """UPDATE project_stage_revisions
                   SET status = 'superseded'
                   WHERE project_id = ? AND stage = ? AND status = 'confirmed'""",
                (project_id, row["stage"]),
            )
            connection.execute(
                """UPDATE project_stage_revisions
                   SET status = 'confirmed', confirmed_at = ?
                   WHERE revision_id = ?""",
                (now, revision_id),
            )
            connection.execute("UPDATE projects SET updated_at = ? WHERE project_id = ?", (now, project_id))
            connection.commit()
        return {"revision_id": revision_id, "project_id": project_id,
                "stage": int(row["stage"]), "status": "confirmed"}

    def save_stage_candidate(self, user_id: str, project_id: str, stage: int,
                             data: dict, schema_version: str = "1.0.0") -> dict:
        if not self.get_project(user_id, project_id):
            raise ValueError("이 프로젝트에 접근할 수 없습니다.")
        candidate_id = str(uuid.uuid4())
        with closing(self._connect()) as connection:
            connection.execute(
                """INSERT INTO stage_candidates
                   (candidate_id, project_id, stage, schema_version, data_json, status, created_at)
                   VALUES (?, ?, ?, ?, ?, 'draft', ?)""",
                (candidate_id, project_id, stage, schema_version,
                 json.dumps(data, ensure_ascii=False, sort_keys=True), _now().isoformat()),
            )
            connection.commit()
        return {"candidate_id": candidate_id, "project_id": project_id,
                "stage": stage, "status": "draft"}

    def register_artifact(self, user_id: str, project_id: str, revision_id: str,
                          scene_id: str, artifact_type: str, uri: str,
                          checksum: str, metadata: dict) -> dict:
        if not self.get_project(user_id, project_id):
            raise ValueError("이 프로젝트에 접근할 수 없습니다.")
        with closing(self._connect()) as connection:
            existing = connection.execute(
                """SELECT artifact_id FROM artifacts
                   WHERE project_id = ? AND revision_id = ? AND scene_id IS ?
                     AND artifact_type = ? AND uri = ? AND status = 'active'""",
                (project_id, revision_id, scene_id, artifact_type, uri),
            ).fetchone()
            if existing:
                return {"artifact_id": existing["artifact_id"], "uri": uri, "reused": True}
            artifact_id = str(uuid.uuid4())
            connection.execute(
                """INSERT INTO artifacts
                   (artifact_id, project_id, revision_id, scene_id, artifact_type, uri,
                    checksum, metadata_json, status, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)""",
                (artifact_id, project_id, revision_id, scene_id, artifact_type, uri,
                 checksum, json.dumps(metadata, ensure_ascii=False, sort_keys=True), _now().isoformat()),
            )
            connection.commit()
        return {"artifact_id": artifact_id, "uri": uri, "reused": False}

    def register_final_export(self, user_id: str, project_id: str, revision_id: str,
                              uri: str, checksum: str, metadata: dict,
                              local_date: str, platforms: list[str],
                              created_at: str | None = None) -> dict:
        project = self.get_project(user_id, project_id)
        if not project:
            raise ValueError("이 프로젝트에 접근할 수 없습니다.")
        created_at = created_at or _now().isoformat()
        clean_platforms = list(dict.fromkeys(str(item) for item in platforms if str(item)))
        if not clean_platforms:
            raise ValueError("최종 영상의 배포 플랫폼이 없습니다.")
        with closing(self._connect()) as connection:
            existing = connection.execute(
                """SELECT artifact_id FROM artifacts
                   WHERE project_id = ? AND revision_id = ? AND scene_id IS NULL
                     AND artifact_type = 'final_video' AND uri = ? AND status = 'active'""",
                (project_id, revision_id, uri),
            ).fetchone()
            artifact_id = existing["artifact_id"] if existing else str(uuid.uuid4())
            if not existing:
                connection.execute(
                    """INSERT INTO artifacts
                       (artifact_id, project_id, revision_id, scene_id, artifact_type, uri,
                        checksum, metadata_json, status, created_at)
                       VALUES (?, ?, ?, NULL, 'final_video', ?, ?, ?, 'active', ?)""",
                    (artifact_id, project_id, revision_id, uri, checksum,
                     json.dumps(metadata, ensure_ascii=False, sort_keys=True), created_at),
                )
            version = {
                "artifact_id": artifact_id, "url": uri,
                "filename": metadata.get("filename", Path(urlparse(uri).path).name),
                "createdAt": created_at,
            }
            for platform in clean_platforms:
                publication = connection.execute(
                    """SELECT publication_id, settings_json FROM publications
                       WHERE project_id = ? AND local_date = ? AND platform = ?""",
                    (project_id, local_date, platform),
                ).fetchone()
                settings = json.loads(publication["settings_json"] or "{}") if publication else {}
                versions = settings.get("contentVersions") if isinstance(settings.get("contentVersions"), list) else []
                if not any(item.get("artifact_id") == artifact_id for item in versions if isinstance(item, dict)):
                    versions.append(version)
                settings.update({
                    "contentUrl": uri, "filename": version["filename"],
                    "contentVersions": versions, "artifact_id": artifact_id,
                })
                if publication:
                    connection.execute(
                        """UPDATE publications SET status = 'draft', settings_json = ?, updated_at = ?
                           WHERE publication_id = ?""",
                        (json.dumps(settings, ensure_ascii=False, sort_keys=True), created_at,
                         publication["publication_id"]),
                    )
                else:
                    connection.execute(
                        """INSERT INTO publications
                           (publication_id, project_id, local_date, platform, status,
                            settings_json, created_at, updated_at)
                           VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)""",
                        (str(uuid.uuid4()), project_id, local_date, platform,
                         json.dumps(settings, ensure_ascii=False, sort_keys=True),
                         created_at, created_at),
                    )
            connection.commit()
        return {"artifact_id": artifact_id, "uri": uri, "reused": bool(existing)}

    def list_calendar_entries(self, user_id: str) -> list[dict]:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """SELECT pub.publication_id, pub.project_id, pub.local_date, pub.platform,
                          pub.status, pub.settings_json, pub.created_at, pub.updated_at, p.name
                     FROM publications pub JOIN projects p ON p.project_id = pub.project_id
                    WHERE p.owner_user_id = ? ORDER BY pub.local_date, pub.created_at""",
                (user_id,),
            ).fetchall()
        entries = []
        for row in rows:
            settings = json.loads(row["settings_json"] or "{}")
            end_date = (datetime.fromisoformat(row["local_date"]).date() + timedelta(days=1)).isoformat()
            entries.append({
                "id": row["publication_id"], "title": row["name"],
                "start": row["local_date"], "end": end_date, "allDay": True,
                "extendedProps": {
                    "status": row["status"], "platform": row["platform"],
                    "projectId": row["project_id"], "createdAt": row["updated_at"],
                    **settings,
                },
            })
        return entries

    def add_brand_asset_version(self, user_id: str, role: str, name: str, uri: str,
                                media_type: str, mime_type: str) -> dict:
        if role not in {"intro", "outro", "watermark"}:
            raise ValueError("브랜드 리소스 종류가 올바르지 않습니다.")
        if role == "watermark" and (media_type != "image" or mime_type != "image/png"):
            raise ValueError("워터마크는 투명 PNG만 사용할 수 있습니다.")
        now = _now().isoformat()
        with closing(self._connect()) as connection:
            asset = connection.execute(
                "SELECT asset_id FROM brand_assets WHERE user_id = ? AND role = ? AND name = ?",
                (user_id, role, name),
            ).fetchone()
            asset_id = asset["asset_id"] if asset else str(uuid.uuid4())
            if not asset:
                connection.execute(
                    "INSERT INTO brand_assets VALUES (?, ?, ?, ?, ?)",
                    (asset_id, user_id, role, name, now),
                )
            version = connection.execute(
                "SELECT COALESCE(MAX(version), 0) + 1 FROM brand_asset_versions WHERE asset_id = ?",
                (asset_id,),
            ).fetchone()[0]
            version_id = str(uuid.uuid4())
            connection.execute(
                """INSERT INTO brand_asset_versions
                   (version_id, asset_id, version, uri, media_type, mime_type, active, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, 1, ?)""",
                (version_id, asset_id, version, uri, media_type, mime_type, now),
            )
            connection.commit()
        return {"asset_id": asset_id, "version_id": version_id, "version": version}

    def list_brand_assets(self, user_id: str) -> list[dict]:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """SELECT a.asset_id, a.role, a.name, v.version_id, v.version, v.uri,
                          v.media_type, v.mime_type, v.active, v.created_at
                     FROM brand_assets a JOIN brand_asset_versions v ON v.asset_id = a.asset_id
                    WHERE a.user_id = ? ORDER BY a.role, a.name, v.version DESC""",
                (user_id,),
            ).fetchall()
            variants = connection.execute(
                """SELECT bv.variant_id, bv.version_id, bv.format, bv.uri, bv.width, bv.height,
                          bv.media_type, bv.mime_type, bv.checksum
                     FROM brand_asset_variants bv JOIN brand_asset_versions v ON v.version_id=bv.version_id
                     JOIN brand_assets a ON a.asset_id=v.asset_id
                    WHERE a.user_id=? ORDER BY bv.version_id, bv.format""",
                (user_id,),
            ).fetchall()
        grouped = {}
        for variant in variants:
            grouped.setdefault(variant["version_id"], []).append(dict(variant))
        return [{**dict(row), "active": bool(row["active"]), "variants": grouped.get(row["version_id"], [])} for row in rows]

    def resolve_brand_variant(self, user_id: str, version_id: str, format: str) -> dict | None:
        if format not in {"16x9", "9x16", "4x5", "1x1"}:
            raise ValueError("브랜드 비율이 올바르지 않습니다.")
        with closing(self._connect()) as connection:
            row = connection.execute(
                """SELECT bv.variant_id, bv.version_id, bv.format, bv.uri, bv.width, bv.height,
                          bv.media_type, bv.mime_type, bv.checksum
                     FROM brand_asset_variants bv
                     JOIN brand_asset_versions v ON v.version_id=bv.version_id
                     JOIN brand_assets a ON a.asset_id=v.asset_id
                    WHERE bv.version_id=? AND bv.format=? AND a.user_id=? AND v.active=1""",
                (version_id, format, user_id),
            ).fetchone()
        return dict(row) if row else None

    def add_brand_asset_variant(self, user_id: str, version_id: str, format: str, uri: str,
                                width: int, height: int, media_type: str, checksum: str,
                                mime_type: str | None = None, variant_id: str | None = None) -> dict:
        ratios = {"16x9": (16, 9), "9x16": (9, 16), "4x5": (4, 5), "1x1": (1, 1)}
        if format not in ratios:
            raise ValueError("브랜드 비율이 올바르지 않습니다.")
        if type(width) is not int or type(height) is not int or width < 1 or height < 1:
            raise ValueError("브랜드 치수가 올바르지 않습니다.")
        ratio_width, ratio_height = ratios[format]
        if width * ratio_height != height * ratio_width:
            raise ValueError("브랜드 치수가 선택한 비율과 일치하지 않습니다.")
        if media_type not in {"image", "video"} or not str(uri).strip() or not str(checksum).strip():
            raise ValueError("브랜드 변형 메타데이터가 올바르지 않습니다.")
        now = _now().isoformat()
        variant_id = variant_id or str(uuid.uuid4())
        with closing(self._connect()) as connection:
            owned = connection.execute(
                """SELECT 1 FROM brand_asset_versions v JOIN brand_assets a ON a.asset_id=v.asset_id
                    WHERE v.version_id=? AND a.user_id=? AND v.active=1""", (version_id, user_id)
            ).fetchone()
            if not owned:
                raise ValueError("선택할 수 없는 브랜드 리소스 버전입니다.")
            try:
                connection.execute(
                    """INSERT INTO brand_asset_variants
                       (variant_id,version_id,format,uri,width,height,media_type,mime_type,checksum,created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?)""",
                    (variant_id, version_id, format, str(uri).strip(), width, height, media_type,
                     str(mime_type).strip() if mime_type else None, str(checksum).strip(), now),
                )
            except sqlite3.IntegrityError as exc:
                raise ValueError("이미 등록된 브랜드 비율 변형입니다.") from exc
            connection.commit()
        return self.resolve_brand_variant(user_id, version_id, format) or {}

    def save_content_brand_selections(self, user_id: str, project_id: str | None,
                                      selections: list[dict]) -> list[dict]:
        now = _now().isoformat()
        with closing(self._connect()) as connection:
            if project_id and not connection.execute(
                "SELECT 1 FROM projects WHERE project_id=? AND owner_user_id=?", (project_id, user_id)
            ).fetchone():
                raise ValueError("선택할 수 없는 프로젝트입니다.")
            for item in selections:
                role = str(item.get("role", ""))
                raw_version_id = item.get("version_id")
                version_id = str(raw_version_id).strip() if raw_version_id else None
                if role not in {"intro", "outro", "watermark"}:
                    raise ValueError("브랜드 선택 종류가 올바르지 않습니다.")
                if version_id:
                    owned = connection.execute(
                        """SELECT 1 FROM brand_asset_versions v JOIN brand_assets a ON a.asset_id=v.asset_id
                            WHERE v.version_id=? AND a.user_id=? AND a.role=? AND v.active=1""",
                        (version_id, user_id, role),
                    ).fetchone()
                    if not owned:
                        raise ValueError("선택할 수 없는 브랜드 리소스 버전입니다.")
                settings = item.get("settings") if isinstance(item.get("settings"), dict) else {}
                profiles = settings.get("profiles") if isinstance(settings.get("profiles"), dict) else {}
                for format, profile in profiles.items():
                    if format not in {"16x9", "9x16", "4x5", "1x1"} or not isinstance(profile, dict):
                        raise ValueError("비율별 브랜드 리소스 형식이 올바르지 않습니다.")
                    profile_variant_id = str(profile.get("variant_id", "")).strip()
                    profile_version_id = str(profile.get("version_id", "")).strip()
                    if profile_variant_id:
                        owned_variant = connection.execute(
                            """SELECT 1 FROM brand_asset_variants bv
                                JOIN brand_asset_versions v ON v.version_id=bv.version_id
                                JOIN brand_assets a ON a.asset_id=v.asset_id
                               WHERE bv.variant_id=? AND bv.version_id=? AND bv.format=? AND a.user_id=? AND v.active=1""",
                            (profile_variant_id, version_id or profile_version_id, format, user_id),
                        ).fetchone()
                        if not owned_variant:
                            raise ValueError("선택할 수 없는 브랜드 비율 변형입니다.")
                        continue
                    if not profile_version_id:
                        continue
                    owned_profile = connection.execute(
                        """SELECT 1 FROM brand_asset_versions v JOIN brand_assets a ON a.asset_id=v.asset_id
                            WHERE v.version_id=? AND a.user_id=? AND a.role=? AND v.active=1""",
                            (profile_version_id, user_id, role),
                    ).fetchone()
                    if not owned_profile:
                        raise ValueError("비율별 브랜드 리소스 버전을 선택할 수 없습니다.")
                connection.execute(
                    """INSERT INTO user_brand_selections
                       (user_id, role, enabled, version_id, settings_json, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?)
                       ON CONFLICT(user_id, role) DO UPDATE SET
                         enabled=excluded.enabled, version_id=excluded.version_id,
                         settings_json=excluded.settings_json, updated_at=excluded.updated_at""",
                    (user_id, role, int(bool(item.get("enabled") and version_id)), version_id,
                     json.dumps(settings, ensure_ascii=False, sort_keys=True), now),
                )
            connection.commit()
        return self.content_brand_selections(user_id, project_id)

    def content_brand_selections(self, user_id: str, project_id: str | None = None) -> list[dict]:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """SELECT s.role, s.enabled, s.version_id, s.settings_json,
                          v.uri, v.media_type, v.mime_type, v.version, a.name
                     FROM user_brand_selections s
                     LEFT JOIN brand_asset_versions v ON v.version_id=s.version_id
                     LEFT JOIN brand_assets a ON a.asset_id=v.asset_id
                    WHERE s.user_id=?""",
                (user_id,),
            ).fetchall()
            assets = {row["version_id"]: dict(row) for row in connection.execute(
                """SELECT v.version_id, v.uri, v.media_type, v.mime_type
                     FROM brand_asset_versions v JOIN brand_assets a ON a.asset_id=v.asset_id
                    WHERE a.user_id=? AND v.active=1""", (user_id,)
            ).fetchall()}
        results = []
        for row in rows:
            settings = json.loads(row["settings_json"] or "{}")
            profiles = settings.get("profiles") if isinstance(settings.get("profiles"), dict) else {}
            with closing(self._connect()) as variant_connection:
                for format, profile in profiles.items():
                    if not isinstance(profile, dict):
                        continue
                    variant_id = str(profile.get("variant_id", "")).strip()
                    variant = None
                    if variant_id:
                        variant = variant_connection.execute(
                            """SELECT bv.variant_id, bv.uri, bv.media_type, bv.mime_type,
                                      bv.width, bv.height, bv.checksum, bv.format
                                 FROM brand_asset_variants bv JOIN brand_asset_versions v ON v.version_id=bv.version_id
                                 JOIN brand_assets a ON a.asset_id=v.asset_id
                                WHERE bv.variant_id=? AND a.user_id=? AND v.active=1""",
                            (variant_id, user_id),
                        ).fetchone()
                    elif format in {"16x9", "9x16", "4x5", "1x1"} and row["version_id"]:
                        variant = variant_connection.execute(
                            """SELECT bv.variant_id, bv.uri, bv.media_type, bv.mime_type,
                                      bv.width, bv.height, bv.checksum, bv.format
                                 FROM brand_asset_variants bv JOIN brand_asset_versions v ON v.version_id=bv.version_id
                                 JOIN brand_assets a ON a.asset_id=v.asset_id
                                WHERE bv.version_id=? AND bv.format=? AND a.user_id=? AND v.active=1""",
                            (row["version_id"], format, user_id),
                        ).fetchone()
                    if variant:
                        profile.update(dict(variant))
                        continue
                    profile_version_id = str(profile.get("version_id", "")).strip()
                    if not profile_version_id:
                        continue
                    asset = assets.get(profile_version_id)
                    if asset:
                        profile.update({key: asset[key] for key in ("uri", "media_type", "mime_type")})
            # Keep the legacy flat fields and settings shape intact for existing clients.
            if not isinstance(settings, dict):
                continue
            results.append({**dict(row), "enabled": bool(row["enabled"]), "settings": settings})
        return results

    def snapshot_final_export_brand_assets(self, artifact_id: str,
                                           selections: list[dict]) -> None:
        with closing(self._connect()) as connection:
            for item in selections:
                if not item.get("enabled") or not item.get("version_id"):
                    continue
                connection.execute(
                    """INSERT OR REPLACE INTO final_export_brand_assets
                       (artifact_id, role, version_id, settings_json) VALUES (?, ?, ?, ?)""",
                    (artifact_id, item["role"], item["version_id"],
                     json.dumps(item.get("settings") or {}, ensure_ascii=False, sort_keys=True)),
                )
            connection.commit()

    def consolidate_production_calendar(self, user_id: str, project_id: str,
                                        local_date: str, completed_at: str) -> None:
        if not self.get_project(user_id, project_id):
            raise ValueError("이 프로젝트에 접근할 수 없습니다.")
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """SELECT * FROM publications
                    WHERE project_id = ? AND status = 'draft'
                    ORDER BY updated_at, created_at""",
                (project_id,),
            ).fetchall()
            grouped = {}
            for row in rows:
                grouped.setdefault(row["platform"], []).append(row)
            if not grouped:
                return
            connection.execute(
                "DELETE FROM publications WHERE project_id = ? AND status = 'draft'",
                (project_id,),
            )
            for platform, platform_rows in grouped.items():
                versions = []
                seen = set()
                for row in platform_rows:
                    settings = json.loads(row["settings_json"] or "{}")
                    candidates = settings.get("contentVersions") or []
                    for version in candidates:
                        key = version.get("artifact_id") or version.get("url")
                        if key and key not in seen:
                            versions.append(version);seen.add(key)
                latest_row = platform_rows[-1]
                latest_settings = json.loads(latest_row["settings_json"] or "{}")
                latest_settings["contentVersions"] = versions
                connection.execute(
                    """INSERT INTO publications
                       (publication_id, project_id, local_date, platform, status,
                        settings_json, created_at, updated_at)
                       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)""",
                    (latest_row["publication_id"], project_id, local_date, platform,
                     json.dumps(latest_settings, ensure_ascii=False, sort_keys=True),
                     min(row["created_at"] for row in platform_rows), completed_at),
                )
            connection.commit()

    def list_scene_images(self, user_id: str, project_id: str, revision_id: str) -> list[dict]:
        if not self.get_project(user_id, project_id):
            raise ValueError("이 프로젝트에 접근할 수 없습니다.")
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """SELECT artifact_id, scene_id, uri, metadata_json, created_at
                     FROM artifacts
                    WHERE project_id = ? AND revision_id = ?
                      AND artifact_type = 'scene_image_candidate' AND status = 'active'
                    ORDER BY created_at DESC""",
                (project_id, revision_id),
            ).fetchall()
            usage_rows = connection.execute(
                """SELECT provider_response_id, input_tokens, output_tokens, total_tokens
                     FROM api_usage_events
                    WHERE user_id = ? AND project_id = ?
                      AND operation = 'scene_reference_image_generation'""",
                (user_id, project_id),
            ).fetchall()
        usage_by_response = {row["provider_response_id"]: dict(row) for row in usage_rows}
        images = []
        seen_scenes = set()
        selected_rows = []
        fallback_rows = []
        for row in rows:
            metadata = json.loads(row["metadata_json"] or "{}")
            (selected_rows if metadata.get("selected") is True else fallback_rows).append(row)
        for row in selected_rows + fallback_rows:
            if row["scene_id"] in seen_scenes:
                continue
            metadata = json.loads(row["metadata_json"] or "{}")
            usage = usage_by_response.get(metadata.get("request_id"), {})
            images.append({
                "artifact_id": row["artifact_id"], "scene_id": row["scene_id"],
                "uri": row["uri"], "model": metadata.get("model", ""),
                "usage": {key: int(usage.get(key, 0)) for key in
                          ("input_tokens", "output_tokens", "total_tokens")},
            })
            seen_scenes.add(row["scene_id"])
        return images

    def list_scene_image_candidates(self, user_id: str, project_id: str,
                                    revision_id: str) -> list[dict]:
        if not self.get_project(user_id, project_id):
            raise ValueError("이 프로젝트에 접근할 수 없습니다.")
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """SELECT artifact_id, scene_id, uri, metadata_json, created_at
                     FROM artifacts
                    WHERE project_id = ? AND revision_id = ?
                      AND artifact_type = 'scene_image_candidate' AND status = 'active'
                    ORDER BY created_at ASC""",
                (project_id, revision_id),
            ).fetchall()
        return [{
            "artifact_id": row["artifact_id"], "scene_id": row["scene_id"],
            "uri": row["uri"], "model": json.loads(row["metadata_json"] or "{}").get("model", ""),
            "selected": json.loads(row["metadata_json"] or "{}").get("selected") is True,
        } for row in rows]

    def select_scene_image(self, user_id: str, project_id: str, revision_id: str,
                           scene_id: str, artifact_id: str) -> dict:
        if not self.get_project(user_id, project_id):
            raise ValueError("이 프로젝트에 접근할 수 없습니다.")
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """SELECT artifact_id, uri, metadata_json FROM artifacts
                    WHERE project_id = ? AND revision_id = ? AND scene_id = ?
                      AND artifact_type = 'scene_image_candidate' AND status = 'active'""",
                (project_id, revision_id, scene_id),
            ).fetchall()
            selected = next((row for row in rows if row["artifact_id"] == artifact_id), None)
            if not selected:
                raise ValueError("선택할 이미지 후보를 찾을 수 없습니다.")
            for row in rows:
                metadata = json.loads(row["metadata_json"] or "{}")
                metadata["selected"] = row["artifact_id"] == artifact_id
                connection.execute("UPDATE artifacts SET metadata_json = ? WHERE artifact_id = ?",
                                   (json.dumps(metadata, ensure_ascii=False, sort_keys=True), row["artifact_id"]))
            connection.execute(
                """UPDATE artifacts SET status = 'invalidated', invalidated_at = ?
                    WHERE project_id = ? AND revision_id = ? AND scene_id = ?
                      AND artifact_type = 'scene_video' AND status = 'active'""",
                (_now().isoformat(), project_id, revision_id, scene_id),
            )
            connection.commit()
        return {"artifact_id": artifact_id, "scene_id": scene_id, "uri": selected["uri"]}

    def list_scene_voice_clips(self, user_id: str, project_id: str, revision_id: str) -> list[dict]:
        if not self.get_project(user_id, project_id):
            raise ValueError("이 프로젝트에 접근할 수 없습니다.")
        with closing(self._connect()) as connection:
            revision = connection.execute('SELECT data_json FROM project_stage_revisions WHERE project_id=? AND revision_id=?', (project_id, revision_id)).fetchone()
            rows = connection.execute(
                """SELECT artifact_id, scene_id, uri, metadata_json, created_at
                     FROM artifacts
                    WHERE project_id = ? AND revision_id = ?
                      AND artifact_type = 'narration_wav' AND status = 'active'
                    ORDER BY created_at DESC""",
                (project_id, revision_id),
            ).fetchall()
        revision_data = json.loads(revision['data_json']) if revision else {}
        document = revision_data.get('document', {})
        selected_profile = revision_data.get('voice_profile')
        cue_scenes = {}
        for scene in document.get('production', {}).get('timeline', {}).get('scenes', []):
            for cue_id in scene.get('narration_cue_ids', []):
                cue_scenes.setdefault(str(cue_id), []).append(scene['id'])
        clips = []
        seen_cues = set()
        for row in rows:
            metadata = json.loads(row["metadata_json"] or "{}")
            profile_id = parse_qs(urlparse(row["uri"]).query).get("profile", [""])[0]
            if selected_profile and profile_id != selected_profile:continue
            cue_id = metadata.get('cue_id')
            key = (cue_id or row['scene_id'], profile_id)
            if key in seen_cues:continue
            linked = cue_scenes.get(str(cue_id), [row['scene_id']])
            clips.append({
                "artifact_id": row["artifact_id"], "scene_id": linked[0],
                "cue_id": cue_id, "scene_ids": linked, "text_hash": metadata.get('text_hash'),
                "uri": row["uri"], "profile_id": profile_id,
                "duration": metadata.get("duration"), "model": metadata.get("model", ""),
                "usage": metadata.get("usage") or {
                    "input_tokens": 0, "output_tokens": 0, "total_tokens": 0,
                },
            })
            seen_cues.add(key)
        return clips

    def list_scene_videos(self, user_id: str, project_id: str, revision_id: str) -> list[dict]:
        if not self.get_project(user_id, project_id):
            raise ValueError("이 프로젝트에 접근할 수 없습니다.")
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """SELECT artifact_id, scene_id, uri, metadata_json, created_at
                     FROM artifacts
                    WHERE project_id = ? AND revision_id = ?
                      AND artifact_type = 'scene_video' AND status = 'active'
                    ORDER BY created_at DESC""",
                (project_id, revision_id),
            ).fetchall()
        videos = []
        seen_scenes = set()
        selected_rows = []
        fallback_rows = []
        for row in rows:
            metadata = json.loads(row["metadata_json"] or "{}")
            (selected_rows if metadata.get("selected") is True else fallback_rows).append(row)
        for row in selected_rows + fallback_rows:
            if row["scene_id"] in seen_scenes:
                continue
            metadata = json.loads(row["metadata_json"] or "{}")
            videos.append({
                "artifact_id": row["artifact_id"], "scene_id": row["scene_id"],
                "uri": row["uri"], "model": metadata.get("model", ""),
                "task_id": metadata.get("task_id", ""), "duration": metadata.get("duration"),
                "provider_duration": metadata.get("provider_duration"),
                "playback_rate": metadata.get("playback_rate", 1),
            })
            seen_scenes.add(row["scene_id"])
        return videos

    def list_scene_video_candidates(self, user_id: str, project_id: str,
                                    revision_id: str) -> list[dict]:
        if not self.get_project(user_id, project_id):
            raise ValueError("이 프로젝트에 접근할 수 없습니다.")
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """SELECT artifact_id, scene_id, uri, metadata_json, created_at
                     FROM artifacts
                    WHERE project_id = ? AND revision_id = ?
                      AND artifact_type = 'scene_video' AND status = 'active'
                    ORDER BY created_at ASC""",
                (project_id, revision_id),
            ).fetchall()
        return [{
            "artifact_id": row["artifact_id"], "scene_id": row["scene_id"],
            "uri": row["uri"], "model": json.loads(row["metadata_json"] or "{}").get("model", ""),
            "duration": json.loads(row["metadata_json"] or "{}").get("duration"),
            "provider_duration": json.loads(row["metadata_json"] or "{}").get("provider_duration"),
            "playback_rate": json.loads(row["metadata_json"] or "{}").get("playback_rate", 1),
            "selected": json.loads(row["metadata_json"] or "{}").get("selected") is True,
        } for row in rows]

    def select_scene_video(self, user_id: str, project_id: str, revision_id: str,
                           scene_id: str, artifact_id: str) -> dict:
        if not self.get_project(user_id, project_id):
            raise ValueError("이 프로젝트에 접근할 수 없습니다.")
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """SELECT artifact_id, uri, metadata_json FROM artifacts
                    WHERE project_id = ? AND revision_id = ? AND scene_id = ?
                      AND artifact_type = 'scene_video' AND status = 'active'""",
                (project_id, revision_id, scene_id),
            ).fetchall()
            selected = next((row for row in rows if row["artifact_id"] == artifact_id), None)
            if not selected:
                raise ValueError("선택할 영상 후보를 찾을 수 없습니다.")
            for row in rows:
                metadata = json.loads(row["metadata_json"] or "{}")
                metadata["selected"] = row["artifact_id"] == artifact_id
                connection.execute("UPDATE artifacts SET metadata_json = ? WHERE artifact_id = ?",
                                   (json.dumps(metadata, ensure_ascii=False, sort_keys=True), row["artifact_id"]))
            connection.commit()
        return {"artifact_id": artifact_id, "scene_id": scene_id, "uri": selected["uri"]}

    def recent_group_documents(self, user_id: str, project_id: str,
                               selected_keywords: list[str], limit: int = 5) -> list[dict]:
        project = self.get_project(user_id, project_id)
        if not project:
            raise ValueError("이 프로젝트에 접근할 수 없습니다.")
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """SELECT sc.data_json
                   FROM stage_candidates sc
                   JOIN projects p ON p.project_id = sc.project_id
                   JOIN group_members gm ON gm.group_id = p.group_id AND gm.user_id = ?
                   WHERE p.group_id = ? AND sc.stage = 3 AND sc.project_id <> ?
                   ORDER BY sc.created_at DESC LIMIT 50""",
                (user_id, project["group_id"], project_id),
            ).fetchall()
        expected = list(selected_keywords)
        documents = []
        for row in rows:
            payload = json.loads(row["data_json"])
            document = payload.get("document")
            if isinstance(document, dict) and document.get("project", {}).get("selected_keywords") == expected:
                documents.append(document)
                if len(documents) >= limit:
                    break
        return documents

    def recent_group_visual_usage(self, user_id: str, project_id: str, limit: int = 12) -> list[dict]:
        """Recent group-wide cast/location choices, not limited to matching keywords."""
        project = self.get_project(user_id, project_id)
        if not project:
            raise ValueError("이 프로젝트에 접근할 수 없습니다.")
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """SELECT sc.data_json FROM stage_candidates sc
                   JOIN projects p ON p.project_id = sc.project_id
                   JOIN group_members gm ON gm.group_id = p.group_id AND gm.user_id = ?
                   WHERE p.group_id = ? AND sc.stage = 3 AND sc.project_id <> ?
                   ORDER BY sc.created_at DESC LIMIT ?""",
                (user_id, project["group_id"], project_id, limit),
            ).fetchall()
        result = []
        for row in rows:
            document = json.loads(row["data_json"]).get("document")
            if not isinstance(document, dict):
                continue
            production = document.get("production") or {}
            assets = {item.get("id"): item for item in production.get("reference_assets", [])}
            used = {ref for scene in production.get("timeline", {}).get("scenes", [])
                    for ref in scene.get("reference_ids", [])}
            result.append({"title": document.get("project", {}).get("title", ""),
                           "assets": [{"kind": assets[ref].get("kind", ""),
                                       "name": assets[ref].get("display_name", ""),
                                       "uri": assets[ref].get("uri", "")}
                                      for ref in used if ref in assets]})
        return result

    def latest_script_plan(self, user_id: str, project_id: str, selected_keywords: list[str]) -> dict | None:
        if not self.get_project(user_id, project_id):
            raise ValueError("이 프로젝트에 접근할 수 없습니다.")
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """SELECT data_json FROM stage_candidates
                   WHERE project_id = ? AND stage = 3 ORDER BY created_at DESC LIMIT 20""",
                (project_id,),
            ).fetchall()
        for row in rows:
            data = json.loads(row["data_json"])
            if data.get("kind") == "script_plan" and data.get("selected_keywords") == selected_keywords:
                return data
        return None

    def ensure_project(self, user_id: str, project_id: str, name: str) -> dict:
        now = _now().isoformat()
        group = self.personal_group(user_id)
        with closing(self._connect()) as connection:
            connection.execute(
                """INSERT OR IGNORE INTO projects
                   (project_id, owner_user_id, group_id, name, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (project_id, user_id, group["group_id"], name, now, now),
            )
            row = connection.execute(
                "SELECT project_id, owner_user_id, group_id, name FROM projects WHERE project_id = ? AND owner_user_id = ?",
                (project_id, user_id),
            ).fetchone()
            connection.commit()
        if not row:
            raise ValueError("이 프로젝트에 접근할 수 없습니다.")
        return dict(row)

    def create_project(self, user_id: str, name: str = "새 콘텐츠") -> dict:
        name = name.strip()[:100] or "새 콘텐츠"
        now = _now().isoformat()
        project_id = str(uuid.uuid4())
        group = self.personal_group(user_id)
        with closing(self._connect()) as connection:
            connection.execute(
                """INSERT INTO projects
                   (project_id, owner_user_id, group_id, name, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (project_id, user_id, group["group_id"], name, now, now),
            )
            connection.commit()
        return {
            "project_id": project_id,
            "owner_user_id": user_id,
            "group_id": group["group_id"],
            "name": name,
            "current_stage": 2,
            "status": "progress",
            "created_at": now,
            "updated_at": now,
        }

    def update_project_name(self, user_id: str, project_id: str, name: str) -> dict:
        name = name.strip()[:100]
        if not name:
            raise ValueError("콘텐츠 제목을 입력해 주세요.")
        now = _now().isoformat()
        with closing(self._connect()) as connection:
            cursor = connection.execute(
                """UPDATE projects SET name = ?, updated_at = ?
                   WHERE project_id = ? AND owner_user_id = ?""",
                (name, now, project_id, user_id),
            )
            if cursor.rowcount != 1:
                raise ValueError("이 프로젝트에 접근할 수 없습니다.")
            connection.commit()
        return {"project_id": project_id, "name": name, "updated_at": now}

    def project_deletion_snapshot(self, user_id: str, project_id: str) -> dict | None:
        with closing(self._connect()) as connection:
            owned = connection.execute(
                "SELECT 1 FROM projects WHERE project_id = ? AND owner_user_id = ?",
                (project_id, user_id),
            ).fetchone()
            if not owned:
                return None
            artifacts = [dict(row) for row in connection.execute(
                "SELECT artifact_id, uri FROM artifacts WHERE project_id = ?",
                (project_id,),
            )]
            counts = {
                row["uri"]: row["count"] for row in connection.execute(
                    "SELECT uri, COUNT(*) AS count FROM artifacts GROUP BY uri"
                )
            }
        return {"artifacts": artifacts, "uri_counts": counts}

    def delete_project(self, user_id: str, project_id: str) -> bool:
        """Delete one owned project and its database-owned dependent records."""
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT project_id FROM projects WHERE project_id = ? AND owner_user_id = ?",
                (project_id, user_id),
            ).fetchone()
            if not row:
                return False
            if connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'automation_runs'"
            ).fetchone():
                connection.execute(
                    "DELETE FROM automation_runs WHERE user_id = ? AND project_id = ?",
                    (user_id, project_id),
                )
            connection.execute(
                """DELETE FROM stage_dependencies
                     WHERE downstream_revision_id IN (
                               SELECT revision_id FROM project_stage_revisions WHERE project_id = ?
                           )
                        OR upstream_revision_id IN (
                               SELECT revision_id FROM project_stage_revisions WHERE project_id = ?
                           )""",
                (project_id, project_id),
            )
            connection.execute(
                "DELETE FROM projects WHERE project_id = ? AND owner_user_id = ?",
                (project_id, user_id),
            )
            connection.commit()
        return True

    def list_projects(self, user_id: str) -> list[dict]:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """SELECT p.project_id, p.owner_user_id, p.group_id, p.name, p.created_at, p.updated_at,
                          ap.status AS automation_status, ap.stage AS automation_stage,
                          ap.error_message AS automation_error_message,
                          ap.endpoint AS automation_endpoint,
                          ap.run_id AS automation_run_id,
                          (ap.project_id IS NOT NULL) AS is_automated,
                          COALESCE((SELECT json_array_length(json_extract(sr.data_json, '$.document.production.timeline.scenes'))
                              FROM project_stage_revisions sr WHERE sr.project_id=p.project_id AND sr.stage=3
                              ORDER BY sr.revision DESC LIMIT 1),0) AS automation_images_total,
                          COALESCE((SELECT json_array_length(json_extract(sr.data_json, '$.document.production.narration_cues'))
                              FROM project_stage_revisions sr WHERE sr.project_id=p.project_id AND sr.stage=3
                              ORDER BY sr.revision DESC LIMIT 1),0) AS automation_voice_total,
                          (SELECT COUNT(DISTINCT a.scene_id) FROM artifacts a
                              WHERE a.project_id=p.project_id AND a.artifact_type='scene_image_candidate' AND a.status='active'
                                AND a.revision_id=(SELECT sr.revision_id FROM project_stage_revisions sr
                                  WHERE sr.project_id=p.project_id AND sr.stage=3 ORDER BY sr.revision DESC LIMIT 1)) AS automation_images_done,
                          (SELECT COUNT(DISTINCT COALESCE(json_extract(a.metadata_json, '$.cue_id'),a.scene_id)) FROM artifacts a
                              WHERE a.project_id=p.project_id AND a.artifact_type='narration_wav' AND a.status='active'
                                AND a.revision_id=(SELECT sr.revision_id FROM project_stage_revisions sr
                                  WHERE sr.project_id=p.project_id AND sr.stage=3 ORDER BY sr.revision DESC LIMIT 1)) AS automation_voice_done,
                          (SELECT sr.data_json
                             FROM project_stage_revisions sr
                            WHERE sr.project_id = p.project_id AND sr.stage = 2
                            ORDER BY sr.revision DESC LIMIT 1) AS keyword_data_json,
                          EXISTS(SELECT 1 FROM artifacts a
                                  WHERE a.project_id = p.project_id
                                    AND a.artifact_type = 'scene_image_candidate'
                                    AND a.status = 'active') AS has_storyboard,
                          EXISTS(SELECT 1 FROM project_stage_revisions sr
                                  WHERE sr.project_id = p.project_id AND sr.stage = 3) AS has_script,
                          EXISTS(SELECT 1 FROM project_stage_revisions sr
                                  WHERE sr.project_id = p.project_id AND sr.stage = 4) AS has_video_design,
                          EXISTS(SELECT 1 FROM artifacts a
                                  WHERE a.project_id = p.project_id
                                    AND a.artifact_type = 'narration_wav'
                                    AND a.status = 'active') AS has_storyboard_voice,
                          COALESCE(MAX(CASE WHEN r.status = 'confirmed' THEN r.stage END), 1) AS last_confirmed_stage
                   FROM projects p
                   LEFT JOIN project_stage_revisions r ON r.project_id = p.project_id
                   LEFT JOIN automated_projects ap ON ap.project_id = p.project_id
                   JOIN group_members gm ON gm.group_id = p.group_id AND gm.user_id = ?
                   WHERE p.owner_user_id = ?
                   GROUP BY p.project_id
                   ORDER BY p.updated_at DESC""",
                (user_id, user_id),
            ).fetchall()
            video_counts = {}
            if connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='automation_steps'"
            ).fetchone():
                video_counts = {
                    row["run_id"]: (int(row["total"] or 0), int(row["done"] or 0))
                    for row in connection.execute(
                        """SELECT runs.run_id,
                                  COALESCE((SELECT json_array_length(json_extract(selection.result_json, '$.value.selected'))
                                      FROM automation_steps selection
                                      WHERE selection.run_id=runs.run_id AND selection.step_key='video_scene_selection'
                                      LIMIT 1),0) AS total,
                                  (SELECT COUNT(*) FROM automation_steps completed
                                      WHERE completed.run_id=runs.run_id
                                        AND completed.step_key LIKE 'video_complete_%'
                                        AND completed.status='succeeded') AS done
                             FROM automated_projects runs"""
                    )
                }
        projects = []
        for row in rows:
            project = dict(row)
            run_id = project.pop("automation_run_id", None)
            video_total, video_done = video_counts.get(run_id, (0, 0))
            project["automation_videos_total"] = video_total
            project["automation_videos_done"] = min(video_done, video_total)
            last_confirmed = int(project.pop("last_confirmed_stage"))
            keyword_data = json.loads(project.pop("keyword_data_json") or "{}")
            project["selected_keywords"] = keyword_data.get("selected_keywords", [])
            project["current_stage"] = (
                5 if last_confirmed >= 4 else
                4 if project["has_video_design"] else
                "3-1" if project["has_storyboard"] or project["has_storyboard_voice"] else
                3 if project["has_script"] else 2
            )
            project["status"] = "completed" if last_confirmed >= 4 else "progress"
            projects.append(project)
        return projects

    def get_project(self, user_id: str, project_id: str) -> dict | None:
        return next(
            (project for project in self.list_projects(user_id) if project["project_id"] == project_id),
            None,
        )

    def scene_crop_positions(self, user_id: str, project_id: str) -> dict:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """SELECT c.scene_id, c.output_format, c.pan_x
                     FROM scene_crop_positions c
                     JOIN projects p ON p.project_id = c.project_id
                    WHERE c.project_id = ? AND p.owner_user_id = ?""",
                (project_id, user_id),
            ).fetchall()
        positions: dict[str, dict[str, float]] = {}
        for row in rows:
            positions.setdefault(row["scene_id"], {})[row["output_format"]] = row["pan_x"]
        return positions

    def save_scene_crop_position(self, user_id: str, project_id: str, scene_id: str,
                                 output_format: str, pan_x: float) -> dict:
        if output_format not in {"9x16", "4x5"}:
            raise ValueError("저장할 수 없는 출력 비율입니다.")
        if not scene_id or len(scene_id) > 100:
            raise ValueError("씬 ID가 올바르지 않습니다.")
        pan_x = max(0.0, min(100.0, float(pan_x)))
        now = _now().isoformat()
        with closing(self._connect()) as connection:
            project = connection.execute(
                "SELECT 1 FROM projects WHERE project_id = ? AND owner_user_id = ?",
                (project_id, user_id),
            ).fetchone()
            if not project:
                raise ValueError("프로젝트를 찾을 수 없습니다.")
            connection.execute(
                """INSERT INTO scene_crop_positions
                       (project_id, scene_id, output_format, pan_x, updated_at)
                     VALUES (?, ?, ?, ?, ?)
                     ON CONFLICT(project_id, scene_id, output_format) DO UPDATE SET
                       pan_x = excluded.pan_x, updated_at = excluded.updated_at""",
                (project_id, scene_id, output_format, pan_x, now),
            )
            connection.execute(
                "UPDATE projects SET updated_at = ? WHERE project_id = ?",
                (now, project_id),
            )
            connection.commit()
        return {"scene_id": scene_id, "format": output_format, "pan_x": pan_x, "updated_at": now}

    def record_api_usage(self, user_id: str, project_id: str, provider: str, model: str,
                         operation: str, response_id: str, usage: dict) -> str:
        usage_id = str(uuid.uuid4())
        with closing(self._connect()) as connection:
            connection.execute(
                """INSERT INTO api_usage_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    usage_id, user_id, project_id, provider, model, operation, response_id,
                    int(usage.get("input_tokens", 0)), int(usage.get("output_tokens", 0)),
                    int(usage.get("total_tokens", 0)), _now().isoformat(),
                ),
            )
            connection.commit()
        return usage_id

    def scene_transition_modes(self, user_id: str, project_id: str) -> dict:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """SELECT t.scene_id, t.mode FROM scene_transition_modes t
                     JOIN projects p ON p.project_id = t.project_id
                    WHERE t.project_id = ? AND p.owner_user_id = ?""", (project_id, user_id),
            ).fetchall()
        return {row["scene_id"]: row["mode"] for row in rows}

    def save_scene_transition_mode(self, user_id: str, project_id: str, scene_id: str, mode: str) -> dict:
        if mode not in {"auto", "connect", "cut"} or not scene_id or len(scene_id) > 100:
            raise ValueError("씬 전환 설정이 올바르지 않습니다.")
        now = _now().isoformat()
        with closing(self._connect()) as connection:
            if not connection.execute("SELECT 1 FROM projects WHERE project_id = ? AND owner_user_id = ?", (project_id, user_id)).fetchone():
                raise ValueError("프로젝트를 찾을 수 없습니다.")
            connection.execute(
                """INSERT INTO scene_transition_modes VALUES (?, ?, ?, ?)
                     ON CONFLICT(project_id, scene_id) DO UPDATE SET mode=excluded.mode, updated_at=excluded.updated_at""",
                (project_id, scene_id, mode, now),
            )
            connection.commit()
        return {"scene_id": scene_id, "mode": mode, "updated_at": now}

    def usage_summary(self, user_id: str, project_id: str | None = None) -> dict:
        where = "user_id = ?"
        values: list[str] = [user_id]
        if project_id:
            where += " AND project_id = ?"
            values.append(project_id)
        with closing(self._connect()) as connection:
            row = connection.execute(
                f"""SELECT COUNT(*) AS requests,
                           COALESCE(SUM(input_tokens), 0) AS input_tokens,
                           COALESCE(SUM(output_tokens), 0) AS output_tokens,
                           COALESCE(SUM(total_tokens), 0) AS total_tokens
                    FROM api_usage_events WHERE {where}""",
                values,
            ).fetchone()
        return dict(row)

    def seasonal_keywords(self, project_id: str, local_date: str) -> list[dict] | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT keywords_json FROM seasonal_keyword_sets WHERE project_id = ? AND local_date = ?",
                (project_id, local_date),
            ).fetchone()
        return json.loads(row["keywords_json"]) if row else None

    def save_seasonal_keywords(self, project_id: str, local_date: str,
                               keywords: list[dict], usage_id: str) -> None:
        with closing(self._connect()) as connection:
            connection.execute(
                """INSERT OR REPLACE INTO seasonal_keyword_sets
                   (recommendation_id, project_id, local_date, keywords_json, usage_id, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (str(uuid.uuid4()), project_id, local_date,
                 json.dumps(keywords, ensure_ascii=False), usage_id, _now().isoformat()),
            )
            connection.commit()

    def default_project(self, user_id: str) -> dict:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT project_id, owner_user_id, name FROM projects WHERE owner_user_id = ? ORDER BY created_at LIMIT 1",
                (user_id,),
            ).fetchone()
        if row:
            return dict(row)
        return self.ensure_project(user_id, f"project_{user_id.removeprefix('user_')}", "내 콘텐츠")
