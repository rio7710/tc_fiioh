"""Atomic database finalize for verified final-export outputs."""

from __future__ import annotations

import json
import uuid
from contextlib import closing
from typing import Any, Callable


def _metadata(row) -> dict[str, Any]:
    value = json.loads(row["metadata_json"] or "{}")
    return value if isinstance(value, dict) else {}


def _version(artifact_id: str, uri: str, metadata: dict, created_at: str) -> dict:
    return {
        "artifact_id": artifact_id,
        "url": uri,
        "filename": metadata["filename"],
        "createdAt": created_at,
    }


def _validate_items(outputs: list[dict], artifacts: list[dict]) -> None:
    if not outputs or len(outputs) != len(artifacts):
        raise ValueError("최종 영상 출력과 산출물 개수가 일치하지 않습니다.")
    ratios = [str(item.get("aspect_ratio") or "") for item in outputs]
    if not all(ratios) or len(set(ratios)) != len(ratios):
        raise ValueError("최종 영상 화면비가 누락되었거나 중복됩니다.")
    for output, artifact in zip(outputs, artifacts):
        if not output.get("local_date") or not output.get("created_at"):
            raise ValueError("최종 영상의 등록 시간이 없습니다.")
        if not artifact.get("uri") or not artifact.get("checksum"):
            raise ValueError("최종 영상 산출물 정보가 완전하지 않습니다.")


def finalize_final_exports(
    connection_factory: Callable, *, user_id: str, project_id: str,
    revision_id: str, job_id: str, outputs: list[dict], artifacts: list[dict],
    brand_selections: list[dict],
) -> list[dict]:
    _validate_items(outputs, artifacts)
    with closing(connection_factory()) as connection:
        connection.execute("BEGIN IMMEDIATE")
        owner = connection.execute(
            "SELECT 1 FROM projects WHERE project_id=? AND owner_user_id=?",
            (project_id, user_id),
        ).fetchone()
        if not owner:
            raise ValueError("이 프로젝트에 접근할 수 없습니다.")
        rows = connection.execute(
            """SELECT artifact_id,uri,checksum,metadata_json FROM artifacts
                 WHERE project_id=? AND revision_id=? AND scene_id IS NULL
                   AND artifact_type='final_video' AND status='active'""",
            (project_id, revision_id),
        ).fetchall()
        existing = {
            (str(_metadata(row).get("job_id")), str(_metadata(row).get("aspect_ratio"))): row
            for row in rows
        }
        registrations = []
        for output, artifact in zip(outputs, artifacts):
            metadata = {
                **artifact.get("metadata", {}), "filename": artifact["name"],
                "job_id": job_id, "aspect_ratio": output["aspect_ratio"],
            }
            row = existing.get((job_id, output["aspect_ratio"]))
            if row and row["checksum"] != artifact["checksum"]:
                raise ValueError("같은 작업의 기존 영상과 checksum이 다릅니다.")
            artifact_id = row["artifact_id"] if row else str(uuid.uuid4())
            uri = row["uri"] if row else artifact["uri"]
            if not row:
                connection.execute(
                    """INSERT INTO artifacts
                       (artifact_id,project_id,revision_id,scene_id,artifact_type,uri,
                        checksum,metadata_json,status,created_at)
                       VALUES (?,?,?,NULL,'final_video',?,?,?,'active',?)""",
                    (artifact_id, project_id, revision_id, uri, artifact["checksum"],
                     json.dumps(metadata, ensure_ascii=False, sort_keys=True), output["created_at"]),
                )
            version = _version(artifact_id, uri, metadata, output["created_at"])
            for platform in output["platforms"]:
                publication = connection.execute(
                    "SELECT * FROM publications WHERE project_id=? AND local_date=? AND platform=?",
                    (project_id, output["local_date"], platform),
                ).fetchone()
                settings = json.loads(publication["settings_json"] or "{}") if publication else {}
                versions = settings.get("contentVersions") if isinstance(settings.get("contentVersions"), list) else []
                already = any(item.get("artifact_id") == artifact_id for item in versions if isinstance(item, dict))
                if publication and publication["status"] != "draft" and not already:
                    raise ValueError("확정된 캘린더 일정은 최종 영상 제작으로 덮어쓸 수 없습니다.")
                if already:
                    continue
                versions.append(version)
                settings.update({
                    "contentUrl": uri, "filename": metadata["filename"],
                    "contentVersions": versions, "artifact_id": artifact_id,
                })
                encoded = json.dumps(settings, ensure_ascii=False, sort_keys=True)
                if publication:
                    connection.execute(
                        "UPDATE publications SET settings_json=?,updated_at=? WHERE publication_id=?",
                        (encoded, output["created_at"], publication["publication_id"]),
                    )
                else:
                    connection.execute(
                        """INSERT INTO publications
                           (publication_id,project_id,local_date,platform,status,settings_json,created_at,updated_at)
                           VALUES (?,?,?,?,'draft',?,?,?)""",
                        (str(uuid.uuid4()), project_id, output["local_date"], platform,
                         encoded, output["created_at"], output["created_at"]),
                    )
            for item in brand_selections:
                if item.get("enabled") and item.get("version_id"):
                    connection.execute(
                        """INSERT OR REPLACE INTO final_export_brand_assets
                           (artifact_id,role,version_id,settings_json) VALUES (?,?,?,?)""",
                        (artifact_id, item["role"], item["version_id"],
                         json.dumps(item.get("settings") or {}, ensure_ascii=False, sort_keys=True)),
                    )
            registrations.append({"artifact_id": artifact_id, "uri": uri, "reused": bool(row)})
        connection.commit()
        return registrations
