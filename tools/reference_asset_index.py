"""Deterministic reference-asset indexing and scene-reference normalization.

The text provider may accidentally keep an asset's semantic suffix while
changing its kind prefix (for example, ``ref-location-*`` to
``ref-character-*``).  This module resolves only exact, unique aliases from
the server-owned catalog.  It deliberately does not use fuzzy matching.
"""
from __future__ import annotations

import copy
import json
import re
import unicodedata
from pathlib import PurePosixPath
from typing import Any


INDEX_VERSION = "1.0.0"
PUBLIC_ASSET_FIELDS = (
    "id", "kind", "uri", "status", "usage", "character_id", "display_name",
    "identity_group", "appearance_lock", "reference_version", "wardrobe_variant",
)
_KIND_PREFIX = re.compile(r"^ref-(?:character|location|facility|style)-")
_ASSET_PREFIX = re.compile(r"^ref-(?:character|location|facility|style)-asset-")


def _normalized_alias(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).strip().lower()
    text = PurePosixPath(text.replace("\\", "/")).stem
    return re.sub(r"[^a-z0-9가-힣]+", "-", text).strip("-")


def _asset_aliases(reference_id: str, asset: dict[str, Any]) -> set[str]:
    values = {reference_id, asset.get("uri"), asset.get("display_name")}
    explicit = asset.get("aliases")
    if isinstance(explicit, list):
        values.update(explicit)
    aliases = {_normalized_alias(value) for value in values if value}
    normalized_id = _normalized_alias(reference_id)
    aliases.update({
        _KIND_PREFIX.sub("", normalized_id),
        _ASSET_PREFIX.sub("", normalized_id),
    })
    return {alias for alias in aliases if len(alias) >= 4}


def build_reference_asset_index(
    canonical_assets: dict[str, dict[str, Any]] | None,
) -> dict[str, Any]:
    """Build a fresh index from every currently registered canonical asset."""
    assets: dict[str, dict[str, Any]] = {}
    alias_candidates: dict[str, set[str]] = {}
    for raw_id, raw_asset in sorted((canonical_assets or {}).items()):
        if not isinstance(raw_asset, dict):
            continue
        reference_id = str(raw_asset.get("id") or raw_id).strip()
        if not reference_id.startswith("ref-"):
            continue
        asset = {key: copy.deepcopy(raw_asset[key]) for key in PUBLIC_ASSET_FIELDS if key in raw_asset}
        asset["id"] = reference_id
        assets[reference_id] = asset
        for alias in _asset_aliases(reference_id, raw_asset):
            alias_candidates.setdefault(alias, set()).add(reference_id)
    aliases = {
        alias: next(iter(reference_ids))
        for alias, reference_ids in alias_candidates.items()
        if len(reference_ids) == 1
    }
    return {"version": INDEX_VERSION, "assets": assets, "aliases": aliases}


def reference_asset_index_context(index: dict[str, Any]) -> str:
    """Serialize the authoritative, dynamically rebuilt index for model prompts."""
    return json.dumps(index, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _resolve_reference_id(reference_id: str, index: dict[str, Any]) -> str | None:
    assets = index.get("assets") or {}
    if reference_id in assets:
        return reference_id
    aliases = index.get("aliases") or {}
    normalized = _normalized_alias(reference_id)
    keys = (
        normalized,
        _KIND_PREFIX.sub("", normalized),
        _ASSET_PREFIX.sub("", normalized),
    )
    matches = {aliases[key] for key in keys if key in aliases}
    return next(iter(matches)) if len(matches) == 1 else None


def normalize_scene_reference_ids(
    document: dict[str, Any], canonical_assets: dict[str, dict[str, Any]] | None,
) -> dict[str, Any]:
    """Replace only uniquely indexed aliases and hydrate their canonical metadata."""
    index = build_reference_asset_index(canonical_assets)
    canonical = index["assets"]
    if not canonical:
        return document
    production = document.get("production") or {}
    scenes = (production.get("timeline") or {}).get("scenes") or []
    replacements: dict[str, str] = {}
    for scene in scenes:
        if not isinstance(scene, dict) or not isinstance(scene.get("reference_ids"), list):
            continue
        resolved_ids = []
        for raw_id in scene["reference_ids"]:
            reference_id = str(raw_id)
            resolved = _resolve_reference_id(reference_id, index)
            if resolved and resolved != reference_id:
                replacements[reference_id] = resolved
            resolved_ids.append(resolved or reference_id)
        scene["reference_ids"] = list(dict.fromkeys(resolved_ids))
        for field in ("image_prompt", "motion_prompt"):
            value = scene.get(field)
            if not isinstance(value, dict) or not isinstance(value.get("text"), str):
                continue
            for old_id, new_id in replacements.items():
                value["text"] = value["text"].replace(old_id, new_id)

    if not replacements:
        return document
    assets = production.get("reference_assets")
    if not isinstance(assets, list):
        assets = []
        production["reference_assets"] = assets
    used_ids = {
        str(reference_id)
        for scene in scenes if isinstance(scene, dict)
        for reference_id in (scene.get("reference_ids") or [])
    }
    normalized_assets = []
    seen = set()
    for asset in assets:
        if not isinstance(asset, dict):
            continue
        old_id = str(asset.get("id") or "")
        reference_id = replacements.get(old_id, old_id)
        if reference_id in seen or (old_id in replacements and reference_id not in used_ids):
            continue
        normalized_assets.append(copy.deepcopy(canonical.get(reference_id, asset)))
        seen.add(reference_id)
    for reference_id in sorted(used_ids):
        if reference_id in canonical and reference_id not in seen:
            normalized_assets.append(copy.deepcopy(canonical[reference_id]))
            seen.add(reference_id)
    production["reference_assets"] = normalized_assets
    return document
