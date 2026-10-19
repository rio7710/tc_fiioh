"""Conservative visible-action evidence, not an NLP claim about every sentence."""
import re


def text_fields(value, path=''):
    if isinstance(value, dict):
        for key, child in value.items():
            if key not in ('source', 'negative_prompt', 'negative', 'avoid'):
                yield from text_fields(child, f'{path}.{key}' if path else key)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from text_fields(child, f'{path}.{index}')
    elif isinstance(value, str):
        yield path, value


def visible_clauses(text):
    # Keep independent affirmative clauses: "식사 금지, 관절 운동을 한다".
    for clause in re.split(r'[.!?;\n,]|(?:하지만|그러나|\bbut\b)|(?<=금지하고)|(?<=않고)|(?<=없지만)', text, flags=re.I):
        clause = clause.strip()
        if not clause:
            continue
        if re.search(r'^(?:negative(?: prompt)?|avoid|no|without|do not|never)\b', clause, re.I):
            continue
        if re.search(r'금지|배제|제외|하지\s*않|하지\s*말|없는|없다|없음', clause):
            continue
        # Strip explicit temporal context, not the present action that follows it.
        clause = re.sub(r'^.*?(?:이전\s*(?:장면|씬).*?(?:후|뒤)|식사\s*후(?:에도)?|치료\s*후(?:에도)?)\s*', '', clause)
        if re.search(r'다음\s*(?:장면|씬)|이전\s*(?:장면|씬)|\b(?:next|previous)\s+scene\b', clause, re.I):
            continue
        yield clause


def activity_evidence(scene, activity_classes):
    evidence = {}
    # Titles are editorial labels, not visible action specifications.
    for key in ('description', 'visual', 'image_prompt', 'motion_prompt', 'sequence', 'camera'):
        for path, text in text_fields(scene.get(key), key):
            for clause in visible_clauses(text):
                lowered = clause.lower()
                for activity, spec in activity_classes.items():
                    terms = spec.get('action_terms', spec.get('terms', []))
                    if any(str(term).lower() in lowered for term in terms):
                        evidence.setdefault(activity, []).append({'field': path, 'text': clause[:400]})
    return evidence
