#!/usr/bin/env python3
"""Register the approved Greenhill V2 character sheets in the resource library."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
import struct
from datetime import datetime, timezone
from pathlib import Path


CONTINUITY_RULES = [
    "모든 씬에서 동일 얼굴·머리·체형을 유지한다.",
    "V2 레퍼런스가 있으면 V2를 우선 사용하고, V2가 없는 캐릭터만 V1을 사용한다.",
    "한 콘텐츠 안에서는 캐릭터별 레퍼런스 버전과 의상 variant를 하나만 선택하고 중간에 바꾸지 않는다.",
    "다른 character_id의 얼굴이나 신체를 혼합하지 않는다.",
]

SHEETS = [
    ("KakaoTalk_20261013_101727065.png", "ST_CM02_uniform-v2_scrub_8panel.png", "character-caregiver-m02", "현우", "남성 돌봄 직원", "scrub", "젊은 중년 남성, 짧은 검은 웨이브, 회색 반소매 스크럽·회색 바지·검은 운동화"),
    ("KakaoTalk_20261013_101727065_01.png", "ST_CM02_uniform-v2_cardigan_8panel.png", "character-caregiver-m02", "현우", "남성 돌봄 직원", "cardigan", "젊은 중년 남성, 짧은 검은 웨이브, 네이비 가디건·회색 스크럽 상의·회색 바지·검은 운동화"),
    ("KakaoTalk_20261013_101727065_02.png", "ST_CM03_uniform-v2_scrub_8panel.png", "character-caregiver-m03", "성호", "남성 돌봄 직원", "scrub", "장년 남성, 자연스럽게 넘긴 짙은 회색 머리, 회색 반소매 스크럽·회색 바지·검은 운동화"),
    ("KakaoTalk_20261013_101727065_03.png", "ST_CM03_uniform-v2_cardigan_8panel.png", "character-caregiver-m03", "성호", "남성 돌봄 직원", "cardigan", "장년 남성, 자연스럽게 넘긴 짙은 회색 머리, 네이비 가디건·회색 스크럽 상의·회색 바지·검은 운동화"),
    ("KakaoTalk_20261013_101727065_04.png", "ST_NM02_uniform-v2_scrub_8panel.png", "character-nurse-m02", "태훈", "남성 간호 인력", "scrub", "중년 남성, 짧은 검은 머리와 사각 안경, 네이비 반소매 스크럽·네이비 바지·검은 운동화"),
    ("KakaoTalk_20261013_101727065_05.png", "ST_NM02_uniform-v2_cardigan_8panel.png", "character-nurse-m02", "태훈", "남성 간호 인력", "cardigan", "중년 남성, 짧은 검은 머리와 사각 안경, 회색 가디건·네이비 스크럽·네이비 바지·검은 운동화"),
    ("KakaoTalk_20261013_101727065_06.png", "ST_CM01_uniform-v2_scrub_8panel.png", "character-caregiver-m01", "민준", "남성 돌봄 직원", "scrub", "중년 남성, 짧은 검은 머리, 회색 반소매 스크럽·회색 바지·검은 운동화"),
    ("KakaoTalk_20261013_101727065_07.png", "ST_CM01_uniform-v2_cardigan_8panel.png", "character-caregiver-m01", "민준", "남성 돌봄 직원", "cardigan", "중년 남성, 짧은 검은 머리, 네이비 가디건·회색 스크럽 상의·회색 바지·검은 운동화"),
    ("KakaoTalk_20261013_101727065_08.png", "ST_NM01_uniform-v2_scrub_8panel.png", "character-nurse-m01", "준호", "남성 간호 인력", "scrub", "젊은 중년 남성, 가르마 탄 검은 웨이브, 회색 반소매 스크럽·회색 바지·검은 운동화"),
    ("KakaoTalk_20261013_101727065_09.png", "ST_NM01_uniform-v2_cardigan_8panel.png", "character-nurse-m01", "준호", "남성 간호 인력", "cardigan", "젊은 중년 남성, 가르마 탄 검은 웨이브, 네이비 가디건·회색 스크럽 상의·회색 바지·검은 운동화"),
    ("KakaoTalk_20261013_101727065_12.png", "ST_NF01_uniform-v2_cardigan_8panel.png", "character-nurse-f01", "지은", "여성 간호 인력", "cardigan", "중년 여성, 낮게 묶은 짙은 갈색 머리, 네이비 가디건·회색 스크럽 상의·회색 바지·검은 운동화"),
    ("KakaoTalk_20261013_101727065_13.png", "ST_CF01_uniform-v2_cardigan_8panel.png", "character-caregiver-f01", "은지", "여성 돌봄 직원", "cardigan", "중년 여성, 턱선 길이 짙은 갈색 단발, 네이비 가디건·회색 스크럽 상의·회색 바지·검은 운동화"),
]


def reference_id(filename: str) -> str:
    return "ref-character-asset-" + filename.removesuffix("_8panel.png").lower().replace("_", "-")


def png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as source:
        header = source.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError(f"not a PNG: {path}")
    return struct.unpack(">II", header[16:24])


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def migrate(sqlite_path: Path, source_dir: Path, asset_dir: Path) -> dict:
    prepared = []
    for source_name, filename, character_id, display_name, role, wardrobe, appearance in SHEETS:
        source = source_dir / source_name
        if not source.is_file():
            raise FileNotFoundError(source)
        width, height = png_size(source)
        prepared.append({
            "id": reference_id(filename), "kind": "character", "status": "ready",
            "uri": f"캐릭터/{filename}", "source_filename": filename,
            "character_id": character_id, "identity_group": character_id,
            "display_name": display_name, "assignment": role,
            "reference_version": "v2", "wardrobe_variant": wardrobe,
            "appearance_lock": appearance,
            "usage": f"{display_name}({role}) V2 {wardrobe} 고정 캐릭터의 얼굴, 머리, 체형, 의상 기준",
            "sha256": sha256(source), "pixel_mode": "RGB", "width": width, "height": height,
            "_source": source,
        })

    duplicate_hashes = {}
    for asset in prepared:
        if asset["sha256"] in duplicate_hashes:
            raise ValueError(f"duplicate V2 sheets: {duplicate_hashes[asset['sha256']]} and {asset['source_filename']}")
        duplicate_hashes[asset["sha256"]] = asset["source_filename"]

    connection = sqlite3.connect(sqlite_path, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout=30000")
    rows = connection.execute(
        "SELECT resource_id, resource_key, payload_json FROM group_resources "
        "WHERE resource_key IN (?, ?)",
        ("GREENHILL_REFERENCES/greenhill_character_configuration.json",
         "GREENHILL_REFERENCES/greenhill_reference_index.json"),
    ).fetchall()
    resources = {row["resource_key"]: row for row in rows}
    if len(resources) != 2:
        raise RuntimeError("Greenhill character configuration and reference index are required")

    config_key = "GREENHILL_REFERENCES/greenhill_character_configuration.json"
    index_key = "GREENHILL_REFERENCES/greenhill_reference_index.json"
    config_payload = json.loads(resources[config_key]["payload_json"])
    index_payload = json.loads(resources[index_key]["payload_json"])
    config = config_payload["document"]
    index = index_payload["document"]

    new_assets = [{key: value for key, value in item.items() if key != "_source"} for item in prepared]
    by_id = {str(item.get("id")): item for item in index.get("assets", [])}
    for asset in new_assets:
        by_id[asset["id"]] = asset
    index["assets"] = list(by_id.values())

    registry = {str(item.get("character_id")): item for item in config.get("characters", [])}
    for asset in new_assets:
        character_id = asset["character_id"]
        item = registry.setdefault(character_id, {
            "character_id": character_id,
            "display_name": asset["display_name"],
            "role": asset["assignment"],
            "appearance_lock": asset["appearance_lock"],
            "reference_ids": [],
        })
        item["appearance_lock"] = (
            f"{asset['display_name']}의 얼굴·머리·체형을 유지하고, "
            "한 콘텐츠에서 선택한 reference_id의 V2 의상 variant를 모든 씬에 고정한다."
        )
        item["preferred_reference_version"] = "v2"
        item["continuity_rules"] = CONTINUITY_RULES
        if asset["id"] not in item["reference_ids"]:
            item["reference_ids"].append(asset["id"])
    config["characters"] = list(registry.values())
    config["casting_rule"] = (
        "캐릭터별로 V2가 있으면 우선 선택하고 없으면 V1을 사용한다. "
        "한 콘텐츠에서 선택한 reference version과 의상 variant는 모든 씬에 고정한다."
    )
    index["character_registry"] = config["characters"]
    index.setdefault("rules", {})["character_reference_selection"] = config["casting_rule"]
    ready = [item for item in index["assets"] if item.get("kind") == "character" and item.get("status") == "ready"]
    index.setdefault("summary", {})["ready_characters"] = len(ready)
    index["summary"]["named_character_assets"] = len(ready)
    index["summary"]["unique_characters"] = len({item.get("character_id") for item in ready if item.get("character_id")})

    asset_dir.mkdir(parents=True, exist_ok=True)
    staged = []
    try:
        for item in prepared:
            target = asset_dir / item["source_filename"]
            temporary = target.with_suffix(target.suffix + ".part")
            shutil.copy2(item["_source"], temporary)
            if sha256(temporary) != item["sha256"]:
                raise OSError(f"copy verification failed: {target}")
            temporary.replace(target)
            staged.append(target)

        stamp = datetime.now(timezone.utc).isoformat()
        connection.execute("BEGIN IMMEDIATE")
        for key, payload in ((config_key, config_payload), (index_key, index_payload)):
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
        for path in staged:
            path.unlink(missing_ok=True)
        raise
    finally:
        connection.close()

    return {
        "registered_assets": len(new_assets),
        "v2_characters": len({item["character_id"] for item in new_assets}),
        "asset_ids": [item["id"] for item in new_assets],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sqlite", type=Path, required=True)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--asset-dir", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(migrate(args.sqlite, args.source_dir, args.asset_dir), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
