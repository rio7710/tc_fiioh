"""Storage boundary for the isolated brand-asset service.

The repository deliberately stores plain dictionaries.  That keeps its boundary
JSON serializable and makes replacing this implementation with a database
adapter an integration concern.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Protocol


class BrandAssetRepository(Protocol):
    """Minimal persistence contract used by :class:`BrandAssetService`."""

    def save_asset(self, asset: dict[str, Any]) -> dict[str, Any]: ...
    def save_version(self, version: dict[str, Any]) -> dict[str, Any]: ...
    def save_variant(self, variant: dict[str, Any]) -> dict[str, Any]: ...
    def get_asset(self, asset_id: str) -> dict[str, Any] | None: ...
    def get_version(self, version_id: str) -> dict[str, Any] | None: ...
    def get_variant(self, version_id: str, format: str) -> dict[str, Any] | None: ...
    def list_assets(self) -> list[dict[str, Any]]: ...


class InMemoryBrandAssetRepository:
    """Small deterministic repository for the isolated service and unit tests."""

    def __init__(self) -> None:
        self._assets: dict[str, dict[str, Any]] = {}
        self._versions: dict[str, dict[str, Any]] = {}
        self._variants: dict[tuple[str, str], dict[str, Any]] = {}

    def save_asset(self, asset: dict[str, Any]) -> dict[str, Any]:
        self._assets[asset["asset_id"]] = deepcopy(asset)
        return deepcopy(asset)

    def save_version(self, version: dict[str, Any]) -> dict[str, Any]:
        if version["asset_id"] not in self._assets:
            raise KeyError(f"unknown asset: {version['asset_id']}")
        if any(
            item["asset_id"] == version["asset_id"] and item["version"] == version["version"]
            for item in self._versions.values()
        ):
            raise ValueError("version already exists for asset")
        self._versions[version["version_id"]] = deepcopy(version)
        return deepcopy(version)

    def save_variant(self, variant: dict[str, Any]) -> dict[str, Any]:
        if variant["version_id"] not in self._versions:
            raise KeyError(f"unknown version: {variant['version_id']}")
        key = (variant["version_id"], variant["format"])
        self._variants[key] = deepcopy(variant)
        return deepcopy(variant)

    def get_asset(self, asset_id: str) -> dict[str, Any] | None:
        asset = self._assets.get(asset_id)
        return deepcopy(asset) if asset else None

    def get_version(self, version_id: str) -> dict[str, Any] | None:
        version = self._versions.get(version_id)
        return deepcopy(version) if version else None

    def get_variant(self, version_id: str, format: str) -> dict[str, Any] | None:
        variant = self._variants.get((version_id, format))
        return deepcopy(variant) if variant else None

    def list_assets(self) -> list[dict[str, Any]]:
        return [deepcopy(asset) for asset in self._assets.values()]

    def versions_for(self, asset_id: str) -> list[dict[str, Any]]:
        return [deepcopy(v) for v in self._versions.values() if v["asset_id"] == asset_id]

    def variants_for(self, version_id: str) -> list[dict[str, Any]]:
        return [deepcopy(v) for v in self._variants.values() if v["version_id"] == version_id]
