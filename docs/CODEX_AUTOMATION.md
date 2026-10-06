# Codex automation and review harness

## Local deterministic gate

Run before commit or deployment:

```powershell
python tools/lint_project.py
```

The command validates Python syntax, inline JavaScript syntax, JSON files, duplicate HTML IDs, referenced static assets, worker dependencies, timeline continuity, narration/title counts, and repository diff whitespace.

## Non-interactive Codex review

The official Codex non-interactive interface uses `codex exec`. JSON Lines is appropriate for event streams, while `--output-schema` constrains the final response for downstream automation.

Example:

```powershell
New-Item -ItemType Directory -Force artifacts | Out-Null
codex exec --json `
  --output-schema automation/codex-review.schema.json `
  --output-last-message artifacts/codex-review.json `
  "Review this Greenhill change against AGENTS.md. Run python tools/lint_project.py and report only actionable findings."
```

Keep this optional in CI until a service account, repository trust policy, budget, and secret management are approved. Deterministic lint remains the required gate.

For GitHub-hosted Codex automation, prefer the official Codex GitHub Action rather than placing a raw API key in an arbitrary shell step.

## Skill evaluation

Starter prompts live in `.agents/skills/greenhill-content-pipeline/evals/evals.json`. They cover partial reruns, mixed image/video scenes, mobile export, provider fallback, and real worker progress. Expand them when the worker API is implemented.

