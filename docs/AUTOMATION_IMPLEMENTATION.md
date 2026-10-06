# Scheduled content automation v1

User-owned settings are persisted in SQLite, never in browser storage as the source of truth.
Saving stores a stopped draft; explicit start confirmation enables recurring execution and queues the first run.
Schedules use Asia/Seoul. Day/week preserve start wall-clock time; month preserves the original day,
clamping to month-end without drifting. Downtime is coalesced to one run, never an unbounded catch-up burst.

Each occurrence atomically reserves one project UUID and an immutable configuration snapshot.
Unique (owner, settings revision, due time) prevents duplicate projects. Only one run per owner is active.
Runs have leases; expired work fails safely for user review, rather than blindly repeating a paid call.
Steps checkpoint before/after work. Explicit retry reuses the project and successful checkpoints.
Cancel stops future stages; a provider call already accepted can finish and incur cost.

Endpoints: GET /api/automation; POST /api/automation with action save/start/stop/retry/cancel.
All actions use the authenticated user. Save/start are optimistic-versioned; request IDs deduplicate retries.
Settings, run snapshots and steps are additive tables; no legacy data is rewritten.

Pipeline: create project -> select count unique keywords -> confirm keyword revision -> script plan ->
script generation/confirmation -> voice and scene images -> video design settings -> final export/calendar.
Stage 2 stops after keywords; 3 after script; 3-1 after media; 4 after design settings; 5 exports and records
production calendar only. No channel publishing. Existing API/export adapters remain authoritative.
Keyword AI off selects from existing base pool. AI on uses monthly pool, or existing AI preview endpoint.
Brand asset versions are resolved and pinned at save time; invalid/missing assets fail before starting.
AI scene selection and automatic cropping are not implemented: nonzero video scene count and non-default
crop are rejected for relevant stages, not ignored. The UI communicates this limitation.

Worker uses short-lived owner sessions only against the internal API; credentials are never logged or
returned. API errors are mapped to safe run errors; no provider secrets or internal stack traces are returned.
Tests use temporary databases, fixture providers and browser fetch stubs; no real recurring production is
enabled during deployment. Production schedules require user confirmation.
