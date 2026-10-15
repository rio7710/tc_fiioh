import json
import sqlite3
import struct
import tempfile
import unittest
from pathlib import Path

from tools.register_location_reference import register_location


class RegisterLocationReferenceTests(unittest.TestCase):
    def test_registers_location_in_index_and_manifests_idempotently(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "tc.sqlite"
            source = root / "corridor.png"
            source.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\0\0\0\rIHDR" + struct.pack(">II", 1672, 941))
            connection = sqlite3.connect(database)
            connection.execute(
                "CREATE TABLE group_resources (resource_id TEXT, group_id TEXT, resource_type TEXT, "
                "resource_key TEXT, payload_json TEXT, updated_at TEXT)"
            )
            resources = (
                ("index", "reference_library", "GREENHILL_REFERENCES/greenhill_reference_index.json",
                 {"document": {"assets": [], "summary": {}, "rules": {}}}),
                ("default", "default_asset_manifest", "greenhill-facilities-characters", {"files": []}),
                ("manifest", "resource_manifest", "kakaotalk-greenhill-bundle", {"files": [], "file_count": 0}),
            )
            for resource_id, resource_type, resource_key, payload in resources:
                connection.execute(
                    "INSERT INTO group_resources VALUES (?, 'group-1', ?, ?, ?, '')",
                    (resource_id, resource_type, resource_key, json.dumps(payload)),
                )
            connection.commit()
            connection.close()

            kwargs = dict(
                sqlite_path=database,
                source=source,
                asset_dir=root / "locations",
                group_id="group-1",
                filename="corridor.png",
                asset_id="ref-location-corridor",
                usage="연결 복도",
                aliases=["복도"],
            )
            register_location(**kwargs)
            register_location(**kwargs)

            connection = sqlite3.connect(database)
            rows = dict(connection.execute("SELECT resource_key, payload_json FROM group_resources"))
            connection.close()
            index = json.loads(rows["GREENHILL_REFERENCES/greenhill_reference_index.json"])
            self.assertEqual("ref-location-corridor", index["document"]["assets"][0]["id"])
            self.assertEqual("transition_bridge", index["document"]["assets"][0]["usage_role"])
            self.assertEqual(1, index["document"]["summary"]["ready_locations"])
            default = json.loads(rows["greenhill-facilities-characters"])
            manifest = json.loads(rows["kakaotalk-greenhill-bundle"])
            self.assertEqual(1, len(default["files"]))
            self.assertEqual(1, manifest["file_count"])
            self.assertTrue((root / "locations" / "corridor.png").is_file())


if __name__ == "__main__":
    unittest.main()
