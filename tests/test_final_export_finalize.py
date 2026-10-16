import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "01_app"))

from auth_store import AuthStore


class FinalExportFinalizeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = AuthStore(Path(self.temp.name) / "tc.sqlite")
        self.user = self.store.create_user("finalize-owner", "password-123")
        self.project = self.store.create_project(self.user["user_id"], "finalize")
        revision = self.store.save_stage_draft(
            self.user["user_id"], self.project["project_id"], 3, {"document": {}},
        )
        self.revision = self.store.confirm_stage_revision(
            self.user["user_id"], self.project["project_id"], revision["revision_id"],
        )

    def tearDown(self):
        self.temp.cleanup()

    @staticmethod
    def output(ratio="16:9", platforms=None):
        return {
            "aspect_ratio": ratio, "platforms": platforms or ["youtube"],
            "created_at": "2026-10-16T03:00:00+00:00", "local_date": "2026-10-16",
        }

    @staticmethod
    def artifact(name="final.mp4", checksum="sha256:one"):
        return {
            "name": name, "uri": f"/04_exports/{name}", "checksum": checksum,
            "metadata": {"duration": 10.0, "width": 1280, "height": 720},
        }

    def finalize(self, outputs=None, artifacts=None, brands=None):
        return self.store.finalize_final_exports(
            self.user["user_id"], self.project["project_id"],
            self.revision["revision_id"], "render-job-1",
            outputs or [self.output()], artifacts or [self.artifact()], brands or [],
        )

    def counts(self):
        with self.store._connect() as connection:
            artifacts = connection.execute(
                "SELECT COUNT(*) AS count FROM artifacts WHERE artifact_type='final_video'"
            ).fetchone()["count"]
            publications = connection.execute(
                "SELECT COUNT(*) AS count FROM publications"
            ).fetchone()["count"]
            brands = connection.execute(
                "SELECT COUNT(*) AS count FROM final_export_brand_assets"
            ).fetchone()["count"]
        return artifacts, publications, brands

    def test_outputs_brands_and_calendar_commit_together_and_are_idempotent(self):
        with self.store._connect() as connection:
            connection.execute(
                "INSERT INTO brand_assets VALUES (?,?,?,?,?)",
                ("brand-1", self.user["user_id"], "watermark", "logo", "2026-10-16T00:00:00Z"),
            )
            connection.execute(
                "INSERT INTO brand_asset_versions VALUES (?,?,?,?,?,?,?,?)",
                ("version-1", "brand-1", 1, "/logo.png", "image", "image/png", 1,
                 "2026-10-16T00:00:00Z"),
            )
            connection.commit()
        brands = [{
            "enabled": True, "role": "watermark", "version_id": "version-1",
            "settings": {"opacity": 0.5},
        }]
        first = self.finalize(brands=brands)
        second = self.finalize(brands=brands)
        self.assertEqual(first[0]["artifact_id"], second[0]["artifact_id"])
        self.assertEqual((1, 1, 1), self.counts())
        with self.store._connect() as connection:
            settings = json.loads(connection.execute(
                "SELECT settings_json FROM publications"
            ).fetchone()["settings_json"])
        self.assertEqual(1, len(settings["contentVersions"]))

    def test_calendar_conflict_rolls_back_artifact_and_brand_rows(self):
        with self.store._connect() as connection:
            connection.execute(
                """INSERT INTO publications VALUES
                   ('scheduled',?,?,?,'scheduled','{}',?,?)""",
                (self.project["project_id"], "2026-10-16", "youtube",
                 "2026-10-15T00:00:00Z", "2026-10-15T00:00:00Z"),
            )
            connection.commit()
        with self.assertRaisesRegex(ValueError, "확정된 캘린더"):
            self.finalize()
        self.assertEqual((0, 1, 0), self.counts())

    def test_checksum_conflict_for_same_job_rolls_back_second_format(self):
        self.finalize()
        with self.assertRaisesRegex(ValueError, "checksum"):
            self.finalize(artifacts=[self.artifact(checksum="sha256:different")])
        self.assertEqual((1, 1, 0), self.counts())


if __name__ == "__main__":
    unittest.main()
