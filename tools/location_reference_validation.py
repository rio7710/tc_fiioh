"""Scene location cardinality is independent of optional corridor coverage."""
from tools.storyboard_issue import StoryboardIssue


def validate_location_references(document, canonical_assets=None):
    production = document.get('production') or {}
    catalog = {str(a.get('id')): a for a in production.get('reference_assets', [])
               if isinstance(a, dict) and a.get('id')}
    catalog.update(canonical_assets or {})
    for scene in (production.get('timeline') or {}).get('scenes', []):
        locations = [key for key in scene.get('reference_ids', [])
                     if str(catalog.get(key, {}).get('kind', '')).lower() in ('location', 'facility')]
        if len(locations) > 1:
            raise StoryboardIssue('LOCATION_REFERENCE_MULTIPLE',
                f"{scene.get('id', 'scene')}는 현재 장소 레퍼런스를 정확히 하나만 사용해야 합니다",
                scene_id=scene.get('id'), field_paths=['reference_ids'], evidence=locations,
                repair_scope='location_selection')
