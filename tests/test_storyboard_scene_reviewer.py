import copy
import json
import sys
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "01_app"))

from storyboard_scene_reviewer import (
    build_scene_review_prompt,
    parse_scene_review,
    review_storyboard_scenes,
)


def document(scene_count=12):
    return {
        "production": {
            "reference_assets": [{"id": "ref-v2", "kind": "character"}],
            "continuity": {"character_version": "v2"},
            "global_prompts": {"negative": "unnatural motion"},
            "timeline": {
                "scenes": [
                    {
                        "id": f"scene-{index + 1:02d}",
                        "start": index * 3,
                        "end": (index + 1) * 3,
                        "media_type": "image",
                        "source_media": None,
                        "narration_cue_ids": [f"cue-{index + 1:02d}"],
                        "narration": {"text": f"나레이션 {index + 1}"},
                        "caption": {"text": f"자막 {index + 1}"},
                        "image_prompt": f"장면 {index + 1}",
                        "camera": {"shot": "medium"},
                    }
                    for index in range(scene_count)
                ]
            },
        }
    }


def prompt_context(prompt):
    return json.loads(prompt.split("검수 컨텍스트:\n", 1)[1])


class StoryboardSceneReviewerTests(unittest.TestCase):
    def test_passes_all_scenes_with_bounded_parallel_progress(self):
        source = document()
        progress = []
        active = 0
        maximum_active = 0
        guard = threading.Lock()

        def review(_prompt):
            nonlocal active, maximum_active
            with guard:
                active += 1
                maximum_active = max(maximum_active, active)
            try:
                return json.dumps({"status": "pass", "issues": []})
            finally:
                with guard:
                    active -= 1

        result = review_storyboard_scenes(source, review, progress.append, concurrency=3)
        self.assertEqual(12, result["completed_scenes"])
        self.assertEqual(12, result["total_scenes"])
        self.assertEqual(0, result["failed_scenes"])
        self.assertLessEqual(maximum_active, 3)
        self.assertEqual(12, progress[-1]["completed_scenes"])
        self.assertEqual("scene_review", progress[-1]["phase"])

    def test_repairs_only_mutable_fields_and_retries_invalid_json(self):
        source = document()
        calls = {}

        def review(prompt):
            context = prompt_context(prompt)
            scene = context["scene"]
            scene_id = scene["id"]
            calls[scene_id] = calls.get(scene_id, 0) + 1
            if scene_id == "scene-01" and calls[scene_id] == 1:
                return "not-json"
            if scene_id == "scene-01":
                repaired = copy.deepcopy(scene)
                repaired["image_prompt"] = "자연스러운 손동작으로 수정"
                return json.dumps({"status": "repair", "issues": ["부자연스러운 동작"], "scene": repaired}, ensure_ascii=False)
            return json.dumps({"status": "pass", "issues": []})

        result = review_storyboard_scenes(source, review, concurrency=2)
        self.assertEqual(2, calls["scene-01"])
        self.assertEqual(1, result["repaired_scenes"])
        self.assertEqual("자연스러운 손동작으로 수정", result["document"]["production"]["timeline"]["scenes"][0]["image_prompt"])

    def test_rejects_immutable_change_after_three_attempts(self):
        source = document()
        progress = []
        attempts = 0

        def review(prompt):
            nonlocal attempts
            attempts += 1
            scene = prompt_context(prompt)["scene"]
            repaired = copy.deepcopy(scene)
            repaired["caption"] = {"text": "변경 금지"}
            return json.dumps({"status": "repair", "issues": ["시험"], "scene": repaired}, ensure_ascii=False)

        with self.assertRaisesRegex(RuntimeError, "씬별 검수를 완료하지 못했습니다"):
            review_storyboard_scenes(source, review, progress.append, concurrency=1, max_attempts=3)
        self.assertEqual(36, attempts)
        self.assertEqual(12, progress[-1]["failed_scenes"])

    def test_prompt_contains_adjacent_context_and_parser_rejects_added_fields(self):
        source = document()
        context = prompt_context(build_scene_review_prompt(source, 1))
        self.assertEqual("scene-01", context["previous_scene"]["id"])
        self.assertEqual("scene-02", context["scene"]["id"])
        self.assertEqual("scene-03", context["next_scene"]["id"])
        changed = copy.deepcopy(context["scene"])
        changed["unexpected"] = True
        with self.assertRaisesRegex(ValueError, "추가하거나 제거"):
            parse_scene_review(json.dumps({"status": "repair", "issues": ["x"], "scene": changed}), context["scene"])


if __name__ == "__main__":
    unittest.main()
