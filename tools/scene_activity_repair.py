"""Field-addressed scene repair; never give a reviewer structural write access."""
import copy
import json
from tools.location_activity_validation import location_policy_context
from tools.storyboard_issue import issue_details

TEXT_ROOTS = {'image_prompt', 'camera', 'lighting', 'motion_prompt', 'transition', 'description', 'visual'}
SEQUENCE_FIELDS = {'entry_action', 'exit_action', 'continuity_anchor', 'character_blocking', 'camera_bridge'}


def allowed_path(path):
    parts = path.split('.')
    return ((parts[0] in TEXT_ROOTS and (len(parts) == 1 or parts[1:] == ['text']))
            or (parts[0] == 'sequence' and len(parts) == 2 and parts[1] in SEQUENCE_FIELDS))


def activity_target(document, error):
    issue = issue_details(error)
    paths = issue.get('field_paths') or []
    if issue.get('code') != 'LOCATION_ACTIVITY_CONFLICT' or not paths or not all(map(allowed_path, paths)):
        return None
    scene = next((s for s in document['production']['timeline']['scenes']
                  if s.get('id') == issue['scene_id']), None)
    return (scene, paths) if scene else None


def activity_prompt(document, scene, paths, error):
    scenes = document['production']['timeline']['scenes']
    index = scenes.index(scene)
    return ('현재 씬에서 오류가 확인된 allowed_paths의 텍스트만 수정한다. '
            '다른 씬·캐릭터·시간·내레이션·자막·reference_ids·카메라 enum은 변경하지 않는다. '
            'JSON {"scene_id":"...","edits":{"허용 경로":"수정 텍스트"}}만 반환한다.\n'
            + json.dumps(dict(scene=scene, allowed_paths=paths, issue=issue_details(error),
                previous_scene=scenes[index-1] if index else None,
                next_scene=scenes[index+1] if index+1 < len(scenes) else None,
                reference_assets=document['production'].get('reference_assets', []),
                location_policy=json.loads(location_policy_context())), ensure_ascii=False))


def apply_activity_response(document, scene, paths, response):
    value = json.loads(response)
    if not isinstance(value, dict) or set(value) != {'scene_id', 'edits'} or value['scene_id'] != scene['id']:
        raise ValueError('활동 보정 대상이 일치하지 않습니다.')
    edits = value['edits']
    if not isinstance(edits, dict) or not edits or set(edits) - set(paths):
        raise ValueError('활동 보정 허용 경로가 아닙니다.')
    result = copy.deepcopy(document)
    target = next(s for s in result['production']['timeline']['scenes'] if s['id'] == scene['id'])
    for path, text in edits.items():
        if not allowed_path(path) or not isinstance(text, str) or not text.strip():
            raise ValueError('활동 보정 텍스트가 올바르지 않습니다.')
        parts, parent = path.split('.'), target
        for key in parts[:-1]:
            parent = parent[key]
        if not isinstance(parent.get(parts[-1]), str):
            raise ValueError('기존 텍스트만 보정할 수 있습니다.')
        parent[parts[-1]] = text
    return result
