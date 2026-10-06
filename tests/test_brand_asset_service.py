import importlib.util
import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "01_app"
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

SPEC = importlib.util.spec_from_file_location("brand_asset_service", APP / "services" / "brand_asset_service.py")
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)
from repositories.brand_asset_repository import InMemoryBrandAssetRepository


class BrandAssetServiceTests(unittest.TestCase):
    def setUp(self):
        self.repository = InMemoryBrandAssetRepository()
        self.service = MODULE.BrandAssetService(self.repository, id_factory=lambda prefix: f"{prefix}-id")
        self.asset = self.service.create_asset("outro", "아웃트로 v4", "asset-1")
        self.version = self.service.create_version("asset-1", 4, "version-4")

    def test_logical_version_exposes_four_explicit_variants(self):
        for format, dimensions in MODULE.BRAND_VARIANT_FORMATS.items():
            self.service.add_variant(
                "version-4", format, f"https://cdn.example/{format}.png",
                dimensions["width"] * 100, dimensions["height"] * 100,
                "image", f"sha256-{format}",
            )
        result = self.service.get_asset("asset-1")
        self.assertEqual("아웃트로 v4", result["name"])
        self.assertEqual(1, len(result["versions"]))
        self.assertEqual(set(MODULE.BRAND_VARIANT_FORMATS), {v["format"] for v in result["versions"][0]["variants"]})
        self.assertEqual("https://cdn.example/9x16.png", self.service.resolve_variant("version-4", "9x16")["uri"])
        json.dumps(result, ensure_ascii=False)

    def test_filename_does_not_supply_ratio_or_version(self):
        variant = self.service.add_variant(
            "version-4", "16x9", "outro_final_9x16_v99.png", 1600, 900, "image", "sha"
        )
        self.assertEqual("16x9", variant["format"])

    def test_rejects_duplicate_and_invalid_ratio(self):
        self.service.add_variant("version-4", "1x1", "uri-a", 100, 100, "image", "sha-a")
        with self.assertRaises(ValueError):
            self.service.add_variant("version-4", "1x1", "uri-b", 100, 100, "image", "sha-b")
        with self.assertRaises(ValueError):
            self.service.add_variant("version-4", "4x5", "uri-c", 100, 100, "image", "sha-c")

    def test_migration_plan_uses_only_explicit_profiles_and_has_no_side_effect(self):
        legacy = [{
            "asset_id": "asset-1", "version_id": "version-4", "version": 4,
            "role": "outro", "name": "아웃트로 v4", "uri": "renamed-anything.bin",
            "media_type": "image", "settings": {"profiles": {
                "9x16": {"uri": "stored/portrait.dat", "width": 900, "height": 1600,
                         "media_type": "image", "checksum": "sha"},
            }},
        }]
        plan = MODULE.build_brand_asset_migration_plan(legacy)
        self.assertEqual("brand-asset-migration-plan.v1", plan["schema_version"])
        self.assertEqual(["upsert_asset", "upsert_version", "upsert_variant"], [op["op"] for op in plan["operations"]])
        self.assertEqual("9x16", plan["operations"][-1]["variant"]["format"])
        self.assertEqual(1, len(self.repository.list_assets()))
        json.dumps(plan, ensure_ascii=False)


if __name__ == "__main__":
    unittest.main()
