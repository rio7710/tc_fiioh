# Access and deployment runbook

Last updated: 2026-10-06 (Asia/Seoul)

## Access information

| Purpose | Address |
|---|---|
| Active Production / Isolated Proxy Domain | https://fiioh.co.kr (Caddy proxy -> `127.0.0.1:43110` / `127.0.0.1:8765`) |
| Temporary Docker Compose Port | http://127.0.0.1:43110 |
| Public workflow demo | https://greenhill-content-demo.onrender.com/01_app/P1_title_design_preview.html |
| Internal pricing page (`00`) | https://greenhill-content-demo.onrender.com/01_app/P0_pricing_preview.html |
| Render health check | https://greenhill-content-demo.onrender.com/health |
| Git repository | https://github.com/rio7710/greenhill-content-demo |
| Local workflow default (standalone) | http://127.0.0.1:8765/01_app/P1_title_design_preview.html |
| Local pricing page default | http://127.0.0.1:8765/01_app/P0_pricing_preview.html |

For site isolation details and architectural plans:
- Active Plan: [TEMP_SITE_ISOLATION_OPTIMIZATION_PLAN_2026-10-06.md](TEMP_SITE_ISOLATION_OPTIMIZATION_PLAN_2026-10-06.md)
- Archived Legacy Plan (2026-09-15): [TC_TEMP_ISOLATION_PLAN_2026-09-15.md](TC_TEMP_ISOLATION_PLAN_2026-09-15.md)

The port may differ when another local server already uses 8765 or 43110. The server prints the exact local and LAN addresses at startup. A temporary development port is not a permanent product URL and must not be written into UI code or saved project data.

## Local execution

1. Double-click `P1_미리보기_및_변환_실행.bat`, or run `python 01_app/render_server.py` from the repository root.
2. Keep the terminal process open while using the demo.
3. Open the address printed as `이 PC에서 열기`.
4. For another device, use the printed LAN address while both devices are on the same Wi-Fi. Allow the Python process through Windows Firewall only on the intended private network.

Optional environment variables:

```powershell
$env:PORT='8779'
$env:P1_NO_BROWSER='1'
$env:RENDER_PRESET='ultrafast'
$env:FFMPEG_THREADS='4'
python 01_app/render_server.py
```

- `PORT` selects a free local port; the default is 8765.
- `P1_NO_BROWSER=1` prevents automatic browser launch.
- `RENDER_PRESET` and `FFMPEG_THREADS` tune local FFmpeg performance.
- Restart the Python server after changing `render_server.py`. HTML/CSS/JavaScript is read on request, but a hard refresh may still be needed because of an already open tab.

## Provider API connections

The workflow exposes one global API settings modal above the five steps. Each step reads only the providers it needs from that shared connection registry and opens the same modal with its required candidates highlighted before a progress workflow can start. Local operators may enter credentials in that modal; the server validates them against the provider and keeps successful values in process memory only. They disappear when the server stops and are never returned to the browser or written to `localStorage`.

For persistent or hosted configuration, set these server-side environment variables and restart/redeploy:

| Provider | Environment variables |
|---|---|
| OpenAI | `OPENAI_API_KEY` |
| Anthropic Claude | `ANTHROPIC_API_KEY` |
| Google Gemini / Nano Banana | `GEMINI_API_KEY` |
| BytePlus ModelArk / Seedance | `ARK_API_KEY` |
| Kling AI | `KLING_API_KEY` |

The prompt lab can call Gemini for text or image generation without changing project data. Hosted calls use the same HTTP Basic protection as the Kling lab. A key entered directly in the lab is used for one request and is not placed in the server credential registry; an already configured server-side key remains an optional fallback. Use `GEMINI_TEXT_MODEL` to override its default `gemini-3.6-flash` model and `GEMINI_IMAGE_MODEL` to override its default `gemini-3.1-flash-image`. Prompt-lab inputs and outputs are not persisted.

The public Render site deliberately disables credential submission because the demo has no production user authentication or per-tenant secret vault. Configure hosted credentials only through Render Dashboard → Environment. The settings API returns connection status and metadata, never credential values.

The hosted Kling pipeline lab is protected with HTTP Basic authentication and uses only the server-side `KLING_API_KEY` when its key field is left blank. Its generated files use Render's ephemeral filesystem and are not durable across restarts or redeploys.

## Hosted/Render boundary

- `render.yaml` defines the `greenhill-content-demo` Render web service, free plan, `/health` check, one FFmpeg thread, and headless browser launch disabled.
- The public Render deployment is a UI/API preview only. `render_server.py` returns 503 for `/render` when Render environment variables are detected.
- Do not promise public FFmpeg export from the current Render service. Use the local address for caption PNG generation and final MP4 export.
- Render's filesystem is ephemeral. Do not rely on hosted `demo_data.json`, caption registries, generated MP4s, or temporary files as durable production storage.
- Production requires persistent job/event storage plus object storage or a verified persistent disk.

## Git and account authentication

- The deployment source is `origin/main` at `rio7710/greenhill-content-demo`.
- GitHub and Render browser/CLI authentication is device-specific. Moving to another PC normally requires signing in and approving the device again.
- Credentials may be retained by the OS credential manager on the same PC. Never commit passwords, PATs, API keys, cookies, `.env` files, or browser profiles.
- Authentication approval is not part of the repository and must not be simulated or copied between machines.

## Deployment workflow

1. Preserve unrelated working-tree changes and stage only the intended source/document files.
2. Run `python tools/lint_project.py`.
3. For Python changes, also run `python -m py_compile 01_app/render_server.py`.
4. For contract/media changes, run `python -m unittest discover -s tests -v` and the media checks required by `AGENTS.md`.
5. Commit to `main` with a focused message and push to `origin main`.
6. Render automatically deploys the pushed `main` commit. Wait until the service is `live`; a successful Git push alone is not deployment confirmation.
7. Verify `/health`, then open the exact public P1 and P0 URLs. Hard-refresh or use a commit query string if a browser tab is stale.
8. Confirm the changed UI marker/behavior is present and report the deployed commit hash and any hosted limitations.

## Deployment rules

- Do not deploy generated exports, caption caches, runtime caption registry changes, provider responses, secrets, or local source clips unless a task explicitly changes the approved demo asset set.
- Do not stage unrelated `demo_data.json` changes or untracked scene images while deploying code/documentation work.
- Do not change the public URL in application code to a localhost address.
- Local FFmpeg URLs and public Render URLs must be reported separately.
- A UI deployment is not proof that FFmpeg works on Render; final-export verification must use the local server until the production worker/object-storage architecture is deployed.
- If a deployment fails, diagnose the Render build/runtime log and fix forward with a new commit. Do not rewrite shared history or use destructive Git resets.
- When rollback is required, revert the specific bad commit with a new commit after confirming the target; preserve runtime/user data and unrelated work.

## Verification checklist

- [ ] Repository quality gate passes.
- [ ] P1 workflow URL loads and `/health` returns `{"ok": true}`.
- [ ] P0 pricing URL loads when pricing was changed.
- [ ] Mobile layout and inline JavaScript were checked for UI changes.
- [ ] Local final export was checked for duration, dimensions, frame rate, H.264/AAC, yuv420p, and caption/narration timing when media code changed.
- [ ] Public and local limitations were stated in the handoff.
- [ ] Deployed commit hash was recorded.
