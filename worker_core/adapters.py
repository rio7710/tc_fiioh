"""Provider boundary for worker jobs.

Adapters deliberately know nothing about persistence. A provider implementation
receives a JSON-serializable job snapshot and returns a JSON-serializable result.
"""

from __future__ import annotations

from typing import Any, Protocol


class WorkerAdapter(Protocol):
    """Interface implemented by scene, voice, and render providers."""

    def run(self, job: dict[str, Any]) -> dict[str, Any]:
        """Execute one idempotent job and return its result."""
