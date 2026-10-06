# Final export pipeline status

Last updated: 2026-08-31 (Asia/Seoul)

## Current implementation

- The demo UI and preview timeline live in `01_app/P1_title_design_preview.html`.
- `01_app/render_server.py` creates transparent caption PNGs, validates them, and reassembles the scene MP4 files on every export.
- Scene count, media type, order, and duration come from `timeline.scenes`; the final scene end is the master duration.
- User choices for caption style/size, narration, BGM, volume, horizontal crop focus, and selected platforms are applied to the export request.
- Caption PNGs are generated per output ratio and sentence. Generation uses batches of four with at most two Edge renderers in parallel.
- Caption artifacts use UUIDv5 identities and are tracked in `01_app/data/caption_artifacts.json`. Temporary PNG, HTML, and browser-profile resources are cleaned after all merges finish or fail.
- A merge cannot start until every expected caption PNG exists, has a valid size, and is marked `succeeded` in the registry.
- FFmpeg performs scene crop/scale, timeline concatenation, transparent caption overlay, narration/BGM mixing, and H.264/AAC/yuv420p/faststart encoding in one operation per unique ratio.
- Selected platforms sharing the same ratio reuse one output file. There is no second simulated “distribution optimization” pass.
- Final-composition progress comes from FFmpeg `out_time`. Only selected platform icons appear next to the stage; queued icons are gray and running/completed icons use their original brand colors.
- Completed render responses are stored on the job. The UI recovers through `/api/render/status` if the long `/render` connection is reset, and errors no longer close the progress modal automatically.

## Output presets

| Platforms | Output | Ratio |
|---|---:|---:|
| YouTube, Naver, KakaoTalk, X | 1280 × 720 | 16:9 |
| Instagram Reels, TikTok, Threads | 720 × 1280 | 9:16 |
| Facebook Feed, LinkedIn | 720 × 900 | 4:5 |

The completed preview reads the actual video dimensions instead of guessing from the platform name. Card previews use `cover`; native fullscreen uses `contain` so 9:16 and 4:5 frames are not crop-zoomed on a 16:9 monitor.

## Caption typography

- Preview CSS is also the source for transparent PNG rendering, keeping preview and export shapes synchronized.
- The current Bubble Pop preset follows the approved clipboard reference: yellow fill, orange/red inner stroke, thick white sticker outline, and lower gray depth shadow.
- Changing typography invalidates the caption overlay signature so stale PNGs are not reused.

## Deployment boundary

- The public Render service hosts the demo UI, but local FFmpeg export remains the supported execution path for this demo.
- Production must move media to object storage and persist jobs/results outside Render's ephemeral filesystem.
- Access URLs, device authentication, deployment verification, and rollback rules are maintained in `docs/DEPLOYMENT.md`.

## TODO — thumbnail workflow

- [ ] Define thumbnail targets per platform and whether platforms sharing a video ratio may share a thumbnail.
- [ ] Add a thumbnail selection/generation step after final video QA and before artifact registration.
- [ ] Support choosing a timeline frame and uploading or generating a separate thumbnail image.
- [ ] Add title-safe-area, focal-point crop, and text-style controls per target ratio.
- [ ] Generate deterministic thumbnail artifacts with `job_id`, `project_id`, checksum, width, height, ratio, and source-frame metadata.
- [ ] Show thumbnail previews beside each selected platform and require user approval before scheduling.
- [ ] Store approved thumbnail URIs in registered artifacts and calendar entries.
- [ ] Add validation/tests for exact dimensions, selected-platform-only outputs, retry/idempotency, and object-storage cleanup.

Acceptance criteria: a user can create or select one thumbnail source, inspect every selected platform crop, override individual variants, approve them, and see the approved thumbnail attached to the registered distribution artifact without changing the master video timeline.
