import sys
import unittest
from pathlib import Path


APP = Path(__file__).resolve().parents[1] / "01_app"
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

import render_server


class AuthoredStoryReferenceTests(unittest.TestCase):
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
            "narration_beats": [
                "찬 기운이 문틈에 머문 아침, 먼저 문을 두드리는 소리가 조용히 하루를 엽니다.",
                "대답을 기다린 뒤 건넨 담요 한 장은 서두르지 말자는 마음이 되고, 문턱 앞 작은 살핌은 오늘의 길을 편안히 놓습니다.",
                "작은 예의와 따뜻한 배려가 오가는 곳에서, 혼자였던 잠깐의 시간이 서로를 믿는 하루로 이어집니다.",
                "돌봄은 큰 말보다 먼저 살피고 기다리는 마음으로 오래 남습니다.",
            ],
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


if __name__ == "__main__":
    unittest.main()
