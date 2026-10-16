#!/usr/bin/env python3
"""Apply a bounded neutral-warm white balance to canonical location references."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
import struct
import tempfile
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

from tools.reference_white_balance import regrade


INDEX_KEY = "GREENHILL_REFERENCES/greenhill_reference_index.json"
MANIFEST_KEYS = ("greenhill-facilities-characters", "kakaotalk-greenhill-bundle")
PROFILE = "neutral-warm-daylight-5000-5500k-v1"


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def normalized(value: object) -> str:
    return unicodedata.normalize("NFC", str(value or ""))


def png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as source:
        header = source.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError(f"not a PNG: {path}")
    return struct.unpack(">II", header[16:24])


def apply(sqlite_path: Path, asset_dir: Path, backup_dir: Path, group_id: str,
          prepared_dir: Path | None = None) -> dict:
    connection = sqlite3.connect(sqlite_path, timeout=30)
    connection.row_factory = sqlite3.Row
    keys = (INDEX_KEY, *MANIFEST_KEYS)
    rows = connection.execute(
        f"SELECT resource_id, resource_key, payload_json FROM group_resources WHERE group_id=? "
        f"AND resource_key IN ({','.join('?' for _ in keys)})", (group_id, *keys),
    ).fetchall()
    resources = {row["resource_key"]: row for row in rows}
    if set(resources) != set(keys):
        raise RuntimeError(f"required group resources are missing: {sorted(set(keys) - set(resources))}")
    payloads = {key: json.loads(resources[key]["payload_json"]) for key in keys}
    index = payloads[INDEX_KEY].get("document", payloads[INDEX_KEY])
    locations = [item for item in index.get("assets", [])
                 if item.get("kind") == "location" and item.get("status") == "ready"]
    physical_by_name = {normalized(path.name): path for path in asset_dir.glob("*.png")}
    paths = [
        (item, physical_by_name.get(normalized(Path(normalized(item.get("uri"))).name), asset_dir / "__missing__"))
        for item in locations
    ]
    if not paths or any(not path.is_file() for _, path in paths):
        raise ValueError("expected every ready location reference file")
    manifest_maps = {
        key: {normalized(item.get("logical_path") or item.get("path")): item
              for item in payloads[key].get("files", [])}
        for key in MANIFEST_KEYS
    }
    if any(normalized(item["uri"]) not in manifest_maps[key] for item, _ in paths for key in MANIFEST_KEYS):
        raise ValueError("location references must exist in both manifests before regrading")
    if backup_dir.exists():
        raise FileExistsError(backup_dir)
    staging = prepared_dir or Path(tempfile.mkdtemp(prefix=".location-wb-", dir=asset_dir.parent))
    prepared_by_name = {normalized(path.name): path for path in staging.glob("*.png")} if prepared_dir else {}
    records = []
    replaced = []
    try:
        for item, source in paths:
            original_hash = digest(source)
            if item.get("sha256") and item["sha256"] != original_hash:
                raise ValueError(f"reference checksum mismatch: {item['id']}")
            target = prepared_by_name.get(normalized(source.name), staging / source.name)
            if prepared_dir and not target.is_file():
                raise FileNotFoundError(f"corrected reference file is missing: {source.name}")
            metrics = ({"width": png_size(target)[0], "height": png_size(target)[1]}
                       if prepared_dir else regrade(source, target))
            if (metrics["width"], metrics["height"]) != png_size(source):
                raise ValueError(f"corrected dimensions changed: {item['id']}")
            records.append({"id": item["id"], "uri": item["uri"], "original_sha256": original_hash,
                            "corrected_sha256": digest(target), **metrics})
        backup_dir.mkdir(parents=True)
        for _, source in paths:
            shutil.copy2(source, backup_dir / source.name)
        connection.execute("BEGIN IMMEDIATE")
        by_id = {record["id"]: record for record in records}
        for item, source in paths:
            record = by_id[item["id"]]
            prepared = prepared_by_name.get(normalized(source.name), staging / source.name)
            shutil.copy2(prepared, source.with_suffix(".png.part"))
            source.with_suffix(".png.part").replace(source)
            replaced.append(source)
            item.update(sha256=record["corrected_sha256"], pixel_mode="RGB",
                        width=record["width"], height=record["height"], color_profile=PROFILE)
            for key in MANIFEST_KEYS:
                entry = manifest_maps[key][normalized(item["uri"])]
                entry.update(size=source.stat().st_size, sha256=record["corrected_sha256"])
        if "document" in payloads[INDEX_KEY]:
            payloads[INDEX_KEY]["sha256"] = hashlib.sha256(
                json.dumps(index, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        stamp = datetime.now(timezone.utc).isoformat()
        for key in keys:
            connection.execute(
                "UPDATE group_resources SET payload_json=?, updated_at=? WHERE resource_id=?",
                (json.dumps(payloads[key], ensure_ascii=False, sort_keys=True), stamp,
                 resources[key]["resource_id"]),
            )
        connection.commit()
        (backup_dir / "regrade-manifest.json").write_text(
            json.dumps({"profile": PROFILE, "updated_at": stamp, "assets": records}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return {"profile": PROFILE, "locations": len(records), "backup": str(backup_dir), "assets": records}
    except Exception:
        connection.rollback()
        for source in replaced:
            backup = backup_dir / source.name
            if backup.is_file():
                shutil.copy2(backup, source)
        raise
    finally:
        connection.close()
        if not prepared_dir:
            shutil.rmtree(staging, ignore_errors=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sqlite", type=Path, required=True)
    parser.add_argument("--asset-dir", type=Path, required=True)
    parser.add_argument("--backup-dir", type=Path, required=True)
    parser.add_argument("--group-id", required=True)
    parser.add_argument("--prepared-dir", type=Path)
    args = parser.parse_args()
    print(json.dumps(apply(args.sqlite, args.asset_dir, args.backup_dir, args.group_id,
                           args.prepared_dir), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
