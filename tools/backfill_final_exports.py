import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "01_app"))
from auth_store import AuthStore


PROJECT_BY_EXPORT_PREFIX = {
    "20260917_": "ed66d489-ec1e-4063-8a59-82b7d94245d7",
    "20260919_03": "da5bd72a-f858-4462-9f54-9b9fbd8b691a",
    "20260919_04": "da5bd72a-f858-4462-9f54-9b9fbd8b691a",
    "20260919_05": "dac673b2-12c8-4dfd-aa99-a15f1236be18",
    "20260919_11": "41a41da0-1ad2-4f87-908b-2b677f7fbfb1",
}
PLATFORMS = ("youtube", "instagram", "facebook", "naver")


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return "sha256:" + digest.hexdigest()


def probe(path):
    completed = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,codec_name:format=duration",
         "-of", "json", str(path)], capture_output=True, text=True, check=True,
    )
    payload = json.loads(completed.stdout)
    stream = payload["streams"][0]
    return {
        "duration": float(payload["format"]["duration"]),
        "width": int(stream["width"]), "height": int(stream["height"]),
        "video_codec": stream["codec_name"], "audio_codec": "aac",
    }


def project_for(filename):
    stamp = filename.rsplit("_", 2)[-2] + "_" + filename.rsplit("_", 1)[-1][:6]
    for prefix, project_id in PROJECT_BY_EXPORT_PREFIX.items():
        if stamp.startswith(prefix):
            return project_id
    return None


def main():
    database = Path(os.environ.get("SQLITE_PATH", ROOT / "01_app" / "data" / "tc.sqlite"))
    exports = Path(os.environ.get("EXPORTS_DIR", ROOT / "04_exports"))
    store = AuthStore(database)
    registered = []
    skipped = []
    kst = timezone(timedelta(hours=9))
    with store._connect() as connection:
        owners = {row["project_id"]: row["owner_user_id"] for row in connection.execute(
            "SELECT project_id, owner_user_id FROM projects"
        )}
    for path in sorted(exports.glob("*.mp4")):
        project_id = project_for(path.name)
        if not project_id or path.stat().st_size == 0:
            skipped.append({"filename": path.name, "reason": "empty" if path.stat().st_size == 0 else "unmapped"})
            continue
        user_id = owners.get(project_id)
        latest = store.latest_stage_data(user_id, project_id, 3) if user_id else None
        if not latest:
            skipped.append({"filename": path.name, "reason": "missing_revision"})
            continue
        platform = next((item for item in PLATFORMS if f"_{item}_" in path.name), None)
        if not platform:
            skipped.append({"filename": path.name, "reason": "missing_platform"})
            continue
        completed_at = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
        uri = "/04_exports/" + path.name
        try:
            media = probe(path)
        except (subprocess.CalledProcessError, KeyError, ValueError) as error:
            skipped.append({"filename": path.name, "reason": "invalid_mp4"})
            continue
        metadata = {
            **media, "filename": path.name, "platforms": [platform],
            "recovered_from_timestamp": True,
        }
        result = store.register_final_export(
            user_id, project_id, latest["revision_id"], uri, sha256(path), metadata,
            completed_at.astimezone(kst).date().isoformat(), [platform], completed_at.isoformat(),
        )
        registered.append({"filename": path.name, "project_id": project_id, **result})
    print(json.dumps({"registered": registered, "skipped": skipped}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
