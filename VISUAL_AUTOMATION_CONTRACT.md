# Visual automation v1 (isolated rollout)

POST /api/storyboard/auto-select takes project_id and count (0..200), returns exactly
min(count, scene count) unique scene IDs with GPT reasons. All source images must exist.
Selection is based on the script, motion prompts and selected images. The result is
persisted by owner, script revision, model, requested count and immutable media fingerprints.
No Kling calls are made by the selection endpoint. Automation start delegates scene choice
to GPT; the persisted selection decision is the approval record for the chosen images.

POST /api/project/auto-crop takes project_id, scene_id and apply (default false).
The selected video takes precedence over the selected image. Videos are sampled at
10%, 50%, 90%; the output is one static horizontal position per 9x16 and 4x5 format.
No vertical motion, zoom or dynamic tracking. No source files are modified.
Finite normalized person bounds and confidence are validated. Empty scenes keep existing
positions. Fit the whole group when possible; otherwise fit one scene-relevant person
for the affected ratios. Use the same anonymous person across all video samples and
both fallback ratios. Low confidence, missing continuity, or no single person fitting
triggers needs_review and does not overwrite stored positions; automation stops for review.
Crop policy v3 excludes background extras from protected bounds and fallback targets.
Unknown roles or a missing main subject require review, not substitution by an extra.
The separate policy cache key prevents reuse of older group-only/extra-inclusive results.
Manual overrides made while a
request is running are preserved with a transactional compare-and-swap.

Existing selected media, revision and crop values are checked again before applying.
Provider response IDs/usage are recorded, but image data, paths and secrets are never
returned to the browser. Results are cached persistently. Concurrent identical requests
cannot duplicate model calls; uncertain in-flight attempts are not automatically repeated.

Orchestration: images/voice -> GPT selection -> selected Kling jobs -> poll actual
completion -> person-aware crop (if enabled) -> design -> MP4 -> production calendar.
Unselected scenes remain images. Reuse provider task IDs after restart; never blindly
re-submit an uncertain Kling creation request. Cancellation is checked between polling calls.

Verification is isolated: temporary DB/copies of existing media, maximum 5 total real
external API requests for this task. Mocked transport/state tests do not consume this budget.
No production schedule is started and no existing project is changed by tests.

New script/storyboard prompts require at least one main subject to remain crop-safe,
not every extra. Planned anonymous extras are stored as sourced text in existing
continuity.characters and repeated in scene sequence/image prompts with stable IDs,
wardrobe and seating; no invented canonical reference IDs or new DB fields are needed.
Framing may hide extras without changing their actual location state. Adjacent similar
shots explicitly vary distance/zoom/angle while preserving screen axis and crop margins.
Subtle environment motion is allowed only for existing, physically plausible elements
and never replaces the primary I2V action or generates a new shot transition.

Voice ownership is narration cue + project + script revision + voice profile, not
each visual scene. A continuation scene reuses the cue owner's WAV. Individual
and bulk generation retain the original cue ordinal; concurrent same-revision
requests are serialized before checking stored files. Existing legacy bindings
are normalized to the cue's first scene on read, without deleting old artifacts.
Matching text in separate cues remains separate. Automation accepts optional
voice.profile_id (legacy settings default to warm_female), selects it through
the existing voice API before script confirmation and prepares shared cues once.
