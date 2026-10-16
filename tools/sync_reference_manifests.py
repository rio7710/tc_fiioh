#!/usr/bin/env python3
"""Synchronize canonical ready reference media into both group manifests."""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import sqlite3
import unicodedata
from datetime import datetime, timezone
from pathlib import Path


INDEX_KEY = "GREENHILL_REFERENCES/greenhill_reference_index.json"
MANIFEST_KEYS = ("greenhill-facilities-characters", "kakaotalk-greenhill-bundle")
KIND_DIRS = {"character": "characters", "location": "locations"}


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def normalized(value: object) -> str:
    return unicodedata.normalize("NFC", str(value or ""))


def sync(sqlite_path: Path, asset_root: Path, group_id: str) -> dict:
    connection = sqlite3.connect(sqlite_path, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout=30000")
    keys = (INDEX_KEY, *MANIFEST_KEYS)
    rows = connection.execute(
        f"SELECT resource_id, resource_key, payload_json FROM group_resources "
        f"WHERE group_id=? AND resource_key IN ({','.join('?' for _ in keys)})",
        (group_id, *keys),
    ).fetchall()
    resources = {row["resource_key"]: row for row in rows}
    if set(resources) != set(keys):
        raise RuntimeError(f"required group resources are missing: {sorted(set(keys) - set(resources))}")
    payloads = {key: json.loads(resources[key]["payload_json"]) for key in keys}
    index = payloads[INDEX_KEY].get("document", payloads[INDEX_KEY])
    ready = [item for item in index.get("assets", []) if item.get("status") == "ready"]
    ids = [str(item.get("id") or "") for item in ready]
    uris = [normalized(item.get("uri")) for item in ready]
    if any(not value for value in ids + uris) or len(set(ids)) != len(ids) or len(set(uris)) != len(uris):
        raise ValueError("ready reference IDs and URIs must be present and unique")

    entries = []
    for asset in ready:
        kind = str(asset.get("kind") or "")
        if kind not in KIND_DIRS:
            raise ValueError(f"unsupported ready reference kind: {kind}")
        uri = normalized(asset["uri"])
        filename = Path(uri).name
        path = asset_root / KIND_DIRS[kind] / filename
        if not path.is_file():
            raise FileNotFoundError(f"ready reference file is missing: {uri}")
        checksum = digest(path)
        expected = str(asset.get("sha256") or "")
        if expected and expected != checksum:
            raise ValueError(f"reference checksum mismatch: {asset['id']}")
        entries.append({
            "path": uri, "logical_path": uri,
            "uri": f"group://{group_id}/resources/{uri}",
            "size": path.stat().st_size, "sha256": checksum,
            "media_type": mimetypes.guess_type(filename)[0] or "image/png",
        })

    changed = {}
    for key in MANIFEST_KEYS:
        files = payloads[key].setdefault("files", [])
        by_path = {normalized(item.get("logical_path") or item.get("path")): item for item in files}
        before = len(by_path)
        by_path.update({normalized(item["logical_path"]): item for item in entries})
        payloads[key]["files"] = [by_path[path] for path in sorted(by_path)]
        if "file_count" in payloads[key]:
            payloads[key]["file_count"] = len(payloads[key]["files"])
        changed[key] = {"before": before, "after": len(payloads[key]["files"])}

    stamp = datetime.now(timezone.utc).isoformat()
    try:
        connection.execute("BEGIN IMMEDIATE")
        for key in MANIFEST_KEYS:
            connection.execute(
                "UPDATE group_resources SET payload_json=?, updated_at=? WHERE resource_id=?",
                (json.dumps(payloads[key], ensure_ascii=False, sort_keys=True), stamp,
                 resources[key]["resource_id"]),
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    return {"ready_assets": len(entries), "manifests": changed, "updated_at": stamp}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sqlite", type=Path, required=True)
    parser.add_argument("--asset-root", type=Path, required=True)
    parser.add_argument("--group-id", required=True)
    args = parser.parse_args()
    print(json.dumps(sync(args.sqlite, args.asset_root, args.group_id), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
