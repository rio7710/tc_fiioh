from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
HTML_PATH = ROOT / "01_app" / "P1_title_design_preview.html"
APP_BOOTSTRAP_PATH = ROOT / "01_app" / "assets" / "core" / "app-bootstrap.js"


class LintFailure(RuntimeError):
    pass


def run(label: str, command: list[str]) -> None:
    completed = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
    if completed.returncode:
        detail = (completed.stdout + completed.stderr).strip()
        raise LintFailure(f"{label} failed\n{detail}")
    print(f"[PASS] {label}")


def check_json() -> None:
    paths = [
        *sorted((ROOT / "01_app" / "data").glob("*.json")),
        *sorted((ROOT / "contracts").glob("*.json")),
        *sorted((ROOT / "automation").glob("*.json")),
        *sorted((ROOT / ".agents" / "skills").glob("*/evals/*.json")),
    ]
    for path in paths:
        json.loads(path.read_text(encoding="utf-8"))
    print(f"[PASS] JSON syntax ({len(paths)} files)")


def check_html() -> None:
    html = HTML_PATH.read_text(encoding="utf-8")
    ids = re.findall(r'\bid=["\']([^"\']+)["\']', html)
    duplicates = sorted({value for value in ids if ids.count(value) > 1})
    if duplicates:
        raise LintFailure(f"duplicate HTML ids: {', '.join(duplicates)}")

    missing = []
    for _, raw_url in re.findall(r'\b(src|href)=["\']([^"\']+)["\']', html):
        parsed = urlsplit(raw_url)
        if parsed.scheme or not parsed.path.startswith("/") or "." not in Path(parsed.path).name:
            continue
        local_path = ROOT / unquote(parsed.path.lstrip("/"))
        if not local_path.is_file():
            missing.append(parsed.path)
    if missing:
        raise LintFailure("missing local HTML assets: " + ", ".join(sorted(set(missing))))
    print(f"[PASS] HTML ids and local assets ({len(ids)} ids)")


def check_inline_javascript() -> None:
    node = shutil.which("node")
    if not node:
        raise LintFailure("Node.js is required to validate inline JavaScript")
    html = HTML_PATH.read_text(encoding="utf-8")
    scripts = [body for body in re.findall(r"<script(?:\s[^>]*)?>([\s\S]*?)</script>", html, re.I) if body.strip()]
    with tempfile.TemporaryDirectory(prefix="greenhill-lint-") as temp_dir:
        for index, script in enumerate(scripts):
            path = Path(temp_dir) / f"inline-{index}.js"
            path.write_text(script, encoding="utf-8")
            run(f"inline JavaScript #{index + 1}", [node, "--check", str(path)])
    run("app bootstrap JavaScript", [node, "--check", str(APP_BOOTSTRAP_PATH)])


def main() -> int:
    try:
        check_json()
        check_html()
        check_inline_javascript()
        run("Python syntax", [sys.executable, "-m", "py_compile", "01_app/render_server.py"])
        run("pipeline contract tests", [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"])
        if shutil.which("git"):
            run("Git whitespace", ["git", "diff", "--check"])
    except (LintFailure, json.JSONDecodeError, OSError) as error:
        print(f"[FAIL] {error}", file=sys.stderr)
        return 1
    print("[PASS] Greenhill quality gate")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
