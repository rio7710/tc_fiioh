"""Minimal text patches for scene-local validation; immutable topology stays intact."""
import copy
import json
import re

FIELDS = {'image_prompt', 'camera', 'lighting', 'motion_prompt', 'transition'}


def target_scene(document, error):
    text = str(error)
    # Structural/reference errors need the existing document repair path.
    if not any(term in text for term in ('image_prompt', '테이블', ' 행동만 배치해야', 'motion_prompt')):
        return None
    ids = set(re.findall(r'scene-\d+', text))
    scenes = ((document.get('production') or {}).get('timeline') or {}).get('scenes') or []
    matches = [scene for scene in scenes if scene.get('id') in ids]
    return matches[0] if len(matches) == 1 else None


def repair_prompt(document, scene, error, asset_index):
    scenes = document['production']['timeline']['scenes']
    index = scenes.index(scene)
    context = {'scene': scene, 'error': str(error),
               'previous_scene': scenes[index - 1] if index else None,
               'next_scene': scenes[index + 1] if index + 1 < len(scenes) else None,
               'reference_assets': document['production'].get('reference_assets', []),
               'continuity': document['production'].get('continuity', {}), 'asset_index': asset_index}
    return (
        '검증에 실패한 현재 씬의 해당 부분만 보완한다. 전체 콘티를 재작성하지 않는다. '
        '등록된 장소·인물·소품과 내부 계약을 유지한다. 확정 내레이션과 자막, 시간, ID, '
        'reference_ids, sequence는 변경하지 않는다. 복도 생략은 오류가 아니다. '
        '물리치료실은 치료, 식당은 식사, 기타 행사는 로비라는 장소 용도에 맞춘다. '
        'JSON {"scene_id":"...","patch":{"image_prompt":{"text":"..."}}}만 반환한다. '
        'patch 허용 필드는 image_prompt/camera/lighting/motion_prompt/transition의 text뿐이다.\n'
        + json.dumps(context, ensure_ascii=False))


def apply_patch_response(document, scene, response):
    value = json.loads(response)
    if not isinstance(value, dict) or set(value) != {'scene_id', 'patch'} or value['scene_id'] != scene['id']:
        raise ValueError('부분 보정 대상 씬이 일치하지 않습니다.')
    patch = value['patch']
    if not isinstance(patch, dict) or not patch or set(patch) - FIELDS:
        raise ValueError('부분 보정 허용 필드가 아닙니다.')
    result = copy.deepcopy(document)
    target = next(s for s in result['production']['timeline']['scenes'] if s['id'] == scene['id'])
    for key, item in patch.items():
        if not isinstance(item, dict) or set(item) != {'text'} or not isinstance(item['text'], str) or not item['text'].strip():
            raise ValueError('부분 보정 text가 올바르지 않습니다.')
        if isinstance(target.get(key), dict):
            target[key]['text'] = item['text']
        else:
            target[key] = item['text']
    return json.dumps(result, ensure_ascii=False)
