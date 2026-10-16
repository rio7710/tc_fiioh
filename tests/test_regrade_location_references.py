import hashlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from tools.regrade_location_references import MANIFEST_KEYS, PROFILE, apply


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class RegradeLocationReferenceTests(unittest.TestCase):
    def fixture(self, root):
        asset_dir = root / "locations"
        asset_dir.mkdir()
        assets = []
        entries = []
        for index in range(21):
            filename = f"room-{index:02d}.png"
            path = asset_dir / filename
            Image.new("RGB", (8, 8), (210, 180, 120)).save(path)
            uri = f"시설/{filename}"
            assets.append({"id": f"room-{index:02d}", "kind": "location", "status": "ready",
                           "uri": uri, "sha256": sha256(path)})
            entries.append({"path": uri, "logical_path": uri, "uri": f"group://group/resources/{uri}",
                            "size": path.stat().st_size, "sha256": sha256(path), "media_type": "image/png"})
        database = root / "data.sqlite"
        connection = sqlite3.connect(database)
        connection.execute(
            "CREATE TABLE group_resources (resource_id TEXT, group_id TEXT, resource_key TEXT, "
            "payload_json TEXT, updated_at TEXT)"
        )
        payloads = {
            "GREENHILL_REFERENCES/greenhill_reference_index.json": {"document": {"assets": assets}},
            MANIFEST_KEYS[0]: {"files": entries},
            MANIFEST_KEYS[1]: {"files": entries, "file_count": len(entries)},
        }
        connection.executemany(
            "INSERT INTO group_resources VALUES (?, 'group', ?, ?, '')",
            [(str(index), key, json.dumps(value)) for index, (key, value) in enumerate(payloads.items())],
        )
        connection.commit()
        connection.close()
        return database, asset_dir

    def test_regrade_backs_up_pixels_and_updates_all_hashes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database, asset_dir = self.fixture(root)
            original = (asset_dir / "room-00.png").read_bytes()
            backup = root / "backup"
            result = apply(database, asset_dir, backup, "group")
            self.assertEqual(21, result["locations"])
            self.assertEqual(PROFILE, result["profile"])
            self.assertEqual(original, (backup / "room-00.png").read_bytes())
            self.assertNotEqual(original, (asset_dir / "room-00.png").read_bytes())
            self.assertTrue((backup / "regrade-manifest.json").is_file())
            corrected_hash = sha256(asset_dir / "room-00.png")
            connection = sqlite3.connect(database)
            rows = dict(connection.execute("SELECT resource_key,payload_json FROM group_resources"))
            index = json.loads(rows["GREENHILL_REFERENCES/greenhill_reference_index.json"])["document"]
            self.assertEqual(corrected_hash, index["assets"][0]["sha256"])
            self.assertEqual(PROFILE, index["assets"][0]["color_profile"])
            for key in MANIFEST_KEYS:
                self.assertEqual(corrected_hash, json.loads(rows[key])["files"][0]["sha256"])

    def test_missing_ready_location_stops_before_backup_or_db_write(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database, asset_dir = self.fixture(root)
            (asset_dir / "room-20.png").unlink()
            backup = root / "backup"
            with self.assertRaisesRegex(ValueError, "expected every ready"):
                apply(database, asset_dir, backup, "group")
            self.assertFalse(backup.exists())

    def test_prepared_images_apply_without_regeneration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database, asset_dir = self.fixture(root)
            prepared = root / "prepared"
            prepared.mkdir()
            for source in asset_dir.glob("*.png"):
                image = Image.open(source).convert("RGB")
                image.point(lambda value: min(255, value + 3)).save(prepared / source.name)
            result = apply(database, asset_dir, root / "backup", "group", prepared)
            self.assertEqual(21, result["locations"])
            self.assertEqual((213, 183, 123), Image.open(asset_dir / "room-00.png").getpixel((0, 0)))


if __name__ == "__main__":
    unittest.main()
