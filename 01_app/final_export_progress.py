"""Bound durable progress writes without hiding phase transitions."""

from __future__ import annotations

import time
from typing import Callable, Mapping


class ProgressThrottle:
    def __init__(self, writer: Callable[[Mapping], None], interval_seconds: float = 0.25):
        self.writer = writer
        self.interval_seconds = max(0.05, float(interval_seconds))
        self.last_write = 0.0
        self.last_phase = None

    def __call__(self, progress=None, **changes) -> bool:
        value = dict(progress) if isinstance(progress, Mapping) else {}
        value.update(changes)
        phase = value.get("phase")
        now = time.monotonic()
        urgent = phase != self.last_phase or float(value.get("progress") or 0) >= 0.99
        if not urgent and now - self.last_write < self.interval_seconds:
            return False
        self.writer(value)
        self.last_write = now
        self.last_phase = phase
        return True
