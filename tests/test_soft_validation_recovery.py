import json
import sys
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "01_app"
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

import render_server
from tools import unified_content_prompt_harness as harness
from tools.validate_unified_content import UnifiedContentError


def response_with(plan, response_id):
    payload = {
        "id": response_id,
        "model": "test-model",
        "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
        "output": [{"content": [{
            "type": "output_text", "text": json.dumps(plan, ensure_ascii=False),
        }]}],
    }
    response = mock.MagicMock()
    response.__enter__.return_value = response
    response.read.return_value = json.dumps(payload, ensure_ascii=False).encode()
    return response


class SoftValidationRecoveryTests(unittest.TestCase):
    def test_editorial_failure_falls_back_to_valid_original_plan(self):
        valid = {
            "schema_version": "1.0.0",
            "title": "편안한 오늘",
            "synopsis": "생활 공간에서 안부를 나누는 하루",
            "narration_beats": ["작은 미소가 머뭅니다."] * 15,
            "cast_choices": ["어르신"],
            "location_choices": ["생활 공간"],
        }
        invalid_review = dict(valid)
        invalid_review["narration_beats"] = list(valid["narration_beats"])
        invalid_review["narration_beats"][-1] = "열세글자를명백하게넘기는문장입니다."
        replies = [response_with(valid, "initial")]
        replies.extend(response_with(invalid_review, f"review-{index}") for index in range(3))

        with mock.patch.object(render_server, "urlopen", side_effect=replies):
            plan, metadata = render_server.openai_script_plan(
                "test-key", ["안심"], [], [], "2026-10-16"
            )

        self.assertEqual(valid["narration_beats"], plan["narration_beats"])
        self.assertTrue(metadata["recovery"]["editorial_fallback"])
        self.assertEqual(3, len(metadata["recovery"]["editorial_validation_errors"]))

    def test_bridge_error_gets_three_repairs_before_fresh_generation(self):
        candidate = {
            "project": {}, "concept_variants": [], "selected_variant_id": "",
            "production": {"timeline": {"scenes": []}},
        }
        calls = []
        bridge_error = UnifiedContentError(
            "scene-07 전환 전용 연결 복도는 연속 사용하지 말고 장소 이동당 정확히 1씬만 사용해야 합니다"
        )
        outcomes = [bridge_error, bridge_error, bridge_error, bridge_error, None]

        def validate(*_args, **_kwargs):
            outcome = outcomes.pop(0)
            if outcome:
                raise outcome

        with mock.patch.object(harness, "validate_document", side_effect=validate):
            result = harness.run_generation_harness(
                lambda prompt: calls.append(prompt) or json.dumps(candidate),
                ["안심"], "시설 자료",
            )

        self.assertEqual(5, len(calls))
        self.assertEqual(3, result["repair_count"])
        self.assertEqual(1, result["regeneration_count"])
        self.assertEqual(calls[0], calls[4])

    def test_location_activity_policy_uses_targeted_repair_limit(self):
        error = UnifiedContentError(
            "scene-05: 물리치료실 장면에는 물리치료 행동만 배치해야 합니다"
        )
        self.assertEqual(3, harness.validation_repair_limit(error))
        self.assertEqual(3, harness.validation_repair_limit(
            UnifiedContentError("schema validation failed")
        ))
        self.assertEqual(2, harness.MAX_FRESH_REGENERATIONS)


if __name__ == "__main__":
    unittest.main()
