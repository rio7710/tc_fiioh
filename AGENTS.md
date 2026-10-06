# Greenhill Content Studio agent guide

## Scope

These instructions apply to the entire repository. Keep this file concise: durable repository rules belong here, while repeatable workflows belong in `.agents/skills/greenhill-content-pipeline/`.

## Product contract

- Preserve the five-step binder-style flow: login, keyword selection, script, video design, content calendar.
- The public brand is `생각담 | ThinkCast`; the descriptor is `AI SOCIAL CONTENT STUDIO` and the cover tagline is `당신의 생각을, 고객이 원하는 콘텐츠로.`
- Use the approved user-provided inverse wordmark on dark walnut or deep-green surfaces: ivory lettering with the orange point unchanged and no background plate. Do not substitute generated or improvised logo marks without explicit approval.
- Treat `01_app/P1_title_design_preview.html` as the demo UI and preview-timeline source.
- Treat `01_app/render_server.py` as the current HTTP API and FFmpeg export implementation.
- Treat `01_app/data/pipeline_manifest.json` as the future worker/orchestration contract.
- The master duration comes from the final `timeline.scenes[].end` value. Scene, title, narration, transition, and export timing must stay synchronized.
- A scene may use an image or a video. Voice and BGM are independent media tracks.
- Never hardcode a scene count or cut timing in UI or export code. Read both from the previous-stage `timeline.scenes` JSON; each scene has exactly one `media_type` (`image` or `video`).
- Calendar distribution uniqueness is `content + local date + platform`. The same content cannot have more than one entry for the same platform on the same day.

## Change workflow

1. Read the closest applicable `AGENTS.md` and the Greenhill pipeline skill before changing workflow, media, worker, or export behavior.
2. Inspect existing user changes and preserve unrelated work.
3. Update the smallest source of truth possible. When timing changes, update every mirrored timing definition or centralize it.
4. Keep API and worker outputs JSON-serializable and versioned.
5. Run `python tools/lint_project.py` before handing off a change.
6. For UI changes, also verify inline JavaScript syntax and mobile behavior.
7. For media changes, verify duration, dimensions, frame rate, H.264/AAC compatibility, and narration/title sync.

## Worker architecture

- Model every long-running operation as a job with `job_id`, `project_id`, `stage`, `status`, `attempt`, `input`, and `trace` metadata.
- Make workers idempotent. Replaying the same job must reuse or safely replace the same logical output.
- Store large media in object storage later; pass URIs and metadata through JSON rather than base64 blobs.
- Keep provider adapters behind worker boundaries. Orchestration must not depend directly on ChatGPT, Claude, Nano Banana, Seedance, Kling, or a specific TTS provider.
- Validate worker input and output against the schemas in `contracts/`.
- Use explicit states: `queued`, `running`, `succeeded`, `failed`, `cancelled`.
- Never expose API keys, provider secrets, local paths, or internal exception traces to the browser.

## Quality and safety

- Do not silently shorten or shift the data-driven project timeline.
- Do not overwrite source clips or user exports unless the task explicitly requires it and the target is verified.
- Do not commit generated exports, caches, secrets, or provider responses containing sensitive data.
- Keep the demo dependency-light. New production dependencies need a clear operational reason.
- A change is complete only when lint passes, relevant behavior is exercised, and deployment status is reported when deployment was requested.

## Commands

```powershell
python tools/lint_project.py
python -m unittest discover -s tests -v
python -m py_compile 01_app/render_server.py
```
