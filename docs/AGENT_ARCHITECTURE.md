# Greenhill agent and worker architecture

## Why this structure

The demo currently runs as one Python HTTP process, but the production flow contains independent, long-running operations with different providers and retry behavior. The repository therefore separates four concerns:

| Surface | Purpose | Location |
|---|---|---|
| Repository guidance | Durable implementation and verification rules | `AGENTS.md` |
| Codex skill | Repeatable Greenhill maintenance workflow | `.agents/skills/greenhill-content-pipeline/` |
| Worker contract | Machine-readable future pipeline and dependencies | `01_app/data/pipeline_manifest.json` |
| Harness | Deterministic checks for code, assets, timing, and contracts | `tools/lint_project.py`, `tests/` |

This follows the official Codex customization model: keep durable repository guidance in `AGENTS.md`, reusable procedures in repository skills, and non-interactive validation in scripts or CI.

## Runtime target

```text
Browser
  │ POST /projects/:id/runs
  ▼
Orchestrator API ── job/event store ── progress stream
  │
  ├─ planning queue ── PD / writer / visual director / storyboard workers
  ├─ media queue ───── character / image / bridge / voice / I2V workers
  ├─ review queue ──── bridge review / production QA workers
  ├─ export queue ──── caption PNG / ratio-aware FFmpeg composition workers
  └─ publish queue ─── schedule / platform publisher workers
                         │
                         ├─ object storage: images, audio, video, captions
                         └─ relational store: projects, jobs, settings, calendar
```

The browser receives persisted job events. Modal progress must reflect real worker state, not elapsed-time-only animation.

The current demo performs timeline assembly, ratio crop, caption/voice/BGM overlay, and H.264/AAC encoding in one `final_composite` FFmpeg operation per unique output ratio. Do not add a second simulated platform-optimization stage after the encoded file already exists. Selected platforms sharing a ratio reuse one output artifact.

## API shape

Suggested endpoints:

```text
POST /api/projects
POST /api/projects/{project_id}/runs
GET  /api/runs/{run_id}
GET  /api/runs/{run_id}/events
POST /api/jobs/{job_id}/retry
POST /api/jobs/{job_id}/cancel
GET  /api/projects/{project_id}/artifacts
POST /api/projects/{project_id}/distribution
```

Use SSE first for progress because the browser only needs server-to-client updates. Move to WebSockets only if interactive bidirectional control becomes necessary.

## State and retries

- The orchestrator creates jobs from the manifest dependency graph.
- A worker claims a queued job with a lease, sets it to running, and persists a terminal result.
- The orchestrator releases dependent jobs only after required upstream artifacts succeed.
- Provider fallback stays inside the owning worker. For example, the I2V worker may try Kling after a retryable Seedance failure.
- Rerunning a changed script should invalidate downstream voice, QA, composite, and distribution artifacts while preserving reusable character and image artifacts when their inputs did not change.

## Image generation

The `scene_image` and `bridge_image` workers use adapters:

- `openai_image`: OpenAI Image API for direct generation/editing or the Responses API image-generation tool for multi-step flows;
- `nano_banana`: external managed image provider;
- `diffusers`: optional self-hosted open-source pipeline.

Store prompt, seed when supported, provider/model identifier, safety outcome, dimensions, checksum, and parent artifact IDs with each result.

## Prototype pipeline strategy

The prototype validates orchestration, job state, artifact handoff, progress reporting, timeline synchronization, retries, and final export. Generated-media quality is not an acceptance criterion at this stage. Production provider selection and commercial API evaluation remain separate decisions.

Keep the boundary as `worker -> provider adapter -> runtime or external API`:

- A worker owns job claiming, persisted state transitions, cancellation, retry, idempotency, artifact registration, and safe errors.
- A provider adapter translates the stable worker request and result contracts into provider-specific calls.
- A runtime owns model loading, inference, memory release, and device-specific optimization. It remains an implementation detail behind a local provider adapter.
- The browser and orchestrator must never depend on model names, SDK payloads, API keys, or whether execution is local or remote.

### Initial low-resource providers

Use deliberately replaceable local providers while validating the flow:

| Worker | Prototype provider | Purpose |
|---|---|---|
| `content_pd`, `story_writer`, `visual_director`, `storyboard_editor` | small local instruct LLM, initially Qwen2.5-1.5B-Instruct or a deterministic fixture provider | Validate Korean brief, script, shot-plan, storyboard, and structured-JSON handoffs without establishing a production text vendor. |
| `scene_image`, `bridge_image` | shared FP16 Stable Diffusion 1.5-compatible runtime or deterministic fixture provider | Produce URI-addressable image artifacts without establishing a production image vendor. |
| `image_to_video` | FFmpeg pan/zoom/fade provider by default | Produce deterministic scene video artifacts with the exact requested duration on low-resource hosts. |
| `image_to_video` | optional AnimateDiff provider | Exercise asynchronous generative-video execution and failure handling when host capacity permits. |
| `final_composite` | FFmpeg | Validate timeline-driven composition, narration/BGM independence, captions, ratios, and H.264/AAC delivery. |

For a 6 GB GPU target, run LLM, image, and generative-video inference sequentially rather than keeping their runtimes resident together. Load the selected runtime for one job, persist its artifact, release model and accelerator memory, and only then admit the next incompatible workload. Treat 6 GB as a runtime constraint, not a guarantee that the full Python/CUDA container or all model files fit within 6 GB of disk.

The FFmpeg I2V substitute is intentional: it validates the same job lifecycle and artifact contract without making the prototype dependent on generative-video quality or GPU availability. It must honor each `timeline.scenes[]` duration and return a normal video artifact, so replacing it later does not change downstream QA or composition.

### Structured-output harness

Prototype text generation is contract-first. The local LLM supplies candidate content, while the harness—not the model—owns output correctness:

1. Render a versioned prompt containing the required JSON shape and stable IDs.
2. Extract one JSON document without accepting prose as a successful result.
3. Validate it against the stage schema and cross-field invariants, including scene IDs, exactly one `media_type`, monotonic scene timing, the final duration source, motivated A→B→A location returns, established screen-axis continuity, and declared furniture geometry consistent across the reference metadata, prop ledger, and scene prompts.
4. On validation failure, make one bounded repair attempt using only the validation errors and the previous candidate.
5. If repair still fails, persist a safe validation error or use an explicitly configured deterministic fixture; never advance malformed output to downstream workers.

The harness should record prompt-template version, model/provider identifier, validation outcome, repair count, and latency. Content quality may be evaluated separately, but schema-valid output alone must not be labeled editorially approved. Deterministic continuity checks belong in this existing harness before adding a separate paid image-review stage; if a visual mistake recurs after prompt, reference metadata, and harness enforcement, evaluate that extra stage separately. This keeps the prototype deterministic enough for pipeline tests and allows a commercial LLM adapter to replace the local model without changing downstream forms.

### Replacement path

Provider choice is deployment configuration, not workflow logic. A typical progression is:

```text
text:  fixture -> local_small_llm -> commercial_text_api
image: fixture -> local_diffusers -> commercial_image_api
i2v:   ffmpeg_motion -> local_animatediff -> seedance_or_kling
```

All implementations must accept the same stage input and return the versioned worker result defined in `contracts/`. Provider-specific request IDs and model identifiers belong in `trace` or `metrics`; media travels as artifact URIs. Switching providers must not change scene IDs, scene count, timing, progress states, or final export inputs.

Before adopting a commercial API, verify the prototype can demonstrate:

- a complete five-step run with persisted `queued`, `running`, and terminal states;
- schema rejection, one bounded LLM repair attempt, and deterministic fixture fallback;
- retry and cancellation without duplicate logical artifacts;
- per-scene progress keyed by `timeline.scenes[].id`, including out-of-order completion;
- fallback from optional generative I2V to duration-correct FFmpeg motion;
- browser recovery by polling the same job after a disconnected request;
- final duration equal to the last scene end and mobile-compatible H.264/AAC output.

Local model candidates are provisional development dependencies only. Their licenses, redistribution terms, hardware requirements, and output suitability must be reviewed independently before production use.

## Security and operations

- Keep provider keys on the worker side.
- Use signed, time-limited object-storage URLs for browser access.
- Redact prompts and provider payloads when they contain personal information.
- Enforce per-stage timeout, retry, concurrency, and cost limits.
- Record trace IDs across orchestrator, workers, providers, and FFmpeg.
- Do not depend on Render's ephemeral filesystem for production artifacts or job state.
- Persist the completed response with the render job before returning the long HTTP response. If the client connection resets, the browser must recover the result through job-status polling instead of marking a completed render as failed.

## Official references

- [Codex AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
- [Codex skills](https://developers.openai.com/codex/skills)
- [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive)
- [Codex SDK](https://developers.openai.com/codex/sdk)
- [OpenAI Agents SDK](https://platform.openai.com/docs/guides/agents-sdk)
- [OpenAI evals](https://platform.openai.com/docs/guides/evals)
- [OpenAI image generation](https://platform.openai.com/docs/guides/image-generation)
