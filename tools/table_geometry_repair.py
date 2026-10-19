"""Restricted furniture-ledger repair; registered reference assets are immutable."""
import copy
import json
import re

from tools.storyboard_issue import StoryboardIssue, issue_details


def geometry_conflict(scene, index, prop_indices, reference_ids, reference_shapes, props_shapes):
    paths = [f'production.continuity.props.{i}' for i in prop_indices]
    prompt = scene.get('image_prompt')
    paths.append(f'production.timeline.scenes.{index}.image_prompt' + ('.text' if isinstance(prompt, dict) else ''))
    return StoryboardIssue('TABLE_GEOMETRY_CONFLICT',
        f"{scene.get('id', 'scene')}: 기준 장소 레퍼런스와 continuity.props의 테이블 형태가 서로 충돌합니다",
        scene_id=scene.get('id'), field_paths=paths, repair_scope='table_geometry',
        evidence=[dict(reference_ids=reference_ids, reference_shapes=sorted(reference_shapes),
                       props_shapes=sorted(props_shapes))])


def table_target(document, error):
    issue = issue_details(error)
    if issue.get('code') != 'TABLE_GEOMETRY_CONFLICT':
        return None
    paths = []
    for path in issue['field_paths']:
        value = at_path(document, path)
        if isinstance(value, dict) and isinstance(value.get('text'), str):
            path += '.text'
        elif not isinstance(value, str):
            return None
        paths.append(path)
    return paths


def at_path(document, path):
    value = document
    for key in path.split('.'):
        value = value[int(key)] if isinstance(value, list) else value[key]
    return value


def table_prompt(document, error, paths):
    issue = issue_details(error)
    scene = next(s for s in document['production']['timeline']['scenes'] if s['id'] == issue['scene_id'])
    return ('테이블 형태 충돌의 제한된 보정 API다. 기준 reference_assets는 절대 변경하지 않는다. '
            '오류 evidence에 있는 기준 형태와 현재 장소에 맞춰 해당 props 문구와 현재 씬 image_prompt만 고친다. '
            '다른 장소의 소품·나레이션·시간·씬·캐릭터는 변경하지 않는다. 복수 기준 형태는 현재 씬에서 '
            '사용하는 하나를 선택하며 새로운 형태를 추측하지 않는다. '
            'JSON {"scene_id":"...","edits":{"allowed_paths 중 경로":"수정 텍스트"}}만 반환한다.\n'
            + json.dumps(dict(issue=issue, scene=scene, allowed_paths=paths,
                current_values={path: at_path(document, path) for path in paths},
                reference_assets=document['production'].get('reference_assets', [])), ensure_ascii=False))


def apply_table_response(document, error, paths, response):
    value = json.loads(response)
    if not isinstance(value, dict) or set(value) != {'scene_id', 'edits'} or value['scene_id'] != issue_details(error)['scene_id']:
        raise ValueError('테이블 보정 대상이 일치하지 않습니다.')
    edits = value['edits']
    if not isinstance(edits, dict) or not edits or set(edits) - set(paths):
        raise ValueError('테이블 보정 허용 경로가 아닙니다.')
    result = copy.deepcopy(document)
    for path, text in edits.items():
        if not re.fullmatch(r'production\.(continuity\.props\.\d+(\.text)?|timeline\.scenes\.\d+\.image_prompt(\.text)?)', path):
            raise ValueError('테이블 보정 허용 필드가 아닙니다.')
        if not isinstance(text, str) or not text.strip() or not isinstance(at_path(document, path), str):
            raise ValueError('테이블 보정은 기존 텍스트만 변경할 수 있습니다.')
        parent_path, key = path.rsplit('.', 1)
        parent = at_path(result, parent_path)
        parent[int(key) if isinstance(parent, list) else key] = text
    return result
