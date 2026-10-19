"""Stable, JSON-safe validation identity independent of display messages."""
from tools.validate_unified_content import UnifiedContentError


class StoryboardIssue(UnifiedContentError):
    def __init__(self, code, message, *, scene_id=None, field_paths=(), evidence=(),
                 severity='repairable', repair_scope='scene', retryable=True):
        super().__init__(message)
        self.details = dict(code=code, severity=severity, scene_id=scene_id,
                            field_paths=list(field_paths), evidence=list(evidence),
                            repair_scope=repair_scope, retryable=retryable)


def issue_details(error):
    return dict(error.details) if isinstance(error, StoryboardIssue) else {}
