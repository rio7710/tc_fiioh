import sys
import unittest
from pathlib import Path


APP = Path(__file__).resolve().parents[1] / "01_app"
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

import render_server


class AuthoredStoryReferenceTests(unittest.TestCase):
    @staticmethod
    def script_plan_with_beat(beat):
        return {
            "schema_version": "1.0.0",
            "title": "오늘의 달력",
            "synopsis": "달력을 함께 살펴보는 편안한 하루",
            "narration_beats": [beat] + ["작은 미소가 머뭉니다."] * 14,
            "cast_choices": ["어르신", "돌봄 직원"],
            "location_choices": ["생활 공간"],
        }

    def test_script_plan_normalization_removes_formatting_drift(self):
        plan = render_server.normalize_script_plan({
            "schema_version": "1",
            "title": "  새 제목  ",
            "synopsis": "  새 이야기  ",
            "narration_beats": "  첫 문장  ",
            "cast_choices": [" 어르신 ", ""],
            "location_choices": [" 거실 "],
            "unexpected": "removed",
        })
        self.assertEqual("1.0.0", plan["schema_version"])
        self.assertEqual(["첫 문장"], plan["narration_beats"])
        self.assertEqual(["어르신"], plan["cast_choices"])
        self.assertEqual(["거실"], plan["location_choices"])
        self.assertNotIn("unexpected", plan)

    def test_normalized_recovery_case_passes_schema_without_source_copy(self):
        plan = render_server.normalize_script_plan({
            "schema_version": "unexpected-provider-version",
            "title": "  문턱에 머문 따뜻한 마음  ",
            "synopsis": "기다림과 배려를 화면의 작은 행동으로 보여 준다.",
            "narration_beats": ["작은 미소가 머뭅니다."] * 15,
            "cast_choices": ["은지 — 여성 돌봄 직원", "정희 — 여성 입소자"],
            "location_choices": "시설 출입구",
            "provider_note": "remove me",
        })
        render_server.validate_script_plan(plan, "전혀 다른 사람이 작성한 기존 원고입니다.")
        self.assertEqual("1.0.0", plan["schema_version"])
        self.assertNotIn("provider_note", plan)

    def test_context_includes_authored_sources_and_excludes_generated_standards(self):
        resources = [
            {"resource_type": "prompt_guidance_source", "resource_key": "CARE.md", "payload": {"content": "사람 원고 A"}},
            {"resource_type": "test_content_sample", "resource_key": "그린힐_30초영상_컨셉대본_12안_제출본.md", "payload": {"content": "사람 원고 B"}},
            {"resource_type": "test_content_sample", "resource_key": "GENERATED_STANDARD_v1.md", "payload": {"content": "생성 결과"}},
        ]
        context = render_server.human_storyboard_reference_context(resources)
        self.assertIn("사람 원고 A", context)
        self.assertIn("사람 원고 B", context)
        self.assertNotIn("생성 결과", context)

    def test_verbatim_or_near_verbatim_narration_is_rejected(self):
        context = "| 화면 | 내레이션 |\n| 창가 | 따뜻한 빛이 오늘의 마음을 천천히 엽니다. |"
        exact = {"narration_beats": ["따뜻한 빛이 오늘의 마음을 천천히 엽니다."]}
        similar = {"narration_beats": ["따뜻한 빛이 오늘 마음을 천천히 엽니다"]}
        fresh = {"narration_beats": ["창가에 놓인 찻잔 너머로 조용한 안부가 번집니다."]}
        self.assertEqual(1.0, render_server.authored_copy_similarity(exact, context))
        self.assertGreaterEqual(render_server.authored_copy_similarity(similar, context), 0.90)
        self.assertLess(render_server.authored_copy_similarity(fresh, context), 0.90)

    def test_off_season_word_is_rejected_for_october(self):
        plan = self.script_plan_with_beat("달력 한 칸에 봄을 심고")
        with self.assertRaisesRegex(ValueError, "한국 계절은 가을"):
            render_server.validate_script_plan(
                plan, selected_labels=["어르신의 계절 달력"], local_date="2026-10-14")

    def test_care_word_is_not_mistaken_for_spring(self):
        plan = self.script_plan_with_beat("세심한 돌봄을 이어갑니다")
        render_server.validate_script_plan(
            plan, selected_labels=["전문 돌봄"], local_date="2026-10-14")
        self.assertEqual([], render_server.script_plan_season_conflicts(
            {"title": "함께 해봄으로써 배우는 하루", "synopsis": "", "narration_beats": []},
            ["전문 돌봄"], "2026-10-14"))

    def test_explicit_season_keyword_allows_intentional_off_season_story(self):
        plan = self.script_plan_with_beat("달력 한 칸에 봄을 심고")
        render_server.validate_script_plan(
            plan, selected_labels=["봄맞이 달력"], local_date="2026-10-14")

    def test_initial_and_repair_requests_share_validator_contract(self):
        contract = render_server.script_plan_request_contract(
            ["어르신의 계절 달력"], "2026-10-14")
        for required in (
            "schema_version은 1.0.0", "15~18개", "13자 이하", "180~210자",
            "인물 이름·캐릭터 ID", "직접 인용", "현재 계절: 가을",
            "어르신의 계절 달력",
        ):
            self.assertIn(required, contract)


if __name__ == "__main__":
    unittest.main()
