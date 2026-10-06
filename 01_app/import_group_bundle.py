from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import sqlite3
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path


TEXT_SUFFIXES = {".md", ".json", ".txt"}
HUMAN_STORYBOARD_FILES = {
    "CARE_STORYBOARD.md",
    "JOY_STORYBOARD.md",
    "REHAB_STORYBOARD.md",
}
CANONICAL_STORYBOARD_FILE = "AUTUMN_INDEPENDENCE_LOCAL_VITALITY_WARMTH_STORYBOARD.md"


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def upsert_resource(connection, group_id: str, resource_type: str, resource_key: str,
                    schema_version: str, payload: dict, source_uri: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    row = connection.execute(
        """SELECT resource_id, created_at FROM group_resources
           WHERE group_id = ? AND resource_type = ? AND resource_key = ?""",
        (group_id, resource_type, resource_key),
    ).fetchone()
    resource_id = row[0] if row else str(uuid.uuid4())
    created_at = row[1] if row else now
    connection.execute(
        """INSERT OR REPLACE INTO group_resources
           (resource_id, group_id, resource_type, resource_key, schema_version,
            payload_json, source_uri, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (resource_id, group_id, resource_type, resource_key, schema_version,
         json.dumps(payload, ensure_ascii=False, sort_keys=True), source_uri, created_at, now),
    )


def import_bundle(database: Path, bundle: Path, group_id: str, user_id: str) -> dict:
    if not bundle.is_dir():
        raise ValueError("그룹 리소스 폴더를 찾을 수 없습니다.")
    connection = sqlite3.connect(database)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        member = connection.execute(
            "SELECT role FROM group_members WHERE group_id = ? AND user_id = ?",
            (group_id, user_id),
        ).fetchone()
        if not member:
            raise ValueError("사용자가 대상 그룹의 구성원이 아닙니다.")

        bundle_uri = f"group://{group_id}/resources/"
        connection.execute(
            """DELETE FROM group_resources
               WHERE group_id = ? AND source_uri LIKE ?
                 AND resource_type IN (
                    'storyboard_template', 'content_template', 'canonical_storyboard_spec',
                    'human_storyboard_reference', 'prompt_guidance_source',
                    'test_content_sample', 'reference_library', 'resource_manifest',
                    'default_asset_manifest', 'sample_manifest'
                 )""",
            (group_id, f"{bundle_uri}%"),
        )

        files = []
        default_assets = []
        authored_samples = []
        text_resources = 0
        for path in sorted(bundle.rglob("*")):
            if not path.is_file() or path.suffix.lower() == ".zip":
                continue
            relative = path.relative_to(bundle).as_posix()
            logical_path = unicodedata.normalize("NFC", relative)
            uri = f"group://{group_id}/resources/{relative}"
            entry = {
                "path": relative,
                "logical_path": logical_path,
                "uri": uri,
                "size": path.stat().st_size,
                "sha256": file_hash(path),
                "media_type": mimetypes.guess_type(path.name)[0] or "application/octet-stream",
            }
            files.append(entry)
            is_default = (
                logical_path.startswith("시설/")
                or logical_path.startswith("캐릭터/")
                or logical_path.startswith("GREENHILL_REFERENCES/characters/")
                or logical_path.startswith("GREENHILL_REFERENCES/locations/")
                or logical_path.endswith("greenhill_reference_index.json")
                or logical_path.endswith("greenhill_character_configuration.json")
            )
            (default_assets if is_default else authored_samples).append(entry)

            if path.suffix.lower() not in TEXT_SUFFIXES:
                continue
            if path.suffix.lower() == ".json":
                try:
                    content = json.loads(path.read_text(encoding="utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    continue
                resource_type = "reference_library" if "REFERENCE" in path.name.upper() or "configuration" in path.name.lower() else "test_content_sample"
                version = str(content.get("schema_version", "1.0.0")) if isinstance(content, dict) else "1.0.0"
                payload = {"format": "json", "document": content, "sha256": entry["sha256"]}
            else:
                text = path.read_text(encoding="utf-8")
                text = text.replace(
                    "C:\\Users\\USER\\Documents\\카카오톡 받은 파일\\",
                    f"group://{group_id}/resources/",
                )
                if logical_path == CANONICAL_STORYBOARD_FILE:
                    resource_type = "canonical_storyboard_spec"
                elif logical_path in HUMAN_STORYBOARD_FILES:
                    resource_type = "prompt_guidance_source"
                else:
                    resource_type = "test_content_sample"
                version = "1.0.0"
                payload = {"format": "markdown", "content": text, "sha256": entry["sha256"]}
            upsert_resource(connection, group_id, resource_type, relative, version, payload, uri)
            text_resources += 1

        manifest = {
            "schema_version": "1.0.0",
            "group_id": group_id,
            "isolation": "group",
            "zip_files_excluded": True,
            "file_count": len(files),
            "files": files,
        }
        upsert_resource(
            connection, group_id, "resource_manifest", "kakaotalk-greenhill-bundle",
            "1.0.0", manifest, bundle_uri,
        )
        upsert_resource(
            connection, group_id, "default_asset_manifest", "greenhill-facilities-characters",
            "1.0.0",
            {"schema_version": "1.0.0", "inherit_by_default": True, "files": default_assets},
            bundle_uri,
        )
        upsert_resource(
            connection, group_id, "sample_manifest", "authored-storyboards-and-results",
            "1.0.0",
            {"schema_version": "1.0.0", "inherit_by_default": False, "files": authored_samples},
            bundle_uri,
        )
        connection.commit()
        return {
            "group_id": group_id,
            "files": len(files),
            "default_assets": len(default_assets),
            "authored_samples": len(authored_samples),
            "text_resources": text_resources,
        }
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--group-id", required=True)
    parser.add_argument("--user-id", required=True)
    args = parser.parse_args()
    print(json.dumps(import_bundle(args.database, args.bundle, args.group_id, args.user_id), ensure_ascii=False))


if __name__ == "__main__":
    main()
