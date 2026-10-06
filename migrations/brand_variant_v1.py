"""Additive migration for explicit brand ratio variants.

The migration never guesses from a filename.  Legacy companion selections
must declare a format and point to a legacy version row or an explicit URI.
Applying a plan is transactional and records a backup ledger so the rows it
created can be rolled back without touching the legacy tables.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any


FORMATS = {"16x9": (16, 9), "9x16": (9, 16), "4x5": (4, 5), "1x1": (1, 1)}
MIGRATION_ID_PREFIX = "brand-variant-v1"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_brand_variant_schema(connection) -> None:
    """Create only the new variant/backup tables; safe on every startup."""
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS brand_asset_variants (
            variant_id TEXT PRIMARY KEY,
            version_id TEXT NOT NULL REFERENCES brand_asset_versions(version_id) ON DELETE CASCADE,
            format TEXT NOT NULL CHECK (format IN ('16x9','9x16','4x5','1x1')),
            uri TEXT NOT NULL,
            width INTEGER NOT NULL CHECK (width > 0),
            height INTEGER NOT NULL CHECK (height > 0),
            media_type TEXT NOT NULL CHECK (media_type IN ('image','video')),
            mime_type TEXT,
            checksum TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE (version_id, format)
        );
        CREATE INDEX IF NOT EXISTS idx_brand_asset_variants_version
            ON brand_asset_variants(version_id, format);
        CREATE TABLE IF NOT EXISTS brand_variant_migration_backups (
            migration_id TEXT NOT NULL,
            variant_id TEXT NOT NULL,
            payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
            created_at TEXT NOT NULL,
            PRIMARY KEY (migration_id, variant_id)
        );
        CREATE TABLE IF NOT EXISTS brand_variant_migrations (
            migration_id TEXT PRIMARY KEY,
            status TEXT NOT NULL CHECK (status IN ('applied','rolled_back')),
            plan_json TEXT NOT NULL CHECK (json_valid(plan_json)),
            created_at TEXT NOT NULL,
            rolled_back_at TEXT
        );
        """
    )


def _profile_variant(connection, logical_version_id: str, format: str, profile: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    """Resolve one explicit companion profile without reading its filename."""
    if format not in FORMATS:
        return None, "unsupported format"
    uri = profile.get("uri")
    source_version_id = profile.get("version_id")
    source = None
    if source_version_id:
        source = connection.execute(
            "SELECT version_id, uri, media_type, mime_type FROM brand_asset_versions WHERE version_id = ?",
            (str(source_version_id),),
        ).fetchone()
        if not source:
            return None, "profile version_id does not exist"
        uri = uri or source["uri"]
    if not isinstance(uri, str) or not uri.strip():
        return None, "explicit profile uri is required"
    width, height = profile.get("width"), profile.get("height")
    if type(width) is not int or type(height) is not int or width < 1 or height < 1:
        return None, "explicit width and height are required"
    ratio_width, ratio_height = FORMATS[format]
    if width * ratio_height != height * ratio_width:
        return None, "explicit dimensions do not match format"
    media_type = profile.get("media_type") or (source["media_type"] if source else None)
    checksum = profile.get("checksum")
    if not isinstance(media_type, str) or media_type not in {"image", "video"}:
        return None, "explicit media_type is required"
    if not isinstance(checksum, str) or not checksum.strip():
        return None, "explicit checksum is required"
    return {
        "variant_id": str(profile.get("variant_id") or f"{logical_version_id}:{format}"),
        "version_id": logical_version_id,
        "format": format,
        "uri": uri.strip(),
        "width": width,
        "height": height,
        "media_type": media_type,
        "mime_type": profile.get("mime_type") or (source["mime_type"] if source else None),
        "checksum": checksum.strip(),
    }, None


def plan_brand_variant_migration(connection, migration_id: str | None = None) -> dict[str, Any]:
    """Build a JSON-serializable dry-run plan from legacy companion settings."""
    migration_id = migration_id or f"{MIGRATION_ID_PREFIX}-{uuid.uuid4().hex}"
    operations: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
    rows = connection.execute(
        "SELECT user_id, role, version_id, settings_json FROM user_brand_selections"
    ).fetchall()
    rows += connection.execute(
        "SELECT p.owner_user_id AS user_id, s.role, s.version_id, s.settings_json "
        "FROM content_brand_selections s JOIN projects p ON p.project_id = s.project_id"
    ).fetchall()
    seen: set[tuple[str, str]] = set()
    for row in rows:
        settings = json.loads(row["settings_json"] or "{}")
        profiles = settings.get("profiles") if isinstance(settings, dict) else None
        if not isinstance(profiles, dict):
            continue
        logical_version_id = row["version_id"]
        if not logical_version_id:
            unresolved.append({"user_id": row["user_id"], "role": row["role"], "reason": "selection has no logical version_id"})
            continue
        for format, profile in profiles.items():
            if not isinstance(profile, dict):
                unresolved.append({"version_id": logical_version_id, "format": format, "reason": "profile is not an object"})
                continue
            variant, reason = _profile_variant(connection, logical_version_id, format, profile)
            if not variant:
                unresolved.append({"version_id": logical_version_id, "format": format, "reason": reason})
                continue
            key = (logical_version_id, format)
            if key in seen:
                continue
            seen.add(key)
            operations.append({"op": "upsert_variant", "variant": variant})
    return {
        "schema_version": "brand-asset-migration-plan.v1",
        "migration_id": migration_id,
        "operations": operations,
        "unresolved": unresolved,
    }


def apply_brand_variant_migration(connection, plan: dict[str, Any]) -> dict[str, Any]:
    """Apply a dry-run plan atomically, retaining a rollback ledger."""
    if plan.get("schema_version") != "brand-asset-migration-plan.v1":
        raise ValueError("unsupported brand migration plan")
    migration_id = str(plan.get("migration_id") or "").strip()
    if not migration_id or plan.get("unresolved"):
        raise ValueError("migration plan contains unresolved variants")
    ensure_brand_variant_schema(connection)
    now = _now()
    try:
        connection.execute("BEGIN IMMEDIATE")
        for operation in plan.get("operations", []):
            variant = operation.get("variant", {})
            existing = connection.execute(
                "SELECT * FROM brand_asset_variants WHERE version_id = ? AND format = ?",
                (variant.get("version_id"), variant.get("format")),
            ).fetchone()
            if existing:
                if dict(existing) != variant | {"created_at": existing["created_at"]}:
                    raise ValueError("existing variant conflicts with migration plan")
                continue
            connection.execute(
                "INSERT INTO brand_asset_variants "
                "(variant_id,version_id,format,uri,width,height,media_type,mime_type,checksum,created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (variant["variant_id"], variant["version_id"], variant["format"], variant["uri"],
                 variant["width"], variant["height"], variant["media_type"], variant.get("mime_type"),
                 variant["checksum"], now),
            )
            connection.execute(
                "INSERT INTO brand_variant_migration_backups VALUES (?,?,?,?)",
                (migration_id, variant["variant_id"], json.dumps(variant, ensure_ascii=False, sort_keys=True), now),
            )
        connection.execute(
            "INSERT OR REPLACE INTO brand_variant_migrations VALUES (?,?,?,?,?)",
            (migration_id, "applied", json.dumps(plan, ensure_ascii=False, sort_keys=True), now, None),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return {"migration_id": migration_id, "status": "applied", "inserted": len(plan.get("operations", []))}


def rollback_brand_variant_migration(connection, migration_id: str) -> dict[str, Any]:
    """Remove only variants recorded as created by one successful migration."""
    ensure_brand_variant_schema(connection)
    try:
        connection.execute("BEGIN IMMEDIATE")
        rows = connection.execute(
            "SELECT variant_id FROM brand_variant_migration_backups WHERE migration_id = ?", (migration_id,)
        ).fetchall()
        for row in rows:
            connection.execute("DELETE FROM brand_asset_variants WHERE variant_id = ?", (row["variant_id"],))
        connection.execute(
            "UPDATE brand_variant_migrations SET status='rolled_back', rolled_back_at=? WHERE migration_id=?",
            (_now(), migration_id),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return {"migration_id": migration_id, "status": "rolled_back", "removed": len(rows)}
