"""Stable worker-facing automation error types."""


class AdapterFailure(RuntimeError):
    pass


class ContentRepairExhausted(AdapterFailure):
    """A confirmed content-validation failure, eligible for bounded fresh work."""


class RenderTerminalFailure(AdapterFailure):
    """The render API recorded a terminal failure for the stable render job."""


class RenderResultUnknown(AdapterFailure):
    """Submission may have started, so replaying it would be unsafe."""
