import json
import unittest

from tools.unified_content_prompt_harness import build_prompt, build_repair_prompt, normalize_document_shape, normalize_unknown_table_reference_locks, parse_json_document, run_generation_harness, validate_document, validate_visual_continuity
from tools.validate_unified_content import UnifiedContentError
from tools.validate_json_schema import JsonSchemaError, validate_json_schema


def document(keywords):
    return {
        "schema_version": "1.0.0",
        "project": {"selected_keywords": keywords},
        "concept_variants": [{"id": "concept-01"}],
        "selected_variant_id": "concept-01",
        "production": {"reference_assets": [{"id": "ref-character-elder"}, {"id": "ref-location-dining"}], "timeline": {"scenes": [{
            "id": "scene-01", "start": 0, "end": 30, "media_type": "image",
            "reference_ids": ["ref-character-elder", "ref-location-dining"],
            "narration_cue_ids": ["narration-01"], "sequence": {"continuity_from": None},
            "narration": {"text": "함께 걷는 오늘", "source": "ai_inferred"},
            "caption": {"text": "함께 걷는 오늘", "source": "ai_inferred"}
        }]}, "narration_cues": [{
            "id": "narration-01", "start": 0, "end": 30, "scene_ids": ["scene-01"],
            "narration": {"text": "함께 걷는 오늘", "source": "ai_inferred"},
            "caption": {"text": "함께 걷는 오늘", "source": "ai_inferred"},
            "timing_source": "estimated_speech_rate", "estimated_duration_seconds": 30,
            "measured_duration_seconds": None, "audio_uri": None
        }]},
    }


class UnifiedContentPromptHarnessTests(unittest.TestCase):
    def test_prompt_carries_variable_keywords_and_contract(self):
        prompt = build_prompt(["재활", "존중"], "시설 자료")
        self.assertIn('["재활", "존중"]', prompt)
        self.assertIn("caption.text", prompt)
        self.assertIn("timeline.scenes[-1].end", prompt)
        self.assertIn("`reference_assets`, `continuity`, `global_prompts`, `timing_policy`, `timeline`, `narration_cues`, `postproduction`, `output`은 반드시 `production` 내부", prompt)
        self.assertIn("귀에 자연스럽게 들리는 짧은 시적 카피", prompt)
        self.assertIn("매번 반복할 문장이 아니다", prompt)
        self.assertIn("승인된 사람 작성 원고", prompt)
        self.assertIn("방향이 놓이고", prompt)
        self.assertIn("zoom_in", json.dumps(json.loads(__import__('pathlib').Path('contracts/unified-content-production.schema.json').read_text(encoding='utf-8')), ensure_ascii=False))
        self.assertIn("고정숏과 이동숏", prompt)
        self.assertIn("실사 장소 레퍼런스를 기본 매체", prompt)
        self.assertIn("고정 `character_id`", prompt)
        self.assertIn("서로 다른 공간을 두 곳 이상", prompt)
        self.assertIn("관광식 나열은 금지", prompt)
        self.assertIn("원문·순서 그대로", prompt)
        self.assertIn("각 큐의 `caption.text`는 `narration.text`와 완전히 동일", prompt)
        self.assertIn("IDENTITY LOCK", prompt)
        self.assertIn("TEXT STATE LOCK", prompt)
        self.assertIn("이전 생성 이미지 URI를 요청하지 않는다", prompt)
        self.assertIn("원본 캐릭터·시설 레퍼런스", prompt)
        self.assertIn("SPATIAL PROGRESSION LOCK", prompt)
        self.assertNotIn("PREVIOUS FRAME LOCK", prompt)
        self.assertIn("앞발 착지 → 체중 이동", prompt)
        self.assertIn("MOTION PHASE LOCK", prompt)
        self.assertIn("구도 차이가 미미하면", prompt)
        self.assertIn("EXPRESSION LOCK", prompt)
        self.assertIn("입가와 눈빛이 함께 부드러워지는", prompt)
        self.assertIn("그 파일 하나만 이미지 생성 worker에 전달", prompt)
        self.assertIn("문서 밖의 보충 프롬프트", prompt)
        self.assertIn("충분한 전경·중경·후경", prompt)
        self.assertIn("협소한 구도", prompt)
        self.assertIn("기획 길이는 최소 1.5초", prompt)
        self.assertIn("장면 수나 컷 길이를 하드코딩하지 않는다", prompt)
        self.assertIn("전체 시간 ÷ 씬 수", prompt)
        self.assertIn("각 씬의 길이를 다르게 배정", prompt)
        self.assertIn("LOCATION LATCH", prompt)
        self.assertIn("SCREEN-AXIS LOCK", prompt)
        self.assertIn("FURNITURE GEOMETRY LOCK", prompt)
        self.assertIn("한 레퍼런스 안에 서로 다른 테이블 형태가 함께 있으면", prompt)
        self.assertIn("sequence.camera_axis_transition", prompt)

    def test_prior_output_is_supplied_as_avoidance_context(self):
        prior = document(["재활", "존중"])
        prior["document_id"] = "prior-one"
        prompt = build_prompt(["재활", "존중"], "시설 자료", [prior])
        self.assertIn("prior-one", prompt)
        self.assertIn("함께 걷는 오늘", prompt)

    def test_group_reference_override_replaces_repository_samples(self):
        prompt = build_prompt(["안심"], "그룹 시설 자료", reference_material="이 그룹 전용 대본 샘플")
        self.assertIn("그룹 시설 자료", prompt)
        self.assertIn("이 그룹 전용 대본 샘플", prompt)
        self.assertNotIn("CARE_STORYBOARD_STANDARD", prompt)

    def test_normalizes_root_timeline_and_timing_policy(self):
        value = document(["안심"])
        timeline = value["production"].pop("timeline")
        timing_policy = {"minimum_scene_duration_seconds": 1.5}
        value["timeline"] = timeline
        value["timing_policy"] = timing_policy

        normalized = normalize_document_shape(value)

        self.assertNotIn("timeline", normalized)
        self.assertNotIn("timing_policy", normalized)
        self.assertEqual(timeline, normalized["production"]["timeline"])
        self.assertEqual(timing_policy, normalized["production"]["timing_policy"])

    def test_normalizes_all_production_sections_from_document_root(self):
        value = document(["안심"])
        expected = {}
        for key in ("reference_assets", "continuity", "global_prompts", "timing_policy", "timeline", "narration_cues", "postproduction", "output"):
            expected[key] = value["production"].pop(key, {"section": key})
            value[key] = expected[key]

        normalized = normalize_document_shape(value)

        for key, section in expected.items():
            self.assertNotIn(key, normalized)
            self.assertEqual(section, normalized["production"][key])

    def test_missing_continuity_source_is_marked_ai_inferred(self):
        value = document(["안심"])
        value["production"]["continuity"] = {
            "characters": [{"text": "미자는 같은 인물로 유지한다."}],
            "locations": [{"text": "휴게실과 가족상담실의 구조를 유지한다."}],
            "props": [{"text": "스케치북은 장면 사이 같은 상태를 유지한다.", "source": "provided"}],
        }

        normalize_document_shape(value)

        continuity = value["production"]["continuity"]
        self.assertEqual("ai_inferred", continuity["characters"][0]["source"])
        self.assertEqual("ai_inferred", continuity["locations"][0]["source"])
        self.assertEqual("provided", continuity["props"][0]["source"])

    def test_repair_prompt_repeats_exact_camera_motion_enum(self):
        prompt = build_repair_prompt("{}", ValueError("camera_motion is invalid"))
        self.assertIn('sequence.camera_motion는 다음 값 중 하나만 사용한다', prompt)
        self.assertIn('"fixed"', prompt)
        self.assertIn('"dolly_in"', prompt)
        self.assertIn("이동 근거가 없으면 해당 씬을 same_side로 고치며", prompt)

    def test_enum_schema_error_reports_actual_and_allowed_values(self):
        with self.assertRaises(JsonSchemaError) as raised:
            validate_json_schema("slow_push", {"enum": ["fixed", "dolly_in"]})
        self.assertIn("'slow_push'", str(raised.exception))
        self.assertIn("'dolly_in'", str(raised.exception))

    def test_rejects_conflicting_root_and_production_timeline(self):
        value = document(["안심"])
        value["timeline"] = {"scenes": []}

        with self.assertRaisesRegex(UnifiedContentError, "conflicts with production.timeline"):
            normalize_document_shape(value)

    def test_strict_schema_rejects_incomplete_generation(self):
        with self.assertRaisesRegex(UnifiedContentError, "schema validation failed"):
            validate_document(document(["안심"]), ["안심"], strict_schema=True)

    def test_rejects_prose_wrapped_json(self):
        with self.assertRaises(UnifiedContentError):
            parse_json_document('결과입니다: {"ok": true}')

    def test_one_bounded_repair(self):
        calls = []
        valid = json.dumps(document(["안심"]), ensure_ascii=False)

        def generate(prompt):
            calls.append(prompt)
            return "not json" if len(calls) == 1 else valid

        result = run_generation_harness(generate, ["안심"], "자료")
        self.assertEqual(1, result["repair_count"])
        self.assertEqual(2, len(calls))
        self.assertEqual("establish", result["document"]["production"]["timeline"]["scenes"][0]["sequence"]["camera_axis_transition"])

    def test_missing_project_metadata_is_filled_from_locked_inputs(self):
        value = document(["안심"])
        value["project"] = {}
        plan = {
            "title": "확정된 제목", "synopsis": "확정된 이야기 요약",
            "narration_beats": [value["production"]["narration_cues"][0]["narration"]["text"]],
        }
        result = run_generation_harness(
            lambda prompt: json.dumps(value, ensure_ascii=False), ["안심"], "시설 자료",
            locked_plan=plan,
        )
        project = result["document"]["project"]
        self.assertEqual("확정된 제목", project["title"])
        self.assertEqual("확정된 이야기 요약", project["purpose"])
        self.assertEqual(["안심"], project["selected_keywords"])
        self.assertEqual("16:9", project["aspect_ratio"])
        self.assertEqual({"width": 1920, "height": 1080}, project["resolution"])

    def test_second_bounded_repair_handles_followup_validation_error(self):
        value = document(["안심"])
        base = value["production"]["timeline"]["scenes"][0]
        first = json.loads(json.dumps(base))
        first.update(id="scene-a1", reference_ids=["ref-location-roof"], narration_cue_ids=["narration-01"])
        first["sequence"].update(continuity_from=None, exit_action="정원에서 실내 복도로 이동한다.")
        second = json.loads(json.dumps(first))
        second.update(id="scene-b", start=30, end=60, reference_ids=["ref-location-room"])
        second["sequence"].update(continuity_from="scene-a1", entry_action="복도를 지나 실내에 도착한다.", exit_action="실내에서 머문다.")
        third = json.loads(json.dumps(first))
        third.update(id="scene-a2", start=60, end=90)
        third["sequence"].update(continuity_from="scene-b", entry_action="정원에서 활동을 이어간다.")
        value["production"]["reference_assets"] = [
            {"id": "ref-location-roof", "kind": "location"},
            {"id": "ref-location-room", "kind": "location"},
        ]
        value["production"]["timeline"]["scenes"] = [first, second, third]
        cue = value["production"]["narration_cues"][0]
        cue.update(end=90, scene_ids=["scene-a1", "scene-b", "scene-a2"])

        calls = []
        def generate(prompt):
            calls.append(prompt)
            if len(calls) == 1:
                return "not json"
            if len(calls) == 2:
                return json.dumps(value, ensure_ascii=False)
            repaired = json.loads(json.dumps(value))
            repaired["production"]["timeline"]["scenes"][2]["sequence"]["entry_action"] = "복도를 따라 옥상정원으로 돌아오는 이동을 보여준 뒤 활동을 이어간다."
            return json.dumps(repaired, ensure_ascii=False)

        result = run_generation_harness(generate, ["안심"], "시설 자료")
        self.assertEqual(3, len(calls))
        self.assertEqual(2, result["repair_count"])

    def test_location_return_requires_explicit_return_route(self):
        value = document(["안심"])
        scenes = value["production"]["timeline"]["scenes"]
        first = json.loads(json.dumps(scenes[0])); second = json.loads(json.dumps(scenes[0])); third = json.loads(json.dumps(scenes[0]))
        first.update(id="scene-a1", reference_ids=["ref-location-roof"], sequence={"continuity_from":None,"exit_action":"정원에서 실내로 이동한다."})
        second.update(id="scene-b", reference_ids=["ref-location-room"], sequence={"continuity_from":"scene-a1","exit_action":"실내 복도로 향한다."})
        third.update(id="scene-a2", reference_ids=["ref-location-roof"], sequence={"continuity_from":"scene-b","entry_action":"정원에 도착해 활동을 이어간다."})
        value["production"]["reference_assets"] = [
            {"id":"ref-location-roof","kind":"location"},
            {"id":"ref-location-room","kind":"location"},
        ]
        value["production"]["timeline"]["scenes"] = [first, second, third]
        with self.assertRaisesRegex(UnifiedContentError, "귀환 이유와 이동 경로"):
            validate_visual_continuity(value)
        third["sequence"]["entry_action"] = "복도를 지나 옥상정원으로 돌아오는 이동을 화면에 보여준 뒤 활동을 이어간다."
        validate_visual_continuity(value)

    def test_table_geometry_is_declared_and_consistent_with_scene_prompts(self):
        value = document(["안심"])
        value["production"]["continuity"] = {"props":[{"text":"옥상정원에 원형 나무 테이블 하나가 있다."}]}
        value["production"]["reference_assets"][1]["usage"] = "옥상정원의 원형 테이블과 가구 기준"
        value["production"]["timeline"]["scenes"][0]["image_prompt"] = {"text":"동수와 은지, 원형 테이블을 기준 레퍼런스와 같은 형태로 유지한다."}
        validate_document(value, ["안심"])
        value["production"]["timeline"]["scenes"][0]["image_prompt"]["text"] = "동수와 은지, 사각 테이블을 보여준다."
        with self.assertRaisesRegex(UnifiedContentError, "형태와 충돌"):
            validate_document(value, ["안심"])

    def test_square_reference_table_cannot_become_round_in_scene_prompt(self):
        value = document(["안심"])
        value["production"]["continuity"] = {"props":[{"text":"옥상정원에 사각 테이블 하나가 있다."}]}
        value["production"]["reference_assets"][1]["usage"] = "옥상정원의 사각 테이블과 가구 배치 기준"
        value["production"]["timeline"]["scenes"][0]["image_prompt"] = {"text":"사각 테이블 형태와 위치를 레퍼런스대로 유지한다."}
        validate_document(value, ["안심"])
        value["production"]["timeline"]["scenes"][0]["image_prompt"]["text"] = "원형 테이블에서 활동한다."
        with self.assertRaisesRegex(UnifiedContentError, "형태와 충돌"):
            validate_document(value, ["안심"])

    def test_scene_prop_ledger_resolves_multiple_shapes_in_a_shared_reference(self):
        value = document(["안심"])
        value["production"]["continuity"] = {"props": [{"text": "옥상정원 장면에는 사각 테이블을 사용한다."}]}
        value["production"]["reference_assets"][1]["kind"] = "location"
        value["production"]["reference_assets"][1]["usage"] = "시설에는 원형 테이블과 옥상정원의 사각 테이블이 있다."
        value["production"]["timeline"]["scenes"][0]["image_prompt"] = {"text": "옥상정원의 사각 테이블 상판 형태를 레퍼런스대로 유지한다."}
        validate_document(value, ["안심"])

    def test_missing_table_shape_error_names_concrete_korean_terms(self):
        value = document(["안심"])
        value["production"]["continuity"] = {"props": [{"text": "식당에 긴 사각 테이블이 있다."}]}
        value["production"]["reference_assets"][1]["kind"] = "location"
        value["production"]["reference_assets"][1]["usage"] = "식당의 직사각형 테이블 기준"
        value["production"]["timeline"]["scenes"][0]["image_prompt"] = {"text": "인물이 식당에서 대화한다."}
        with self.assertRaisesRegex(UnifiedContentError, "직사각형 또는 긴 사각 테이블") as raised:
            validate_document(value, ["안심"])
        self.assertIn("직접 넣고", build_repair_prompt("{}", raised.exception))

    def test_unknown_table_shape_uses_exact_reference_lock_without_guessing(self):
        value = document(["안심"])
        location = value["production"]["reference_assets"][1]
        location.update(kind="location", usage="식당 테이블의 장소 레퍼런스")
        value["production"]["continuity"] = {"props": []}
        value["production"]["timeline"]["scenes"][0]["image_prompt"] = {
            "text": "테이블이 보이면 기준 레퍼런스의 실루엣·비율·방향을 그대로 유지하고 형태를 임의로 바꾸지 않는다."
        }
        validate_visual_continuity(value)

        value["production"]["timeline"]["scenes"][0]["image_prompt"]["text"] = "인물이 식당에서 대화한다."
        with self.assertRaisesRegex(UnifiedContentError, "형태가 메타데이터에 없으므로"):
            validate_visual_continuity(value)

    def test_unknown_table_shape_gets_reference_lock_during_generation(self):
        value = document(["안심"])
        location = value["production"]["reference_assets"][1]
        location.update(kind="location", usage="식당 테이블의 장소 레퍼런스")
        value["production"]["continuity"] = {"props": []}
        value["production"]["timeline"]["scenes"][0]["image_prompt"] = {
            "text": "인물이 식당 테이블에서 대화한다."
        }

        normalize_unknown_table_reference_locks(value)

        self.assertIn("실루엣·비율·방향을 그대로 유지", value["production"]["timeline"]["scenes"][0]["image_prompt"]["text"])
        validate_visual_continuity(value)

    def test_location_scoped_prop_selects_correct_table_geometry(self):
        value = document(["안심"])
        location = value["production"]["reference_assets"][1]
        location.update(kind="location", usage="가족상담실 테이블과 가구 구조 기준")
        value["production"]["continuity"] = {"props": [
            {"text": "휴게실에는 원형 테이블을 사용한다."},
            {"text": "가족상담실에는 직사각형 테이블을 사용한다."},
        ]}
        scene = value["production"]["timeline"]["scenes"][0]
        scene["title"] = "가족상담실에서 작품을 함께 본다"
        scene["image_prompt"] = {"text": "가족상담실 테이블에서 작품을 함께 본다."}

        normalize_unknown_table_reference_locks(value)

        self.assertIn("직사각형 테이블", scene["image_prompt"]["text"])
        validate_visual_continuity(value)

    def test_camera_axis_crossing_requires_visible_motivated_move(self):
        value = document(["안심"])
        first = value["production"]["timeline"]["scenes"][0]
        first["sequence"]["camera_axis_transition"] = "establish"
        second = json.loads(json.dumps(first))
        second["id"] = "scene-02"
        second["sequence"]["camera_axis_transition"] = "motivated_cross"
        second["sequence"]["camera_bridge"] = "A medium shot of the same people."
        value["production"]["timeline"]["scenes"].append(second)
        with self.assertRaisesRegex(UnifiedContentError, "보이는 계기"):
            validate_document(value, ["안심"])

    def test_camera_axis_crossing_accepts_explicit_english_camera_move(self):
        value = document(["안심"])
        first = value["production"]["timeline"]["scenes"][0]
        first["sequence"]["camera_axis_transition"] = "establish"
        second = json.loads(json.dumps(first))
        second["id"] = "scene-02"
        second["sequence"]["camera_axis_transition"] = "motivated_cross"
        second["sequence"]["camera_bridge"] = "Camera visibly tracks around the table to the opposite side, crossing the established axis."
        value["production"]["timeline"]["scenes"].append(second)
        validate_visual_continuity(value)

    def test_unmotivated_generated_axis_cross_is_normalized_to_same_side(self):
        value = document(["안심"])
        first = value["production"]["timeline"]["scenes"][0]
        first["sequence"]["camera_axis_transition"] = "establish"
        second = json.loads(json.dumps(first))
        second.update(id="scene-02", start=30, end=60, narration_cue_ids=["narration-02"])
        second["sequence"].update(continuity_from="scene-01", camera_axis_transition="motivated_cross",
                                  camera_bridge="A medium shot of the same people.")
        value["production"]["timeline"]["scenes"].append(second)
        cue = json.loads(json.dumps(value["production"]["narration_cues"][0]))
        cue.update(id="narration-02", start=30, end=60, scene_ids=["scene-02"])
        value["production"]["narration_cues"].append(cue)

        calls = []
        def generate(prompt):
            calls.append(prompt)
            return json.dumps(value, ensure_ascii=False)

        result = run_generation_harness(generate, ["안심"], "시설 자료")
        self.assertEqual(1, len(calls))
        self.assertEqual("same_side", result["document"]["production"]["timeline"]["scenes"][1]["sequence"]["camera_axis_transition"])
        validate_visual_continuity(result["document"])

    def test_later_establish_marker_is_normalized_to_same_side(self):
        value = document(["안심"])
        first = value["production"]["timeline"]["scenes"][0]
        first["sequence"]["camera_axis_transition"] = "establish"
        second = json.loads(json.dumps(first))
        second.update(id="scene-02", start=30, end=60, narration_cue_ids=["narration-02"])
        second["sequence"]["continuity_from"] = "scene-01"
        value["production"]["timeline"]["scenes"].append(second)
        cue = json.loads(json.dumps(value["production"]["narration_cues"][0]))
        cue.update(id="narration-02", start=30, end=60, scene_ids=["scene-02"])
        value["production"]["narration_cues"].append(cue)
        result = run_generation_harness(lambda prompt: json.dumps(value, ensure_ascii=False), ["안심"], "시설 자료")
        self.assertEqual("same_side", result["document"]["production"]["timeline"]["scenes"][1]["sequence"]["camera_axis_transition"])
        validate_visual_continuity(result["document"])

    def test_axis_validation_failure_gets_safe_same_side_normalization(self):
        value = document(["안심"])
        first = value["production"]["timeline"]["scenes"][0]
        first["id"] = "scene-01"
        first["sequence"]["camera_axis_transition"] = "establish"
        second = json.loads(json.dumps(first))
        second.update(id="scene-02", start=30, end=60, narration_cue_ids=["narration-02"])
        second["sequence"]["continuity_from"] = "scene-01"
        second["sequence"]["camera_axis_transition"] = "motivated_cross"
        second["sequence"]["camera_bridge"] = "A medium shot of the same people."
        value["production"]["timeline"]["scenes"] = [first, second]
        first_cue = value["production"]["narration_cues"][0]
        second_cue = json.loads(json.dumps(first_cue))
        second_cue.update(id="narration-02", start=30, end=60, scene_ids=["scene-02"])
        value["production"]["narration_cues"].append(second_cue)

        calls = []
        def generate(prompt):
            calls.append(prompt)
            candidate = json.loads(json.dumps(value))
            if len(calls) > 1:
                candidate["production"]["timeline"]["scenes"][1]["sequence"]["camera_axis_transition"] = "same_side"
            return json.dumps(candidate, ensure_ascii=False)

        result = run_generation_harness(generate, ["안심"], "시설 자료")
        self.assertEqual(1, len(calls))
        self.assertEqual(0, result["repair_count"])
        self.assertEqual("same_side", result["document"]["production"]["timeline"]["scenes"][1]["sequence"]["camera_axis_transition"])

    def test_repair_prompt_requires_minimal_field_changes(self):
        prompt = build_repair_prompt("{}", UnifiedContentError("schema validation failed"))
        self.assertIn("오류 메시지에 표시된 필드만 최소 변경", prompt)
        self.assertIn("카메라 축", prompt)


if __name__ == "__main__":
    unittest.main()
