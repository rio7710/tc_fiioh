import importlib.util
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "01_app"
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

AUTH_SPEC = importlib.util.spec_from_file_location("brand_integration_auth_store", APP / "auth_store.py")
AUTH = importlib.util.module_from_spec(AUTH_SPEC)
assert AUTH_SPEC and AUTH_SPEC.loader
AUTH_SPEC.loader.exec_module(AUTH)

from migrations.brand_variant_v1 import (
    apply_brand_variant_migration,
    plan_brand_variant_migration,
    rollback_brand_variant_migration,
)


class BrandAssetIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = AUTH.AuthStore(Path(self.temp.name) / "brand.sqlite")
        self.owner = self.store.create_user("brand-owner", "password-123")["user_id"]
        self.other = self.store.create_user("brand-other", "password-123")["user_id"]
        self.project = self.store.create_project(self.owner, "브랜드 통합 테스트")["project_id"]
        self.asset = self.store.add_brand_asset_version(
            self.owner, "outro", "아웃트로 v1", "legacy-main.png", "image", "image/png"
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_additive_schema_and_legacy_response_are_preserved(self):
        with sqlite3.connect(self.store.path) as connection:
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertIn("brand_asset_variants", tables)
        row = self.store.list_brand_assets(self.owner)[0]
        self.assertEqual("legacy-main.png", row["uri"])
        self.assertEqual("image/png", row["mime_type"])
        self.assertEqual([], row["variants"])

    def test_variant_registration_and_resolution_are_owner_scoped(self):
        variant = self.store.add_brand_asset_variant(
            self.owner, self.asset["version_id"], "16x9", "renamed-content.bin",
            1600, 900, "image", "sha256-main", "image/png", "variant-main"
        )
        self.assertEqual("16x9", variant["format"])
        self.assertEqual("renamed-content.bin", self.store.resolve_brand_variant(
            self.owner, self.asset["version_id"], "16x9"
        )["uri"])
        self.assertIsNone(self.store.resolve_brand_variant(self.other, self.asset["version_id"], "16x9"))
        with self.assertRaises(ValueError):
            self.store.add_brand_asset_variant(
                self.other, self.asset["version_id"], "9x16", "foreign.bin",
                900, 1600, "image", "sha256-foreign"
            )

    def test_migration_dry_run_apply_and_rollback_use_explicit_companion_metadata(self):
        companion = self.store.add_brand_asset_version(
            self.owner, "outro", "아웃트로 v1", "companion-renamed.bin", "image", "image/png"
        )
        self.store.save_content_brand_selections(self.owner, self.project, [{
            "role": "outro", "enabled": True, "version_id": self.asset["version_id"],
            "settings": {"profiles": {"9x16": {
                "version_id": companion["version_id"], "width": 900, "height": 1600,
                "media_type": "image", "mime_type": "image/png", "checksum": "sha256-companion"
            }}}
        }])
        connection = self.store._connect()
        try:
            plan = plan_brand_variant_migration(connection, "brand-variant-test")
            self.assertEqual([], plan["unresolved"])
            operation = plan["operations"][0]["variant"]
            self.assertEqual(self.asset["version_id"], operation["version_id"])
            self.assertEqual("companion-renamed.bin", operation["uri"])
            json.dumps(plan, ensure_ascii=False)
            result = apply_brand_variant_migration(connection, plan)
            self.assertEqual("applied", result["status"])
            self.assertEqual("9x16", self.store.resolve_brand_variant(
                self.owner, self.asset["version_id"], "9x16"
            )["format"])
            rollback = rollback_brand_variant_migration(connection, "brand-variant-test")
            self.assertEqual(1, rollback["removed"])
            self.assertIsNone(self.store.resolve_brand_variant(self.owner, self.asset["version_id"], "9x16"))
        finally:
            connection.close()

    def test_migration_does_not_guess_from_top_level_filename(self):
        self.store.save_content_brand_selections(self.owner, self.project, [{
            "role": "outro", "enabled": True, "version_id": self.asset["version_id"],
            "settings": {"profiles": {"9x16": {"uri": "name_16x9.png"}}}
        }])
        connection = self.store._connect()
        try:
            plan = plan_brand_variant_migration(connection, "brand-variant-unresolved")
            self.assertEqual([], plan["operations"])
            self.assertEqual("explicit width and height are required", plan["unresolved"][0]["reason"])
        finally:
            connection.close()


if __name__ == "__main__":
    unittest.main()
