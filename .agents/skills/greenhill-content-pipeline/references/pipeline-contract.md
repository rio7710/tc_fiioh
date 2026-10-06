# Pipeline contract reference

## End-to-end phases

The final production JSON has a strict root contract: `timeline`, `timing_policy`, `narration_cues`, `postproduction`, and `output` belong inside `production`, never at the document root. The prompt harness may move an isolated misplaced section into `production`, but must reject conflicting duplicate values rather than silently dropping either one.

For shot continuity, `sequence.camera_motion` and `sequence.camera_axis_transition` must use exact schema enum values. Repair prompts restate the allowed values from the schema, and enum diagnostics include the rejected value and allowed set. If a `motivated_cross` lacks a visible camera/character crossing in its bridge and actions, repair it to `same_side`; accept explicit Korean or English descriptions of the crossing when present.

When one location reference contains multiple furniture shapes, use the scene's `continuity.props` plus its image prompt to select the specific table for that scene. Do not call distinct objects in one reference a geometry conflict if the scene consistently selects one shape.

1. **Planning:** marketing keywords, PD brief, script, shot design, storyboard integration.
2. **Production:** character resolution, scene images, bridge images, voice generation, bridge review, and user image approval.
3. **Editorial:** approved-image preview, typography, captions, BGM, narration, crop, platform selection, and scene order.
4. **Export:** image-to-video conversion, generated-video QA, settings lock, ratio-aware FFmpeg composition/encoding, and artifact registration.
5. **Distribution:** calendar entry, schedule, publish status, external calendar export.

## Worker boundary

Each worker accepts one job document and produces one result document. A worker may call one or more provider adapters, but provider-specific payloads remain inside the worker.

Required job identity:

- `job_id`: unique execution ID;
- `project_id`: stable content project ID;
- `stage`: worker ID from the manifest;
- `attempt`: retry number;
- `idempotency_key`: stable logical-operation key;
- `input`: stage-specific JSON;
- `trace`: correlation metadata.

Required result fields:

- `job_id`, `stage`, and terminal `status`;
- `artifacts`: URI, media type, checksum, and metadata;
- `metrics`: duration, provider, latency, and cost when available;
- `error`: stable code and safe message on failure.

## Timing contract

- Timeline time uses seconds from project start.
- `timeline.scenes` from the prior script/voice/storyboard stage is the only source for scene count, media type, start, end, and title/voice cue timing. UI and workers must not embed project-specific counts or cut times.
- Every timeline scene has exactly one `media_type`: `image` or `video`. Replacing an image with a generated video does not increase the scene count.
- Scene intervals are half-open: `start <= t < end`.
- Narration, captions, transitions, and scene media reference the same project clock.
- One narration cue may span multiple contiguous scenes. Every scene must reference a cue covering its interval; changing the image or video mid-sentence never starts a second voice clip or creates a narration-free scene.
- Before TTS, allocate a cue's estimated duration across its scenes using their planned relative durations. After TTS, redistribute the measured cue duration across the same scenes, preserving their order and relative rhythm; the cue and subtitle remain continuous across internal scene cuts.
- Images receive an explicit duration and are rendered as video frames during final composition.
- Kling clips use the full provider clip retimed to the scene interval: request 5 seconds for scenes up to 6.5 seconds and 10 seconds for longer scenes, then adjust playback speed instead of cutting a motion mid-action.
- Scene transitions are an editorial operation and never require an AI continuity decision. Use deterministic cut/dissolve rules after independent clips are generated.
- Kling generation references only the selected image for that scene. Do not attach `image_tail`; join independently animated scenes with an editorial cut or dissolve to prevent identity and object morphing.
- Each I2V prompt specifies one low-amplitude primary action that continues naturally through the clip. Do not request a final pose, freeze, held last frame, loop, speech/lip sync, generated cut, dissolve, overlay, location change, or follow-up action. Keep the camera locked unless one subtle continuous move is explicitly required.
- Preserve every successful scene-video generation as a candidate. Exactly one candidate per scene is selected for preview and final export, and changing the selection must persist by project, revision, and scene.
- The editorial preview and final export use the selected scene video when present and fall back to the selected scene image otherwise. Provider-video audio is always discarded; narration and BGM are the only program audio tracks.
- Browser preview and final FFmpeg output apply the same deterministic 0.3-second dissolve at every scene boundary. FFmpeg fades the outgoing scene tail over the incoming scene without shortening the master timeline or shifting cue times.
- Caption PNG generation loads the same declared webfont families, weights, CSS, and responsive dimensions as the browser preview. It must not rely on host-specific fallback fonts.

## Interactive image regeneration

- Treat the storyboard image prompt as an immutable base guide referenced by scene ID.
- Scene-image requests use only the canonical character and facility assets named by that scene. Previously generated scene images are outputs, never image-reference inputs for another scene; carry spatial and prop continuity as text in `sequence` instead.
- After an entrance door opens, the following action crosses into the interior and the next scene uses the destination interior's canonical facility reference. Do not repeat doorway compositions as separate pseudo-progress scenes.
- Accept user text only as an `additional_prompt`; never replace the base guide with it.
- Preserve the selected image and append every regenerated result as a separate candidate.
- Regenerating one scene invalidates only that scene's later image-to-video artifact and final composite, not unrelated scenes.
- Do not start image-to-video generation until the user has approved the scene image candidates.

## Spatial progression continuity

- Treat a character's movement through doors, corridors, stairs, elevators, and room boundaries as a forward state transition, not a reusable pose.
- Record the current zone, crossed threshold, travel direction, and next destination in each scene's `sequence.entry_action`, `sequence.exit_action`, `sequence.continuity_anchor`, and `sequence.character_blocking`.
- Once a character crosses a threshold, later scenes inherit the new side of that threshold. Do not place the character back at the prior side or repeat the same entrance unless the narrative explicitly requires a return journey and shows the reason and intervening movement.
- Image prompts must state the inherited spatial state and forbid backtracking, oscillating around a doorway, repeated entry, or teleporting between zones.
- Once a scene leaves a location, it cannot return to that location until an explicit, narratively motivated route back is recorded in the intervening scene's exit and next scene's entry actions. The generation harness rejects an unmotivated A→B→A location sequence.
- Preserve the established 180-degree action axis across framing changes. Changing from a two-shot to a single-person close-up is allowed, but the camera must not silently jump to the opposite side or swap left/right eyelines.
- Persist this plan in `sequence.camera_axis_transition`: `establish` for the first shot, `same_side` by default thereafter, and `motivated_cross` only when a visible camera/character move across the axis is described. The structured generation harness supplies safe defaults and rejects an unmotivated crossing.
- Canonical location references are authoritative for furniture geometry. Store known shape (for example, a round activity table) in the reference asset usage and `production.continuity.props`; every scene prompt using that location must repeat it. The harness rejects missing or contradictory shape descriptions.

## Reliability

- Persist state transitions before emitting progress events.
- Retry transient provider/network failures with bounded exponential backoff.
- Do not retry validation, policy, or unsupported-format errors without changed input.
- Use leases or a queue visibility timeout so a crashed worker can be recovered.
- Record provider request IDs without exposing secrets.
- Cancellation must be checked before expensive provider or FFmpeg work.
- The final response is persisted on the render job before the HTTP response is sent. A dropped browser connection must be recoverable by polling the same `job_id`.

## Distribution uniqueness

- A publication is unique by content identity, local calendar date, and platform.
- The same content may target multiple platforms on one date, but it may have only one entry per platform that day.
- Calendar hydration must collapse legacy duplicates by the same uniqueness key before rendering or saving.
- Media readiness and publication state are independent. A playable final artifact may open in preview while its channel icon remains inactive until publication succeeds.
- The calendar records intent only. A distribution worker is the sole owner of platform delivery and updates the publication status, provider receipt, `published_at`, and public `published_url` after confirmed delivery.
- Content identity and creation time come from the project/content record. Store `scheduled_local_date` only as mutable calendar intent; do not duplicate the content creation timestamp as distribution metadata.
- Re-exporting the same content and platform appends an immutable final-output candidate instead of replacing the prior artifact. Calendar preview exposes previous/next version navigation and defaults to the newest candidate.

## Provider adapters

- Text/review: OpenAI or Claude adapters.
- Image generation: Nano Banana or another image adapter.
- Voice: TTS/Voice adapter; STT remains a separate transcription concern.
- Image-to-video: Seedance, Kling, or another I2V adapter.
- Final assembly: FFmpeg worker, independent of generation providers; it also performs the selected ratio crop and H.264/AAC mobile-compatible encode.

## Scene conversion progress

- Image-to-video progress is keyed by the stable `timeline.scenes[].id`, never by a hardcoded scene count.
- Provider task events map to `queued`, `running`, `succeeded`, or `failed`; UI badges must reflect those states independently because scenes may finish out of order.
- Demo mode may emit shuffled synthetic completion events, but production mode must update the same badge event handler from Seedance/Kling task responses.
- Scene-image generation uses the same scene-ID badge event handler; demo events are synthetic and production events come from the configured image provider response.
- Final FFmpeg composition uses sequential badge completion derived from real `out_time` crossing each data-driven scene end time; it must not use shuffled demo completion.
- Final composition is keyed by each unique selected output ratio. Only user-selected platform icons are shown; platforms sharing a ratio move together because they reuse the same encoded artifact. Icons are gray while queued and use their original brand color while running or succeeded.
