import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "01_app" / "auth_store.py"
SPEC = importlib.util.spec_from_file_location("auth_store", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class AuthStoreTests(unittest.TestCase):
    def test_content_schema_is_initialized(self):
        with tempfile.TemporaryDirectory() as folder:
            store = MODULE.AuthStore(Path(folder) / "tc.sqlite")
            connection = store._connect()
            try:
                tables = {
                    row["name"]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    )
                }
                self.assertTrue(
                    {
                        "project_stage_revisions",
                        "ai_conversations",
                        "ai_messages",
                        "stage_candidates",
                        "stage_dependencies",
                        "artifacts",
                        "publications",
                        "api_usage_events",
                        "seasonal_keyword_sets",
                        "groups",
                        "group_members",
                        "group_resources",
                    }.issubset(tables)
                )
            finally:
                connection.close()

    def test_publication_uniqueness_matches_product_contract(self):
        with tempfile.TemporaryDirectory() as folder:
            store = MODULE.AuthStore(Path(folder) / "tc.sqlite")
            user = store.create_user("calendar-user", "password123")
            project = store.default_project(user["user_id"])
            row = (
                "pub_1",
                project["project_id"],
                "2026-09-17",
                "instagram",
                "draft",
                "{}",
                "2026-09-17T00:00:00+00:00",
                "2026-09-17T00:00:00+00:00",
            )
            connection = store._connect()
            try:
                connection.execute("INSERT INTO publications VALUES (?, ?, ?, ?, ?, ?, ?, ?)", row)
                with self.assertRaises(sqlite3.IntegrityError):
                    connection.execute(
                        "INSERT INTO publications VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        ("pub_2", *row[1:]),
                    )
            finally:
                connection.close()

    def test_user_session_and_project_round_trip(self):
        with tempfile.TemporaryDirectory() as folder:
            store = MODULE.AuthStore(Path(folder) / "tc.sqlite")
            user = store.ensure_user("tcadmin", "test-password")
            self.assertIsNone(store.authenticate("tcadmin", "wrong"))
            self.assertEqual(store.authenticate("tcadmin", "test-password")["user_id"], user["user_id"])
            token = store.create_session(user["user_id"])
            self.assertEqual(store.session_user(token)["username"], "tcadmin")
            project = store.ensure_project(user["user_id"], "greenhill-demo", "그린힐 콘텐츠")
            self.assertEqual(project["owner_user_id"], user["user_id"])
            store.delete_session(token)
            self.assertIsNone(store.session_user(token))

    def test_one_user_can_create_multiple_uuid_projects(self):
        with tempfile.TemporaryDirectory() as folder:
            store = MODULE.AuthStore(Path(folder) / "tc.sqlite")
            user = store.create_user("project-owner", "password-123")
            first = store.create_project(user["user_id"], "첫 콘텐츠")
            second = store.create_project(user["user_id"], "둘째 콘텐츠")
            self.assertNotEqual(first["project_id"], second["project_id"])
            self.assertEqual(36, len(first["project_id"]))
            self.assertEqual(
                {first["project_id"], second["project_id"]},
                {project["project_id"] for project in store.list_projects(user["user_id"])},
            )

    def test_empty_legacy_default_project_is_removed(self):
        with tempfile.TemporaryDirectory() as folder:
            database = Path(folder) / "tc.sqlite"
            store = MODULE.AuthStore(database)
            user = store.create_user("legacy-owner", "password-123")
            store.ensure_project(user["user_id"], f"project_{user['user_id']}", "내 콘텐츠")
            self.assertEqual(1, len(store.list_projects(user["user_id"])))
            reloaded = MODULE.AuthStore(database)
            self.assertEqual([], reloaded.list_projects(user["user_id"]))

    def test_api_usage_is_counted_by_project_and_account(self):
        with tempfile.TemporaryDirectory() as folder:
            store = MODULE.AuthStore(Path(folder) / "tc.sqlite")
            user = store.create_user("usage-owner", "password-123")
            project = store.create_project(user["user_id"], "시즌 콘텐츠")
            usage_id = store.record_api_usage(
                user["user_id"], project["project_id"], "openai", "test-model",
                "seasonal_keyword_recommendation", "resp_test",
                {"input_tokens": 120, "output_tokens": 30, "total_tokens": 150},
            )
            store.save_seasonal_keywords(
                project["project_id"], "2026-09-17",
                [{"id": "season-1", "label": "가을", "description": "계절 추천"}], usage_id,
            )
            summary = store.usage_summary(user["user_id"], project["project_id"])
            self.assertEqual({"requests": 1, "input_tokens": 120, "output_tokens": 30, "total_tokens": 150}, summary)
            provider = store.provider_usage_summary(user["user_id"], "openai")
            self.assertEqual(150, provider["month"]["total_tokens"])
            self.assertEqual(1, provider["total"]["requests"])
            with self.assertRaises(ValueError):
                store.provider_usage_summary(user["user_id"], "unknown")
            self.assertEqual("가을", store.seasonal_keywords(project["project_id"], "2026-09-17")[0]["label"])

    def test_personal_group_owns_projects_and_inherited_resources(self):
        with tempfile.TemporaryDirectory() as folder:
            store = MODULE.AuthStore(Path(folder) / "tc.sqlite")
            user = store.create_user("group-owner", "password-123")
            group = store.personal_group(user["user_id"])
            project = store.create_project(user["user_id"], "그룹 콘텐츠")
            resource = store.put_group_resource(
                user["user_id"], "prompt_contract", "people-places-scenes", "1.0.0",
                {"reference_asset_kinds": ["character", "location", "style"]},
                "contracts/unified-content-production.schema.json#/$defs",
            )
            self.assertEqual(group["group_id"], project["group_id"])
            self.assertEqual("owner", group["role"])
            self.assertEqual(resource["group_id"], project["group_id"])
            self.assertEqual("people-places-scenes", store.list_group_resources(user["user_id"])[0]["resource_key"])

    def test_project_stage_and_reference_reads_are_group_isolated(self):
        with tempfile.TemporaryDirectory() as folder:
            store = MODULE.AuthStore(Path(folder) / "tc.sqlite")
            first_user = store.create_user("first-group", "password-123")
            second_user = store.create_user("second-group", "password-123")
            first_project = store.create_project(first_user["user_id"], "첫 프로젝트")
            second_project = store.create_project(second_user["user_id"], "둘째 프로젝트")
            store.put_group_resource(
                first_user["user_id"], "storyboard_template", "first-sample", "1.0.0",
                {"content": "첫 그룹 전용 샘플"}, "group://first/sample",
            )
            store.put_group_resource(
                second_user["user_id"], "storyboard_template", "second-sample", "1.0.0",
                {"content": "둘째 그룹 전용 샘플"}, "group://second/sample",
            )
            resources = store.project_group_resources(
                first_user["user_id"], first_project["project_id"], ("storyboard_template",)
            )
            self.assertEqual(["first-sample"], [item["resource_key"] for item in resources])
            self.assertEqual([], store.project_group_resources(
                first_user["user_id"], second_project["project_id"], ("storyboard_template",)
            ))
            first = store.save_stage_draft(
                first_user["user_id"], first_project["project_id"], 2,
                {"selected_keywords": ["안심"]},
            )
            second = store.save_stage_draft(
                first_user["user_id"], first_project["project_id"], 2,
                {"selected_keywords": ["존중"]},
            )
            self.assertEqual(1, first["revision"])
            self.assertEqual(2, second["revision"])
            confirmed = store.confirm_stage_revision(
                first_user["user_id"], first_project["project_id"], second["revision_id"]
            )
            self.assertEqual("confirmed", confirmed["status"])
            self.assertEqual(
                ["존중"],
                store.latest_stage_data(first_user["user_id"], first_project["project_id"], 2)["data"]["selected_keywords"],
            )

    def test_registration_rejects_duplicate_and_short_password(self):
        with tempfile.TemporaryDirectory() as folder:
            store = MODULE.AuthStore(Path(folder) / "tc.sqlite")
            with self.assertRaisesRegex(ValueError, "8자"):
                store.create_user("new-user", "short")
            store.create_user("new-user", "password-123")
            with self.assertRaisesRegex(ValueError, "이미 사용"):
                store.create_user("new-user", "password-456")


if __name__ == "__main__":
    unittest.main()
