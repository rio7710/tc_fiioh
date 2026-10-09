import sys
import unittest
from pathlib import Path


APP = Path(__file__).resolve().parents[1] / "01_app"
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

import render_server


class AuthoredStoryReferenceTests(unittest.TestCase):
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
