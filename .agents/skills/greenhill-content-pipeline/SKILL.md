---
name: greenhill-content-pipeline
description: Maintain and extend the Greenhill Content Studio demo and its future worker-based AI production pipeline. Use this skill whenever a request mentions the Greenhill demo, workflow steps 01-05, storyboard/script generation, characters, scene or bridge images, TTS/STT, Seedance/Kling image-to-video generation, FFmpeg export, captions, scene timing, distribution platforms, calendar jobs, API workers, orchestration, pipeline contracts, or deployment—even when the user only asks for a small UI change inside that flow.
---

# Greenhill content pipeline

Use this workflow to keep the demo coherent while it evolves into independent API workers.

## Start here

1. Read the repository `AGENTS.md`.
2. Inspect the relevant UI, server, manifest, and contracts before editing.
3. Read `references/pipeline-contract.md` when changing stages, jobs, media timing, providers, or outputs.
4. Preserve unrelated user work and the deployed demo behavior.

## Classify the request

- **UI-only:** layout, typography, controls, modal copy, responsive behavior.
- **Timeline/media:** scene cuts, title cues, narration, music, transitions, aspect ratios.
- **Worker/API:** stage boundaries, job state, retries, provider adapters, schemas.
- **Final export:** FFmpeg composition, H.264/AAC compatibility, download registration.
- **Distribution/calendar:** platform selections, status, scheduling, ICS, pipeline records.

When a request crosses categories, update the contract first, then implementation and UI.

## Sources of truth

- UI and scene preview: `01_app/P1_title_design_preview.html`
- Current Python API/export: `01_app/render_server.py`
- Base storyboard generation contract: `prompts/unified_content_production_v1.md`
- Structured generation and repair harness: `tools/unified_content_prompt_harness.py`
- Worker roadmap: `01_app/data/pipeline_manifest.json`
- Job/result validation: `contracts/*.schema.json`
- Architecture decisions: `docs/AGENT_ARCHITECTURE.md`

## Brand assets

- Public name: `생각담 | ThinkCast`.
- Approved source capture: `01_app/assets/brand/thinkcast-user-logo-source.png`.
- Light-background wordmark: `01_app/assets/brand/thinkcast-user-logo.png`.
- Dark-background inverse wordmark: `01_app/assets/brand/thinkcast-user-logo-inverse.png`.
- Browser symbols: matching `thinkcast-user-symbol*.png` files.
- Preserve the orange point when creating inverse assets; invert only the navy artwork to ivory and keep the background transparent.
- Verify derived PNG assets use a 32-bit alpha pixel format and contain transparent pixels before referencing them in HTML.
- For outro assets, follow `docs/BRAND_ASSET_GUIDE.md`: composite sample media, then the white/black alpha background layer, then the ratio-specific transparent PNG. Preview and FFmpeg export must use the same order.
- Do not create or deploy replacement symbols without explicit user approval.

Avoid inventing a second stage list or timing table. If temporary duplication is unavoidable, extend the lint harness so drift is detected.

## Implementation rules

- Keep each worker focused on one durable output.
- Pass immutable input references and return explicit artifacts plus metrics.
- Keep providers swappable through adapter names in the manifest.
- Use job IDs and idempotency keys for retries.
- Update UI progress from worker events; do not fake completion before the underlying job succeeds.
- Separate image-to-video generation from final FFmpeg assembly.
- Keep image scenes compatible with independent narration and BGM tracks.
- For storyboard scenes, preserve the canonical location/furniture geometry and the established 180-degree camera axis. A location change is a one-way sequence until a visible, motivated return is scripted; do not teleport back on the next scene.
- Record known table/furniture shape in the reference asset metadata and `production.continuity.props`; carry it into every affected scene prompt. Prompt rules alone are insufficient when the structured generation harness can reject missing or contradictory continuity data.
- Preserve mobile H.264/AAC/yuv420p/faststart export settings.

## Verification

Run:

```powershell
python tools/lint_project.py
python -m unittest discover -s tests -p 'test_unified_content_prompt_harness.py' -v
```

For media changes, additionally inspect output metadata with FFprobe and confirm the final duration matches the final `timeline.scenes[].end` value.

For deployment changes, verify the public HTML marker and deployed commit after the service becomes live.

## Expected handoff

Report:

- what changed;
- which worker or product stage it affects;
- what was validated;
- whether deployment occurred;
- any production-only dependency still marked as planned.
