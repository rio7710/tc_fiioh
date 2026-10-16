"""Canonical path and ownership checks for final-video downloads."""

from __future__ import annotations

import unicodedata
from contextlib import closing
from pathlib import Path
from urllib.parse import unquote, urlparse


EXPORT_PREFIX = "/04_exports/"


def requested_export_filename(raw_path: str) -> str:
    encoded_path = urlparse(raw_path).path
    if not encoded_path.startswith(EXPORT_PREFIX):
        raise ValueError("not a final-export path")
    decoded = unquote(encoded_path)
    remainder = decoded[len(EXPORT_PREFIX):]
    if (
        not remainder or remainder.startswith(".") or "/" in remainder
        or "\\" in remainder or "\x00" in remainder
        or Path(remainder).name != remainder or unquote(remainder) != remainder
    ):
        raise ValueError("invalid final-export path")
    return unicodedata.normalize("NFC", remainder)


def user_owns_final_export(connect, user_id: str, filename: str) -> bool:
    with closing(connect()) as db:
        rows = db.execute(
            """SELECT DISTINCT a.uri FROM artifacts a
                 JOIN projects p ON p.project_id=a.project_id
            LEFT JOIN group_members gm ON gm.group_id=p.group_id AND gm.user_id=?
                WHERE a.artifact_type='final_video' AND a.status='active'
                  AND (p.owner_user_id=? OR gm.user_id=?)""",
            (user_id, user_id, user_id),
        ).fetchall()
    for row in rows:
        try:
            stored = requested_export_filename(row["uri"])
        except (TypeError, ValueError):
            continue
        if stored == filename:
            return True
    return False
