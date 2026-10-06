"""Validated month pools and shuffle-bag sampling without external API calls."""
import json
import random
import re
from pathlib import Path


def load_month_pool(month, directory=None):
    if not isinstance(month, str) or not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', month):
        raise ValueError('추천 월은 YYYY-MM 형식이어야 합니다.')
    path = Path(directory or Path(__file__).parent / 'data') / f'keyword_pool_{month}_ko-KR_nursing-home.json'
    if not path.is_file():
        return None
    data = json.loads(path.read_text(encoding='utf-8'))
    items = data.get('keywords', [])
    if data.get('month') != month or not items or data.get('count') != len(items):
        raise ValueError('월별 키워드 후보 파일이 올바르지 않습니다.')
    ids, labels = set(), set()
    for item in items:
        key, label = item.get('id'), item.get('label')
        if not isinstance(key, str) or not isinstance(label, str) or not label.strip() or key in ids or ''.join(label.split()) in labels:
            raise ValueError('월별 키워드 후보에 중복 또는 잘못된 값이 있습니다.')
        ids.add(key)
        labels.add(''.join(label.split()))
    return data


def draw_shuffle_bag(ids, remaining=None, last=None, count=3, rng=None):
    if type(count) is not int or not 1 <= count <= 5 or len(ids) < count:
        raise ValueError('추천할 후보가 부족하거나 개수가 올바르지 않습니다.')
    rng = rng or random.SystemRandom()
    allowed = set(ids)
    queue = list(dict.fromkeys(key for key in (remaining or []) if key in allowed))
    selected = []
    cycled = False
    while len(selected) < count:
        if not queue:
            refill = [key for key in ids if key not in selected]
            rng.shuffle(refill)
            # At cycle boundaries show last batch as late as possible.
            previous = set(last or [])
            queue = [key for key in refill if key not in previous] + [key for key in refill if key in previous]
            cycled = remaining is not None
        selected.append(queue.pop(0))
    return selected, queue, cycled
