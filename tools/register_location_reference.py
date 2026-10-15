#!/usr/bin/env python3
"""Register one approved location image in a group's canonical reference library."""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import shutil
import sqlite3
import struct
import unicodedata
from datetime import datetime, timezone
from pathlib import Path


INDEX_KEY = "GREENHILL_REFERENCES/greenhill_reference_index.json"
DEFAULT_MANIFEST_KEY = "greenhill-facilities-characters"
RESOURCE_MANIFEST_KEY = "kakaotalk-greenhill-bundle"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as source:
        header = source.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError(f"not a PNG: {path}")
    return struct.unpack(">II", header[16:24])


def _upsert_file(files: list[dict], entry: dict) -> None:
    logical_path = unicodedata.normalize("NFC", str(entry["logical_path"]))
    files[:] = [
        item for item in files
        if unicodedata.normalize("NFC", str(item.get("logical_path") or "")) != logical_path
    ]
    files.append(entry)
    files.sort(key=lambda item: unicodedata.normalize("NFC", str(item.get("logical_path") or "")))


def register_location(
    sqlite_path: Path,
    source: Path,
    asset_dir: Path,
    group_id: str,
    filename: str,
    asset_id: str,
    usage: str,
    aliases: list[str],
) -> dict:
    if not source.is_file():
        raise FileNotFoundError(source)
    width, height = png_size(source)
    if abs((width / height) - (16 / 9)) > 0.002:
        raise ValueError(f"location reference must be 16:9: {width}x{height}")
    digest = sha256(source)
    size = source.stat().st_size
    logical_path = f"시설/{filename}"
    uri = f"group://{group_id}/resources/{logical_path}"
    asset = {
        "id": asset_id,
        "kind": "location",
        "status": "ready",
        "uri": logical_path,
        "source_filename": filename,
        "assignment": "connector_corridor",
        "source_kind": "ai_supplemented_reference",
        "aliases": aliases,
        "usage": usage,
        "sha256": digest,
        "pixel_mode": "RGB",
        "width": width,
        "height": height,
    }
    file_entry = {
        "path": logical_path,
        "logical_path": logical_path,
        "uri": uri,
        "size": size,
        "sha256": digest,
        "media_type": mimetypes.guess_type(filename)[0] or "image/png",
    }

    connection = sqlite3.connect(sqlite_path, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout=30000")
    rows = connection.execute(
        "SELECT resource_id, resource_type, resource_key, payload_json "
        "FROM group_resources WHERE group_id=? AND resource_key IN (?, ?, ?)",
        (group_id, INDEX_KEY, DEFAULT_MANIFEST_KEY, RESOURCE_MANIFEST_KEY),
    ).fetchall()
    resources = {row["resource_key"]: row for row in rows}
    required = {INDEX_KEY, DEFAULT_MANIFEST_KEY, RESOURCE_MANIFEST_KEY}
    if set(resources) != required:
        missing = ", ".join(sorted(required - set(resources)))
        raise RuntimeError(f"required group resources are missing: {missing}")

    payloads = {key: json.loads(row["payload_json"]) for key, row in resources.items()}
    index = payloads[INDEX_KEY]["document"]
    assets = [item for item in index.get("assets", []) if str(item.get("id")) != asset_id]
    assets.append(asset)
    index["assets"] = assets
    ready_locations = [
        item for item in assets
        if item.get("kind") == "location" and item.get("status") == "ready"
    ]
    index.setdefault("summary", {})["ready_locations"] = len(ready_locations)
    index.setdefault("rules", {})["connector_corridor"] = (
        "문·문손잡이·문턱 대신 등록된 연결 복도를 장소 전환 브리지로 사용한다. "
        "실제 시설 사진으로 단정하지 않고 인물 전신 비율과 발 접지를 유지한다."
    )

    for key in (DEFAULT_MANIFEST_KEY, RESOURCE_MANIFEST_KEY):
        manifest = payloads[key]
        files = manifest.setdefault("files", [])
        _upsert_file(files, file_entry)
        if "file_count" in manifest:
            manifest["file_count"] = len(files)

    asset_dir.mkdir(parents=True, exist_ok=True)
    target = asset_dir / filename
    temporary = target.with_suffix(target.suffix + ".part")
    staged = False
    target_existed = target.exists()
    try:
        if target_existed:
            if sha256(target) != digest:
                raise FileExistsError(f"different asset already exists: {target}")
        else:
            shutil.copy2(source, temporary)
            if sha256(temporary) != digest:
                raise OSError(f"copy verification failed: {target}")
            temporary.replace(target)
            staged = True

        stamp = datetime.now(timezone.utc).isoformat()
        connection.execute("BEGIN IMMEDIATE")
        for key, payload in payloads.items():
            if key == INDEX_KEY:
                payload["sha256"] = hashlib.sha256(
                    json.dumps(payload["document"], ensure_ascii=False, sort_keys=True).encode("utf-8")
                ).hexdigest()
            connection.execute(
                "UPDATE group_resources SET payload_json=?, updated_at=? WHERE resource_id=?",
                (json.dumps(payload, ensure_ascii=False, sort_keys=True), stamp, resources[key]["resource_id"]),
            )
        connection.commit()
    except Exception:
        connection.rollback()
        temporary.unlink(missing_ok=True)
        if staged and not target_existed:
            target.unlink(missing_ok=True)
        raise
    finally:
        connection.close()

    return {
        "asset_id": asset_id,
        "filename": filename,
        "sha256": digest,
        "width": width,
        "height": height,
        "target": str(target),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sqlite", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--asset-dir", type=Path, required=True)
    parser.add_argument("--group-id", required=True)
    parser.add_argument("--filename", required=True)
    parser.add_argument("--asset-id", required=True)
    parser.add_argument("--usage", required=True)
    parser.add_argument("--alias", action="append", default=[])
    args = parser.parse_args()
    result = register_location(
        args.sqlite, args.source, args.asset_dir, args.group_id,
        args.filename, args.asset_id, args.usage, args.alias,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
