"""Location classification and visible-activity validation; neutral moments are valid."""
from __future__ import annotations
import json
from pathlib import Path
from typing import Any

from tools.validate_unified_content import UnifiedContentError
from tools.storyboard_issue import StoryboardIssue
from tools.visible_activity import activity_evidence

LOCATION_ACTIVITY_POLICY_PATH = Path(__file__).resolve().parents[1] / "config" / "location-activity-policy.json"


def location_policy_context():
    return json.dumps(json.loads(LOCATION_ACTIVITY_POLICY_PATH.read_text(encoding='utf-8')), ensure_ascii=False)


def _all_text(value):
    if isinstance(value, dict):
        return " ".join(_all_text(child) for child in value.values())
    if isinstance(value, list):
        return " ".join(_all_text(child) for child in value)
    return str(value or "")


def validate_location_activity_policy(
    document: dict[str, Any],
    canonical_assets: dict[str, dict[str, Any]] | None = None,
) -> None:
    """Keep therapy, dining, and event scenes in their registered spaces."""
    policy = json.loads(LOCATION_ACTIVITY_POLICY_PATH.read_text(encoding="utf-8"))
    classification = policy.get("classification") or {}
    location_roles = policy.get("location_roles") or {}
    activity_classes = policy.get("activity_classes") or {}
    production = document.get("production") or {}
    scenes = (production.get("timeline") or {}).get("scenes") or []
    document_assets = {
        str(asset.get("id")): asset
        for asset in (production.get("reference_assets") or [])
        if isinstance(asset, dict) and asset.get("id")
    }
    catalog = dict(document_assets)
    for reference_id, asset in (canonical_assets or {}).items():
        if isinstance(asset, dict):
            catalog[str(reference_id)] = asset

    def contains_any(text: str, terms: list[Any]) -> bool:
        lowered = text.lower()
        return any(str(term).strip().lower() in lowered for term in terms if str(term).strip())

    def asset_role(asset: dict[str, Any]) -> str | None:
        if str(asset.get("kind", "")).lower() not in {"location", "facility"}:
            return None
        if str(asset.get("usage_role", "")).lower() in {
            str(item).lower() for item in classification.get("excluded_usage_roles") or []
        }:
            return None
        if str(asset.get("assignment", "")).lower() in {
            str(item).lower() for item in classification.get("excluded_assignments") or []
        }:
            return None
        explicit_roles = {
            str(asset.get(field) or "").strip()
            for field in classification.get("explicit_role_fields") or []
            if str(asset.get(field) or "").strip()
        }
        unknown_roles = explicit_roles - set(location_roles)
        if unknown_roles:
            raise UnifiedContentError(
                f"장소 레퍼런스 {asset.get('id', 'unknown')}의 전용 용도 값이 올바르지 않습니다: "
                f"{', '.join(sorted(unknown_roles))}"
            )
        if len(explicit_roles) > 1:
            raise UnifiedContentError(
                f"장소 레퍼런스 {asset.get('id', 'unknown')}의 전용 용도 분류가 중복됩니다: "
                f"{', '.join(sorted(explicit_roles))}"
            )
        if explicit_roles:
            return next(iter(explicit_roles))
        exact_matches = [
            role for role, spec in location_roles.items()
            if str(asset.get("id") or "") in (spec.get("asset_ids") or [])
        ]
        if len(exact_matches) > 1:
            raise UnifiedContentError(
                f"장소 레퍼런스 {asset.get('id', 'unknown')}의 용도 분류가 중복됩니다: "
                f"{', '.join(exact_matches)}"
            )
        if exact_matches:
            return exact_matches[0]
        searchable = _all_text({
            key: asset.get(key) for key in
            classification.get("identity_fields") or
            ("id", "uri", "source_filename", "display_name", "aliases")
        })
        matches = [
            role for role, spec in location_roles.items()
            if contains_any(searchable, spec.get("location_terms") or [])
        ]
        if len(matches) > 1:
            raise UnifiedContentError(
                f"장소 레퍼런스 {asset.get('id', 'unknown')}의 용도 분류가 중복됩니다: {', '.join(matches)}"
            )
        return matches[0] if matches else None

    for scene in scenes:
        if not isinstance(scene, dict):
            continue
        location_role_set = {
            role for reference_id in (scene.get("reference_ids") or [])
            if isinstance(catalog.get(str(reference_id)), dict)
            for role in [asset_role(catalog[str(reference_id)])]
            if role
        }
        evidence = activity_evidence(scene, activity_classes)
        scene_id = str(scene.get("id") or "scene")
        for role in sorted(location_role_set):
            required = location_roles.get(role, {}).get("required_activity")
            conflicts = [activity for activity in evidence if required and activity != required]
            if conflicts:
                entries = [entry for activity in conflicts for entry in evidence[activity]]
                raise StoryboardIssue(
                    "LOCATION_ACTIVITY_CONFLICT",
                    f"{scene_id}: {location_roles[role].get('label', role)} 장면에 다른 용도의 행동을 함께 배치할 수 없습니다",
                    scene_id=scene_id, field_paths=sorted({e['field'] for e in entries}), evidence=entries,
                )
        for activity, entries in evidence.items():
            required_role = activity_classes.get(activity, {}).get("required_location_role")
            if required_role and required_role not in location_role_set:
                raise StoryboardIssue(
                    "LOCATION_ACTIVITY_CONFLICT",
                    f"{scene_id}: {activity_classes[activity].get('label', activity)} 장면은 "
                    f"{location_roles.get(required_role, {}).get('label', required_role)} 레퍼런스를 사용해야 합니다",
                    scene_id=scene_id, field_paths=sorted({e['field'] for e in entries}), evidence=entries,
                )
