import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from tools.sync_reference_manifests import sync


class SyncReferenceManifestTests(unittest.TestCase):
    def test_ready_assets_are_upserted_into_both_manifests(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "data.sqlite"
            assets = root / "assets"
            (assets / "characters").mkdir(parents=True)
            (assets / "locations").mkdir()
            (assets / "characters" / "person.png").write_bytes(b"person")
            (assets / "locations" / "room.png").write_bytes(b"room")
            connection = sqlite3.connect(database)
            connection.execute(
                "CREATE TABLE group_resources (resource_id TEXT, group_id TEXT, "
                "resource_key TEXT, payload_json TEXT, updated_at TEXT)"
            )
            index = {"document": {"assets": [
                {"id": "person", "kind": "character", "status": "ready", "uri": "캐릭터/person.png"},
                {"id": "room", "kind": "location", "status": "ready", "uri": "시설/room.png"},
                {"id": "pending", "kind": "location", "status": "pending", "uri": None},
            ]}}
            rows = [
                ("index", "group", "GREENHILL_REFERENCES/greenhill_reference_index.json", index),
                ("default", "group", "greenhill-facilities-characters", {"files": []}),
                ("bundle", "group", "kakaotalk-greenhill-bundle", {"files": [], "file_count": 0}),
            ]
            connection.executemany(
                "INSERT INTO group_resources VALUES (?, ?, ?, ?, '')",
                [(a, b, c, json.dumps(d)) for a, b, c, d in rows],
            )
            connection.commit()
            connection.close()

            result = sync(database, assets, "group")
            self.assertEqual(2, result["ready_assets"])
            connection = sqlite3.connect(database)
            saved = dict(connection.execute("SELECT resource_key, payload_json FROM group_resources"))
            for key in ("greenhill-facilities-characters", "kakaotalk-greenhill-bundle"):
                manifest = json.loads(saved[key])
                self.assertEqual(
                    {"캐릭터/person.png", "시설/room.png"},
                    {item["logical_path"] for item in manifest["files"]},
                )
            self.assertEqual(2, json.loads(saved["kakaotalk-greenhill-bundle"])["file_count"])

    def test_missing_ready_file_aborts_without_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "data.sqlite"
            connection = sqlite3.connect(database)
            connection.execute(
                "CREATE TABLE group_resources (resource_id TEXT, group_id TEXT, "
                "resource_key TEXT, payload_json TEXT, updated_at TEXT)"
            )
            values = [
                ("index", "GREENHILL_REFERENCES/greenhill_reference_index.json", {"document": {"assets": [
                    {"id": "missing", "kind": "location", "status": "ready", "uri": "시설/missing.png"}
                ]}}),
                ("default", "greenhill-facilities-characters", {"files": []}),
                ("bundle", "kakaotalk-greenhill-bundle", {"files": [], "file_count": 0}),
            ]
            connection.executemany(
                "INSERT INTO group_resources VALUES (?, 'group', ?, ?, '')",
                [(a, b, json.dumps(c)) for a, b, c in values],
            )
            connection.commit()
            connection.close()
            with self.assertRaises(FileNotFoundError):
                sync(database, root / "assets", "group")
            connection = sqlite3.connect(database)
            payload = connection.execute(
                "SELECT payload_json FROM group_resources WHERE resource_id='default'"
            ).fetchone()[0]
            self.assertEqual([], json.loads(payload)["files"])


if __name__ == "__main__":
    unittest.main()
