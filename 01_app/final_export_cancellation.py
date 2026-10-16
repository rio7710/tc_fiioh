"""Low-write cancellation probe for a running final-export worker."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass
class QueueCancellationProbe:
    load_status: Callable[[], Any]
    interval_seconds: float = 0.5
    _checked_at: float = field(default=0.0, init=False)
    _cancelled: bool = field(default=False, init=False)

    def __call__(self) -> bool:
        if self._cancelled:
            return True
        now = time.monotonic()
        if now - self._checked_at < self.interval_seconds:
            return False
        self._checked_at = now
        value = self.load_status()
        self._cancelled = value is True or value == "cancelled"
        return self._cancelled
