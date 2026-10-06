"""Logical brand assets, versions, and explicit ratio variants.

This module has no database, HTTP, filesystem, or filename convention
dependency.  A caller supplies a repository and an explicit URI for every
variant, so the service can be connected to the existing server by a separate
router/integration change.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Callable
from uuid import uuid4

from repositories.brand_asset_repository import BrandAssetRepository


BRAND_ROLES = frozenset({"intro", "outro", "watermark"})
BRAND_VARIANT_FORMATS = {
    "16x9": {"width": 16, "height": 9},
    "9x16": {"width": 9, "height": 16},
    "4x5": {"width": 4, "height": 5},
    "1x1": {"width": 1, "height": 1},
}
MEDIA_TYPES = frozenset({"image", "video"})


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def _require_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty string")
    return value.strip()


def _copy(value: Any) -> Any:
    return deepcopy(value)


class BrandAssetService:
    """Application service for the asset/version/variant model."""

    def __init__(self, repository: BrandAssetRepository, id_factory: Callable[[str], str] = _new_id) -> None:
        self.repository = repository
        self._id_factory = id_factory

    def create_asset(self, role: str, name: str, asset_id: str | None = None) -> dict[str, Any]:
        role = _require_text(role, "role")
        if role not in BRAND_ROLES:
            raise ValueError("role must be intro, outro, or watermark")
        asset = {"asset_id": asset_id or self._id_factory("asset"), "role": role, "name": _require_text(name, "name")}
        if self.repository.get_asset(asset["asset_id"]):
            raise ValueError("asset_id already exists")
        return _copy(self.repository.save_asset(asset))

    def create_version(self, asset_id: str, version: int, version_id: str | None = None) -> dict[str, Any]:
        asset_id = _require_text(asset_id, "asset_id")
        if not self.repository.get_asset(asset_id):
            raise ValueError("asset does not exist")
        if type(version) is not int or version < 1:
            raise ValueError("version must be a positive integer")
        version_record = {
            "version_id": version_id or self._id_factory("version"),
            "asset_id": asset_id,
            "version": version,
        }
        if self.repository.get_version(version_record["version_id"]):
            raise ValueError("version_id already exists")
        return _copy(self.repository.save_version(version_record))

    def add_variant(
        self,
        version_id: str,
        format: str,
        uri: str,
        width: int,
        height: int,
        media_type: str,
        checksum: str,
        variant_id: str | None = None,
        mime_type: str | None = None,
    ) -> dict[str, Any]:
        version_id = _require_text(version_id, "version_id")
        format = _require_text(format, "format")
        if not self.repository.get_version(version_id):
            raise ValueError("version does not exist")
        if format not in BRAND_VARIANT_FORMATS:
            raise ValueError("format must be one of 16x9, 9x16, 4x5, or 1x1")
        if type(width) is not int or type(height) is not int or width < 1 or height < 1:
            raise ValueError("width and height must be positive integers")
        ratio = BRAND_VARIANT_FORMATS[format]
        if width * ratio["height"] != height * ratio["width"]:
            raise ValueError("width and height do not match the declared format")
        if media_type not in MEDIA_TYPES:
            raise ValueError("media_type must be image or video")
        if format == "1x1" and media_type == "video":
            pass  # Square video is valid; format and media type are independent.
        variant = {
            "variant_id": variant_id or self._id_factory("variant"),
            "version_id": version_id,
            "format": format,
            "uri": _require_text(uri, "uri"),
            "width": width,
            "height": height,
            "media_type": media_type,
            "checksum": _require_text(checksum, "checksum"),
        }
        if mime_type is not None:
            variant["mime_type"] = _require_text(mime_type, "mime_type")
        if self.repository.get_variant(version_id, format):
            raise ValueError("variant for this version and format already exists")
        return _copy(self.repository.save_variant(variant))

    def get_asset(self, asset_id: str) -> dict[str, Any] | None:
        asset = self.repository.get_asset(asset_id)
        if not asset:
            return None
        versions = []
        versions_for = getattr(self.repository, "versions_for", None)
        variants_for = getattr(self.repository, "variants_for", None)
        for version in sorted(versions_for(asset_id) if versions_for else [], key=lambda item: item["version"]):
            version["variants"] = sorted(
                variants_for(version["version_id"]) if variants_for else [], key=lambda item: item["format"]
            )
            versions.append(version)
        asset["versions"] = versions
        return _copy(asset)

    def resolve_variant(self, version_id: str, format: str) -> dict[str, Any]:
        if format not in BRAND_VARIANT_FORMATS:
            raise ValueError("format must be one of 16x9, 9x16, 4x5, or 1x1")
        variant = self.repository.get_variant(_require_text(version_id, "version_id"), format)
        if not variant:
            raise LookupError("brand asset variant does not exist")
        return _copy(variant)


def build_brand_asset_migration_plan(legacy_rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Return a side-effect-free migration plan for legacy brand rows.

    Only an explicitly declared ``settings.profiles[format].uri`` becomes a
    variant.  A legacy top-level URI is reported as unresolved because its
    filename or path must never be used to guess a ratio.
    """

    operations: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
    for row in legacy_rows:
        if not isinstance(row, dict):
            unresolved.append({"reason": "row is not an object"})
            continue
        asset_id = row.get("asset_id")
        version_id = row.get("version_id")
        if not isinstance(asset_id, str) or not isinstance(version_id, str):
            unresolved.append({"reason": "asset_id and version_id are required", "row": _copy(row)})
            continue
        operations.append({
            "op": "upsert_asset",
            "asset": {"asset_id": asset_id, "role": row.get("role"), "name": row.get("name")},
        })
        operations.append({
            "op": "upsert_version",
            "version": {"version_id": version_id, "asset_id": asset_id, "version": row.get("version")},
        })
        profiles = ((row.get("settings") or {}).get("profiles") if isinstance(row.get("settings"), dict) else {})
        if not isinstance(profiles, dict):
            profiles = {}
        explicit_formats = set()
        for format, profile in profiles.items():
            if format not in BRAND_VARIANT_FORMATS or not isinstance(profile, dict) or not profile.get("uri"):
                continue
            explicit_formats.add(format)
            operations.append({"op": "upsert_variant", "variant": {
                "variant_id": profile.get("variant_id") or f"{version_id}:{format}",
                "version_id": version_id, "format": format, "uri": profile["uri"],
                "width": profile.get("width"), "height": profile.get("height"),
                "media_type": profile.get("media_type") or row.get("media_type"),
                "checksum": profile.get("checksum"),
            }})
        if row.get("uri") and not explicit_formats:
            unresolved.append({"version_id": version_id, "reason": "top-level URI has no explicit ratio variant"})
    return {"schema_version": "brand-asset-migration-plan.v1", "operations": operations, "unresolved": unresolved}


# Short integration-friendly name; both names remain pure functions.
migration_plan = build_brand_asset_migration_plan
