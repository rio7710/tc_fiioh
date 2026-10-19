"""Restricted structure repair, separate from the text-only scene reviewer."""
import copy
import json

from tools.storyboard_issue import issue_details


def structure_target(document, error, canonical_assets):
    issue = issue_details(error)
    if issue.get('code') != 'LOCATION_REFERENCE_MULTIPLE' or not canonical_assets:
        return None
    scene = next((s for s in document['production']['timeline']['scenes']
                  if s.get('id') == issue.get('scene_id')), None)
    if not scene:
        return None
    choices = [key for key in scene.get('reference_ids', [])
               if canonical_assets.get(key, {}).get('kind') in ('location', 'facility')
               and canonical_assets[key].get('status') == 'ready'
               and canonical_assets[key].get('uri')]
    return (scene, choices) if len(choices) > 1 else None


def structure_prompt(document, scene, choices, canonical_assets):
    scenes = document['production']['timeline']['scenes']
    index = scenes.index(scene)
    context = dict(scene=scene, previous_scene=scenes[index - 1] if index else None,
                   next_scene=scenes[index + 1] if index + 1 < len(scenes) else None,
                   choices={key: canonical_assets[key] for key in choices})
    return ('현재 씬에 중복 배정된 장소 중 실제 현재 화면의 장소 하나만 선택한다. '
            '이전/다음 장면의 장소를 현재 장소로 고르지 않는다. 확실하지 않으면 '
            '{"scene_id":"...","location_id":null}을 반환한다. '
            '확실하면 {"scene_id":"...","location_id":"choices 중 하나"}만 반환한다. '
            '새 장소·캐릭터를 추가하거나 시간·대본·씬 순서·다른 필드를 바꾸지 않는다.\n'
            + json.dumps(context, ensure_ascii=False))


def apply_structure_response(document, scene, choices, canonical_assets, response):
    value = json.loads(response)
    if not isinstance(value, dict) or set(value) != {'scene_id', 'location_id'}:
        raise ValueError('장소 선택 응답 형식이 올바르지 않습니다.')
    if value['scene_id'] != scene['id'] or value['location_id'] not in choices:
        raise ValueError('장소 선택이 불명확하거나 등록된 후보가 아닙니다.')
    chosen = value['location_id']
    result = copy.deepcopy(document)
    target = next(s for s in result['production']['timeline']['scenes'] if s['id'] == scene['id'])
    target['reference_ids'] = [key for key in target['reference_ids']
        if key == chosen or canonical_assets.get(key, {}).get('kind') not in ('location', 'facility')]
    return result
