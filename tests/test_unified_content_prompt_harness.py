import json
import unittest

from tools.reference_asset_index import build_reference_asset_index, normalize_scene_reference_ids
from tools.unified_content_prompt_harness import build_novelty_repair_prompt, build_prompt, build_repair_prompt, normalize_character_reference_versions, normalize_document_shape, normalize_reference_asset_metadata, normalize_unknown_table_reference_locks, parse_json_document, run_generation_harness, validate_character_reference_versions, validate_document, validate_location_activity_policy, validate_scene_reference_media, validate_transition_bridge_routes, validate_visual_continuity
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
            "image_prompt": {"text": "식당에서 따뜻한 식사를 천천히 한다.", "source": "ai_inferred"},
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
    def test_novelty_repair_preserves_locked_script_and_changes_only_visual_story(self):
        plan = {"title": "확정 제목", "narration_beats": ["확정 자막"]}
        prompt = build_novelty_repair_prompt("{}", 0.91, plan)
        self.assertIn("title과 narration_beats 원문·순서는 절대 바꾸지 않는다", prompt)
        self.assertIn("시각 행동", prompt)
        self.assertNotIn("내레이션 비유를 새로", prompt)

    def test_storyboard_contract_requires_twelve_to_twenty_scenes(self):
        schema = json.loads(__import__('pathlib').Path(
            'contracts/unified-content-production.schema.json'
        ).read_text(encoding='utf-8'))
        scenes = schema['$defs']['production']['properties']['timeline']['properties']['scenes']
        self.assertEqual(12, scenes['minItems'])
        self.assertEqual(20, scenes['maxItems'])
        self.assertIn('12~20개 씬', build_prompt(['안심'], '시설 자료', reference_material=''))
        script_schema = json.loads(__import__('pathlib').Path(
            'contracts/script-plan.schema.json'
        ).read_text(encoding='utf-8'))
        beats = script_schema['properties']['narration_beats']
        self.assertEqual((15, 18, 13), (beats['minItems'], beats['maxItems'], beats['items']['maxLength']))

    def test_canonical_reference_metadata_repairs_missing_uri_and_generated_variant(self):
        value = document(["안심"])
        value["production"]["reference_assets"] = [{
            "id": "ref-character-v2", "kind": "character", "uri": None,
            "status": "ready", "usage": "generated", "wardrobe_variant": "v2-cardigan",
        }]
        normalize_reference_asset_metadata(value, {"ref-character-v2": {
            "id": "ref-character-v2", "kind": "character", "uri": "캐릭터/v2.png",
            "status": "ready", "usage": "canonical", "wardrobe_variant": "cardigan",
        }})
        asset = value["production"]["reference_assets"][0]
        self.assertEqual(asset["uri"], "캐릭터/v2.png")
        self.assertEqual(asset["usage"], "canonical")
        self.assertEqual(asset["wardrobe_variant"], "cardigan")

    def test_dynamic_asset_index_repairs_unique_wrong_kind_prefix(self):
        value = document(["안심"])
        scene = value["production"]["timeline"]["scenes"][0]
        scene["reference_ids"] = ["ref-character-asset-entrance-2632b2ec4f792"]
        scene["image_prompt"] = {
            "text": "ref-character-asset-entrance-2632b2ec4f792 출입구",
            "source": "ai_inferred",
        }
        value["production"]["reference_assets"] = [{
            "id": "ref-character-asset-entrance-2632b2ec4f792", "kind": "character",
        }]
        canonical_id = "ref-location-asset-entrance-2632b2ec4f792"
        catalog = {canonical_id: {
            "id": canonical_id, "kind": "location", "uri": "시설/entrance.png",
            "status": "ready", "usage": "시설 출입구 기준",
        }}

        normalize_scene_reference_ids(value, catalog)

        self.assertEqual([canonical_id], scene["reference_ids"])
        self.assertIn(canonical_id, scene["image_prompt"]["text"])
        self.assertEqual(canonical_id, value["production"]["reference_assets"][0]["id"])

    def test_asset_index_applies_new_assets_and_refuses_ambiguous_aliases(self):
        first = "ref-location-asset-lounge-main"
        second = "ref-character-asset-lounge-main"
        index = build_reference_asset_index({
            first: {"id": first, "kind": "location", "uri": "location/lounge.png"},
            second: {"id": second, "kind": "character", "uri": "character/lounge.png"},
        })
        self.assertNotIn("lounge-main", index["aliases"])
        added = "ref-location-asset-new-library-1234"
        refreshed = build_reference_asset_index({
            added: {"id": added, "kind": "location", "uri": "location/library.png"},
        })
        self.assertEqual(added, refreshed["aliases"]["new-library-1234"])

    def test_scene_reference_media_requires_uri_but_ignores_style_media(self):
        value = document(["안심"])
        value["production"]["reference_assets"] = [
            {"id": "ref-character-v2", "kind": "character", "uri": None,
             "status": "ready", "usage": "character"},
            {"id": "ref-style-film", "kind": "style", "uri": None,
             "status": "ready", "usage": "style"},
        ]
        value["production"]["timeline"]["scenes"][0]["reference_ids"] = [
            "ref-character-v2", "ref-style-film"
        ]
        with self.assertRaisesRegex(UnifiedContentError, "requires a ready character/location uri"):
            validate_scene_reference_media(value)
        value["production"]["reference_assets"][0]["uri"] = "캐릭터/v2.png"
        validate_scene_reference_media(value)

    def test_character_reference_prefers_v2_but_allows_v1_for_uncovered_identity(self):
        value = document(["안심"])
        value["production"]["reference_assets"] = [
            {"id": "ref-character-asset-st-cm02-uniform-v2-cardigan", "kind": "character",
             "character_id": "character-caregiver-m02", "reference_version": "v2",
             "wardrobe_variant": "cardigan"},
            {"id": "ref-character-family-v1", "kind": "character",
             "character_id": "character-family-f01", "reference_version": "v1"},
        ]
        value["production"]["timeline"]["scenes"][0]["reference_ids"] = [
            "ref-character-asset-st-cm02-uniform-v2-cardigan", "ref-character-family-v1"
        ]
        validate_character_reference_versions(value)

    def test_character_reference_rejects_v1_when_v2_exists(self):
        value = document(["안심"])
        value["production"]["reference_assets"] = [{
            "id": "ref-character-old", "kind": "character",
            "character_id": "character-caregiver-m02", "reference_version": "v1",
        }]
        value["production"]["timeline"]["scenes"][0]["reference_ids"] = ["ref-character-old"]
        with self.assertRaisesRegex(UnifiedContentError, "must use V2"):
            validate_character_reference_versions(value)

    def test_character_reference_normalizer_upgrades_v1_and_locks_one_v2(self):
        value = document(["안심"])
        value["production"]["reference_assets"] = [{
            "id": "ref-character-old", "kind": "character",
            "character_id": "character-nurse-m01", "reference_version": "v1",
            "wardrobe_variant": "cardigan",
        }]
        first = value["production"]["timeline"]["scenes"][0]
        first["reference_ids"] = ["ref-character-old"]
        first["image_prompt"] = {"text": "ref-character-old 인물을 유지", "source": "ai_inferred"}
        second = json.loads(json.dumps(first))
        second.update(id="scene-02", start=30, end=60)
        second["sequence"]["continuity_from"] = "scene-01"
        value["production"]["timeline"]["scenes"].append(second)
        catalog = {
            "ref-character-asset-st-nm01-uniform-v2-scrub": {
                "id": "ref-character-asset-st-nm01-uniform-v2-scrub", "kind": "character",
                "character_id": "character-nurse-m01", "reference_version": "v2",
                "wardrobe_variant": "scrub", "status": "ready", "uri": "scrub.png",
            },
            "ref-character-asset-st-nm01-uniform-v2-cardigan": {
                "id": "ref-character-asset-st-nm01-uniform-v2-cardigan", "kind": "character",
                "character_id": "character-nurse-m01", "reference_version": "v2",
                "wardrobe_variant": "cardigan", "status": "ready", "uri": "cardigan.png",
            },
        }

        normalize_character_reference_versions(value, catalog)

        selected = "ref-character-asset-st-nm01-uniform-v2-cardigan"
        self.assertEqual([[selected], [selected]], [scene["reference_ids"] for scene in value["production"]["timeline"]["scenes"]])
        self.assertIn(selected, first["image_prompt"]["text"])
        self.assertTrue(any(asset.get("id") == selected for asset in value["production"]["reference_assets"]))
        validate_character_reference_versions(value)

    def test_error_envelope_does_not_replace_repairable_storyboard(self):
        value = document(["안심"])
        calls = []

        def generate(prompt):
            calls.append(prompt)
            if len(calls) == 1:
                return "not json"
            if len(calls) in {2, 3}:
                return '{"error":"temporary provider failure"}'
            return json.dumps(value, ensure_ascii=False)

        result = run_generation_harness(generate, ["안심"], "자료")

        self.assertEqual(3, result["repair_count"])
        self.assertEqual(4, len(calls))
        self.assertIn("production", result["document"])

    def test_repair_cannot_replace_valid_scene_range_with_short_document(self):
        invalid = document(["안심"])
        base = invalid["production"]["timeline"]["scenes"][0]
        invalid["production"]["timeline"]["scenes"] = []
        for index in range(12):
            scene = json.loads(json.dumps(base, ensure_ascii=False))
            scene.update(id=f"scene-{index + 1:02d}", start=index * 3, end=(index + 1) * 3)
            scene["sequence"]["continuity_from"] = f"scene-{index:02d}" if index else None
            invalid["production"]["timeline"]["scenes"].append(scene)
        invalid["production"]["reference_assets"] = [{
            "id": "ref-character-old", "kind": "character",
            "character_id": "character-caregiver-m02", "reference_version": "v1",
        }]
        for scene in invalid["production"]["timeline"]["scenes"]:
            scene["reference_ids"] = ["ref-character-old"]
        short = json.loads(json.dumps(invalid, ensure_ascii=False))
        short["production"]["timeline"]["scenes"] = short["production"]["timeline"]["scenes"][:1]
        valid = json.loads(json.dumps(invalid, ensure_ascii=False))
        valid["production"]["reference_assets"][0].update(
            character_id="character-uncovered", reference_version="v1",
        )
        responses = iter((invalid, short, valid))

        result = run_generation_harness(
            lambda _prompt: json.dumps(next(responses), ensure_ascii=False),
            ["안심"], "자료",
        )

        self.assertEqual(12, len(result["document"]["production"]["timeline"]["scenes"]))
        self.assertEqual(2, result["repair_count"])

    def test_character_reference_rejects_mid_storyboard_wardrobe_change(self):
        value = document(["안심"])
        value["production"]["reference_assets"] = [
            {"id": "ref-character-asset-st-cm02-uniform-v2-scrub", "kind": "character",
             "character_id": "character-caregiver-m02", "reference_version": "v2",
             "wardrobe_variant": "scrub"},
            {"id": "ref-character-asset-st-cm02-uniform-v2-cardigan", "kind": "character",
             "character_id": "character-caregiver-m02", "reference_version": "v2",
             "wardrobe_variant": "cardigan"},
        ]
        first = value["production"]["timeline"]["scenes"][0]
        first["reference_ids"] = ["ref-character-asset-st-cm02-uniform-v2-scrub"]
        second = json.loads(json.dumps(first))
        second.update(id="scene-02", start=30, end=60,
                      reference_ids=["ref-character-asset-st-cm02-uniform-v2-cardigan"])
        second["sequence"]["continuity_from"] = "scene-01"
        value["production"]["timeline"]["scenes"].append(second)
        with self.assertRaisesRegex(UnifiedContentError, "changes reference version or wardrobe"):
            validate_character_reference_versions(value)

    def test_schema_version_is_pinned_to_the_validated_contract(self):
        value = document(["안심"])
        value["schema_version"] = "1.1"
        self.assertEqual("1.0.0", normalize_document_shape(value)["schema_version"])

    def test_empty_scene_repair_receives_locked_plan_and_full_contract(self):
        prompt = build_repair_prompt(
            '{"production":{"timeline":{"scenes":[]}}}',
            UnifiedContentError(
                "schema validation failed: $.production.timeline.scenes: too few items"
            ),
            {"title": "확정 제목", "narration_beats": ["확정 문장"]},
        )
        self.assertIn("production.timeline.scenes는 반드시 12~20개", prompt)
        self.assertIn("확정 제목", prompt)
        self.assertIn('"$defs"', prompt)
        self.assertIn("각 확정 문장", prompt)

    def test_timeline_scene_array_shorthand_is_wrapped(self):
        value = document(["안심"])
        scenes = value["production"]["timeline"]["scenes"]
        value["production"]["timeline"] = scenes
        normalized = normalize_document_shape(value)
        self.assertEqual(scenes, normalized["production"]["timeline"]["scenes"])
        self.assertEqual(
            "timeline.scenes[-1].end",
            normalized["production"]["timeline"]["duration_source"],
        )

    def test_missing_narration_cue_fields_are_recovered_from_linked_scene(self):
        value = document(["안심"])
        value["production"]["narration_cues"] = [{
            "id": "narration-01", "start": 0, "end": 30
        }]
        normalized = normalize_document_shape(value)
        cue = normalized["production"]["narration_cues"][0]
        self.assertEqual(["scene-01"], cue["scene_ids"])
        self.assertEqual("함께 걷는 오늘", cue["narration"]["text"])
        self.assertEqual(cue["narration"], cue["caption"])
        self.assertEqual("estimated_speech_rate", cue["timing_source"])
        self.assertEqual(1.5, cue["estimated_duration_seconds"])
        self.assertIsNone(cue["measured_duration_seconds"])
        self.assertIsNone(cue["audio_uri"])

    def test_generated_timestamps_are_rebuilt_before_validation(self):
        value = document(["안심"])
        first = value["production"]["timeline"]["scenes"][0]
        first["start"], first["end"] = 17, 4
        second = json.loads(json.dumps(first, ensure_ascii=False))
        second["id"] = "scene-02"
        second["start"], second["end"] = 99, 99.1
        second["sequence"]["continuity_from"] = "scene-01"
        second["narration_cue_ids"] = ["narration-02"]
        value["production"]["timeline"]["scenes"].append(second)
        second_cue = json.loads(json.dumps(value["production"]["narration_cues"][0], ensure_ascii=False))
        second_cue["id"] = "narration-02"
        second_cue["start"], second_cue["end"] = 200, 100
        second_cue["scene_ids"] = ["scene-02"]
        value["production"]["narration_cues"].append(second_cue)

        calls = []
        result = run_generation_harness(
            lambda _prompt: calls.append(True) or json.dumps(value, ensure_ascii=False),
            ["안심"], "자료",
        )

        scenes = result["document"]["production"]["timeline"]["scenes"]
        cues = result["document"]["production"]["narration_cues"]
        self.assertEqual(1, len(calls))
        self.assertEqual(0, result["repair_count"])
        self.assertEqual(0.0, scenes[0]["start"])
        self.assertEqual(scenes[0]["end"], scenes[1]["start"])
        self.assertGreaterEqual(scenes[1]["end"] - scenes[1]["start"], 1.5)
        self.assertEqual((scenes[1]["start"], scenes[1]["end"]), (cues[1]["start"], cues[1]["end"]))

    def test_narration_cue_text_shorthand_does_not_leak_source_to_cue(self):
        value = document(["안심"])
        value["production"]["narration_cues"] = [{
            "id": "narration-01", "start": 0, "end": 30,
            "text": "함께 걷는 오늘", "source": "ai_inferred",
        }]
        cue = normalize_document_shape(value)["production"]["narration_cues"][0]
        self.assertNotIn("text", cue)
        self.assertNotIn("source", cue)
        self.assertEqual("함께 걷는 오늘", cue["narration"]["text"])
        self.assertEqual("ai_inferred", cue["narration"]["source"])

    def test_missing_postproduction_fields_get_contract_defaults(self):
        value = document(["안심"])
        value["production"]["postproduction"] = {}
        postproduction = normalize_document_shape(value)["production"]["postproduction"]
        self.assertEqual(
            {"captions", "voice", "bgm", "transitions"},
            set(postproduction),
        )
        self.assertTrue(all(item["source"] == "ai_inferred" for item in postproduction.values()))

    def test_system_owned_production_metadata_is_canonicalized(self):
        value = document(["안심"])
        production = value["production"]
        production["continuity"] = {"characters": "invalid", "extra": []}
        production["global_prompts"] = {"style": "담백한 실사", "extra": "invalid"}
        production["timing_policy"] = {"estimated_characters_per_second": 99, "extra": True}
        production["output"] = {"video_codec": "vp9", "extra": True}
        normalized = normalize_document_shape(value)["production"]
        self.assertEqual({"characters": [], "locations": [], "props": []}, normalized["continuity"])
        self.assertEqual({"style", "negative"}, set(normalized["global_prompts"]))
        self.assertEqual("담백한 실사", normalized["global_prompts"]["style"]["text"])
        self.assertEqual(4.5, normalized["timing_policy"]["estimated_characters_per_second"])
        self.assertEqual("h264", normalized["output"]["video_codec"])
        self.assertNotIn("extra", normalized["output"])

    def test_scene_shorthand_is_recovered_from_cues_and_references(self):
        value = document(["안심"])
        scene = value["production"]["timeline"]["scenes"][0]
        for key in ("title", "media_type", "source_media", "reference_ids", "characters", "narration_cue_ids"):
            scene.pop(key, None)
        scene["sequence"] = {"camera_motion": "invalid", "extra": True}
        scene = normalize_document_shape(value)["production"]["timeline"]["scenes"][0]
        self.assertEqual("장면 1", scene["title"])
        self.assertEqual("image", scene["media_type"])
        self.assertIsNone(scene["source_media"])
        self.assertEqual(["ref-character-elder", "ref-location-dining"], scene["reference_ids"])
        self.assertEqual(["narration-01"], scene["narration_cue_ids"])
        self.assertEqual("fixed", scene["sequence"]["camera_motion"])
        self.assertNotIn("extra", scene["sequence"])

    def test_location_reference_alias_is_folded_into_canonical_reference_ids(self):
        value = document(["안심"])
        scene = value["production"]["timeline"]["scenes"][0]
        scene["reference_ids"] = ["ref-character-elder"]
        scene["location_reference_id"] = "ref-location-dining"

        normalized = normalize_document_shape(value)
        scene = normalized["production"]["timeline"]["scenes"][0]

        self.assertEqual(
            ["ref-character-elder", "ref-location-dining"],
            scene["reference_ids"],
        )
        self.assertNotIn("location_reference_id", scene)

    def test_location_reference_alias_does_not_duplicate_existing_reference(self):
        value = document(["안심"])
        scene = value["production"]["timeline"]["scenes"][0]
        scene["location_reference_id"] = "ref-location-dining"

        normalized = normalize_document_shape(value)

        self.assertEqual(
            ["ref-character-elder", "ref-location-dining"],
            normalized["production"]["timeline"]["scenes"][0]["reference_ids"],
        )

    def test_concept_shorthand_is_completed_and_canonicalized(self):
        value = document(["안심"])
        value["concept_variants"] = [{"id": "draft", "extra": True}]
        value["selected_variant_id"] = "draft"
        normalized = normalize_document_shape(value)
        concept = normalized["concept_variants"][0]
        self.assertEqual("concept-01", concept["id"])
        self.assertEqual(["안심"], concept["keywords"])
        self.assertEqual("ai_inferred", concept["source"])
        self.assertNotIn("extra", concept)
        self.assertEqual("concept-01", normalized["selected_variant_id"])

    def test_locked_plan_text_wins_over_generated_narration(self):
        value = document(["안심"])
        value["project"]["title"] = "모델이 바꾼 제목"
        value["production"]["narration_cues"][0]["narration"]["text"] = "모델이 바꾼 문장"
        value["production"]["narration_cues"][0]["caption"]["text"] = "모델이 바꾼 문장"
        generated = run_generation_harness(
            lambda _prompt: json.dumps(value, ensure_ascii=False),
            ["안심"],
            "자료",
            locked_plan={"title": "확정 제목", "narration_beats": ["확정 문장"]},
        )
        result = generated["document"]
        self.assertEqual("확정 제목", result["project"]["title"])
        self.assertEqual("확정 문장", result["production"]["narration_cues"][0]["narration"]["text"])
        self.assertEqual("확정 문장", result["production"]["timeline"]["scenes"][0]["caption"]["text"])

    def test_locked_plan_rebuilds_a_different_number_of_cues(self):
        value = document(["안심"])
        generated = run_generation_harness(
            lambda _prompt: json.dumps(value, ensure_ascii=False),
            ["안심"],
            "자료",
            locked_plan={"title": "확정 제목", "narration_beats": ["첫 문장", "둘째 문장"]},
        )["document"]
        cues = generated["production"]["narration_cues"]
        scene = generated["production"]["timeline"]["scenes"][0]
        self.assertEqual(["첫 문장", "둘째 문장"], [cue["narration"]["text"] for cue in cues])
        self.assertEqual(["narration-01", "narration-02"], scene["narration_cue_ids"])
        self.assertEqual(["scene-01"], cues[1]["scene_ids"])

    def test_unknown_table_shape_gets_reference_lock_despite_unrelated_props(self):
        value = document(["안심"])
        value["production"]["continuity"] = {
            "characters": [], "locations": [],
            "props": [{"text": "다른 식당의 원형 테이블", "source": "provided"}],
        }
        scene = value["production"]["timeline"]["scenes"][0]
        scene["title"] = "상담실"
        scene["image_prompt"] = {"text": "상담실 테이블 앞 대화", "source": "ai_inferred"}
        normalize_unknown_table_reference_locks(value)
        self.assertIn("기준 레퍼런스", scene["image_prompt"]["text"])

    def test_multiple_table_shapes_are_locked_to_current_reference_without_guessing(self):
        value = document(["안심"])
        value["production"]["continuity"] = {
            "characters": [], "locations": [],
            "props": [
                {"text": "원형 테이블", "source": "provided"},
                {"text": "사각형 테이블", "source": "provided"},
            ],
        }
        scene = value["production"]["timeline"]["scenes"][0]
        scene["image_prompt"] = {"text": "테이블 곁에서 대화한다.", "source": "ai_inferred"}
        normalize_unknown_table_reference_locks(value)
        self.assertIn("현재 장소의 기준 레퍼런스", scene["image_prompt"]["text"])
        validate_visual_continuity(value)

    def test_missing_or_repeated_camera_and_motion_prompts_are_varied(self):
        value = document(["안심"])
        first = value["production"]["timeline"]["scenes"][0]
        second = json.loads(json.dumps(first, ensure_ascii=False))
        second["id"] = "scene-02"
        second["title"] = "두 번째 행동"
        second["start"], second["end"] = 30, 60
        second["sequence"]["continuity_from"] = "scene-01"
        second["camera"] = dict(first.get("camera", {}))
        second["motion_prompt"] = dict(first.get("motion_prompt", {}))
        value["production"]["timeline"]["scenes"].append(second)
        normalized = normalize_document_shape(value)
        scenes = normalized["production"]["timeline"]["scenes"]
        self.assertNotEqual(scenes[0]["camera"]["text"], scenes[1]["camera"]["text"])
        self.assertNotEqual(scenes[0]["motion_prompt"]["text"], scenes[1]["motion_prompt"]["text"])
        self.assertIn("두 번째 행동", scenes[1]["motion_prompt"]["text"])

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
        self.assertIn("`location_reference_id` 별칭 필드를 생성하지 않는다", prompt)
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
        self.assertIn("계약의 12~20 범위를 사용한다", prompt)
        self.assertIn("전체 시간 ÷ 씬 수", prompt)
        self.assertIn("각 씬의 길이를 다르게 배정", prompt)
        self.assertIn("LOCATION LATCH", prompt)
        self.assertIn("SCREEN-AXIS LOCK", prompt)
        self.assertIn("FURNITURE GEOMETRY LOCK", prompt)
        self.assertIn("한 레퍼런스 안에 서로 다른 테이블 형태가 함께 있으면", prompt)
        self.assertIn("sequence.camera_axis_transition", prompt)
        self.assertIn("LOCATION ACTIVITY POLICY", prompt)
        self.assertIn("물리치료실 장면에는 실제 물리치료·재활치료 행동만", prompt)
        self.assertIn("기타 행사와 프로그램은 로비에서만", prompt)
        self.assertIn("서로 다른 일반 장소가 2개 이상", prompt)
        self.assertIn("사용 가능한 일반 장소가 0~1개뿐이면 연결 복도를", prompt)

    def test_transition_bridge_repair_prompt_excludes_corridor_with_one_normal_location(self):
        prompt = build_repair_prompt(
            '{"production":{"timeline":{"scenes":[]}}}',
            UnifiedContentError("scene-01는 전환 전용 연결 복도를 첫 씬으로 사용할 수 없습니다"),
        )
        self.assertIn("ready인 일반 장소 수를 먼저 센다", prompt)
        self.assertIn("일반 장소가 0~1개뿐이면 연결 복도를", prompt)
        self.assertIn("project.purpose, concept_variants와 모든 씬에서 완전히 제거", prompt)

    def test_location_activity_policy_restricts_specialized_rooms(self):
        value = document(["안심"])
        scene = value["production"]["timeline"]["scenes"][0]
        value["production"]["reference_assets"][1].update(
            kind="location", uri="시설/시설_재활물리치료실.png", usage="재활물리치료실"
        )
        scene["image_prompt"]["text"] = "물리치료실에서 식판을 앞에 두고 식사한다."
        with self.assertRaisesRegex(UnifiedContentError, "물리치료실 장면"):
            validate_location_activity_policy(value)
        scene["image_prompt"]["text"] = "물리치료실에서 물리치료사와 관절 운동을 한다."
        scene["narration"]["text"] = "식사 후에도 편안한 움직임을 이어갑니다."
        validate_location_activity_policy(value)

    def test_location_activity_policy_keeps_meals_in_dining_and_events_in_lobby(self):
        value = document(["안심"])
        location = value["production"]["reference_assets"][1]
        location.update(kind="location", uri="시설/식당.png", usage="식사 공간")
        scene = value["production"]["timeline"]["scenes"][0]
        scene["image_prompt"]["text"] = "식당 테이블 앞에서 대화만 나눈다."
        with self.assertRaisesRegex(UnifiedContentError, "식사 행동만"):
            validate_location_activity_policy(value)
        scene["image_prompt"]["text"] = "식당에서 반찬과 밥을 천천히 식사한다."
        validate_location_activity_policy(value)
        location.update(uri="시설/로비.png", usage="공용 로비")
        scene["image_prompt"]["text"] = "로비에서 꽃꽂이 문화 프로그램을 함께한다."
        validate_location_activity_policy(value)
        location.update(uri="시설/옥상정원.png", usage="옥상정원")
        with self.assertRaisesRegex(UnifiedContentError, "로비 레퍼런스"):
            validate_location_activity_policy(value)

    def test_location_activity_policy_uses_configured_canonical_asset_roles(self):
        value = document(["안심"])
        location = value["production"]["reference_assets"][1]
        location.update(
            id="ref-location-asset-f14d0d07dd91b-7f15471eac8f",
            kind="location", uri="시설/hash-only.png", usage="장면 배정 전 공용 자산",
        )
        scene = value["production"]["timeline"]["scenes"][0]
        scene["reference_ids"] = ["ref-character-elder", location["id"]]
        scene["image_prompt"]["text"] = "넓은 공용 공간에서 꽃꽂이 문화 프로그램을 함께한다."
        validate_location_activity_policy(value)

    def test_transition_corridor_description_does_not_become_physical_therapy_room(self):
        value = document(["안심"])
        corridor_id = "ref-location-asset-corridor-ai-v1-d8811f672936"
        value["production"]["reference_assets"][1] = {
            "id": corridor_id,
            "kind": "location",
            "status": "ready",
            "uri": "시설/시설_연결복도_AI보완_v1.png",
            "usage_role": "transition_bridge",
            "assignment": "connector_corridor",
            "usage": "가족상담실·재활물리치료실을 참조한 장소 전환 전용 자산",
        }
        scene = value["production"]["timeline"]["scenes"][0]
        scene["reference_ids"] = ["ref-character-elder", corridor_id]
        scene["image_prompt"]["text"] = "연결 복도에서 출입구 방향으로 천천히 걷는다."
        validate_location_activity_policy(value)

    def test_explicit_location_activity_role_classifies_opaque_new_asset(self):
        value = document(["안심"])
        opaque_id = "ref-location-asset-new-opaque"
        value["production"]["reference_assets"][1] = {
            "id": opaque_id,
            "kind": "location",
            "status": "ready",
            "uri": "시설/new-opaque.png",
            "location_activity_role": "physical_therapy",
        }
        scene = value["production"]["timeline"]["scenes"][0]
        scene["reference_ids"] = ["ref-character-elder", opaque_id]
        scene["image_prompt"]["text"] = "의자에 앉아 창밖을 바라본다."
        with self.assertRaisesRegex(UnifiedContentError, "물리치료실 장면"):
            validate_location_activity_policy(value)

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
        timing_policy = {
            "planning_source": "estimated_speech_rate",
            "final_source": "tts_measured_duration",
            "estimated_characters_per_second": 5,
            "reconciliation": "retime_timeline_narration_captions_transitions_and_export",
        }
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

        for key in expected:
            self.assertNotIn(key, normalized)
            self.assertIn(key, normalized["production"])
        for key in ("reference_assets", "timeline", "narration_cues"):
            self.assertEqual(expected[key], normalized["production"][key])

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

    def test_json_schema_enforces_string_max_length(self):
        with self.assertRaisesRegex(JsonSchemaError, "string is too long"):
            validate_json_schema("열네글자제한을반드시넘기는긴문장", {"type": "string", "maxLength": 13})

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
        diagnostics = []
        valid = json.dumps(document(["안심"]), ensure_ascii=False)

        def generate(prompt):
            calls.append(prompt)
            return "not json" if len(calls) == 1 else valid

        result = run_generation_harness(
            generate, ["안심"], "자료", diagnostic_callback=diagnostics.append)
        self.assertEqual(1, result["repair_count"])
        self.assertEqual(2, len(calls))
        self.assertEqual(1, len(diagnostics))
        self.assertEqual("storyboard_candidate_validation_failed", diagnostics[0]["event"])
        self.assertEqual(64, len(diagnostics[0]["response_sha256"]))
        self.assertEqual("not json", diagnostics[0]["response_excerpt"])
        self.assertEqual("establish", result["document"]["production"]["timeline"]["scenes"][0]["sequence"]["camera_axis_transition"])

    def test_three_failed_repairs_trigger_one_fresh_generation(self):
        calls = []
        valid = json.dumps(document(["안심"]), ensure_ascii=False)

        def generate(prompt):
            calls.append(prompt)
            return valid if len(calls) == 5 else "not json"

        result = run_generation_harness(generate, ["안심"], "자료")

        self.assertEqual(5, len(calls))
        self.assertEqual(3, result["repair_count"])
        self.assertEqual(1, result["regeneration_count"])
        self.assertEqual(calls[0], calls[4], "fresh generation reuses the original request, not the broken JSON")

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

    def test_concept_keywords_are_restored_from_selected_inputs(self):
        value = document(["안심", "가족 소통", "따뜻한 관계"])
        value["concept_variants"][0]["keywords"] = []

        result = run_generation_harness(
            lambda prompt: json.dumps(value, ensure_ascii=False),
            ["안심", "가족 소통", "따뜻한 관계"], "시설 자료",
        )

        self.assertEqual(
            ["안심", "가족 소통", "따뜻한 관계"],
            result["document"]["concept_variants"][0]["keywords"],
        )
        self.assertEqual(0, result["repair_count"])

    def test_document_identity_fields_are_normalized_without_model_repair(self):
        value = document(["안심"])
        value["document_id"] = "한글 문서 ID !"
        value["selected_variant_id"] = "missing-concept"

        result = run_generation_harness(
            lambda prompt: json.dumps(value, ensure_ascii=False), ["안심"], "시설 자료",
        )

        self.assertEqual("id", result["document"]["document_id"])
        self.assertEqual("concept-01", result["document"]["selected_variant_id"])
        self.assertEqual(0, result["repair_count"])

    def test_incomplete_narration_cues_are_rebuilt_from_locked_plan(self):
        value = document(["안심"])
        value["production"]["narration_cues"] = [{
            "id": "narration-01", "scene_ids": ["scene-01"],
            "caption": {"text": "함께 걷는 오늘", "source": "provided"},
        }]
        plan = {"title": "확정 제목", "synopsis": "확정 요약", "narration_beats": ["함께 걷는 오늘"]}

        result = run_generation_harness(
            lambda prompt: json.dumps(value, ensure_ascii=False), ["안심"], "시설 자료",
            locked_plan=plan,
        )

        cue = result["document"]["production"]["narration_cues"][0]
        self.assertEqual((0, 1.5), (cue["start"], cue["end"]))
        self.assertEqual("함께 걷는 오늘", cue["narration"]["text"])
        self.assertEqual(1.5, cue["estimated_duration_seconds"])
        self.assertEqual(0, result["repair_count"])

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
        self.assertEqual(2, len(calls))
        self.assertEqual(1, result["repair_count"])
        normalized_route = result["document"]["production"]["timeline"]["scenes"][2]["sequence"]["entry_action"]
        self.assertIn("돌아오는 이동", normalized_route)

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

    def test_generation_normalizes_missing_location_return_route_without_provider_repair(self):
        value = document(["안심"])
        scenes = value["production"]["timeline"]["scenes"]
        first = json.loads(json.dumps(scenes[0])); second = json.loads(json.dumps(scenes[0])); third = json.loads(json.dumps(scenes[0]))
        first.update(id="scene-a1", reference_ids=["ref-location-roof"], sequence={"continuity_from":None,"exit_action":"정원에서 실내로 이동한다."})
        second.update(id="scene-b", reference_ids=["ref-location-room"], sequence={"continuity_from":"scene-a1","exit_action":"실내에서 머문다."})
        third.update(id="scene-a2", title="정원 산책", reference_ids=["ref-location-roof"], sequence={"continuity_from":"scene-b","entry_action":"활동을 이어간다."})
        value["production"]["reference_assets"] = [
            {"id":"ref-location-roof","kind":"location"},
            {"id":"ref-location-room","kind":"location"},
        ]
        value["production"]["timeline"]["scenes"] = [first, second, third]
        cue = value["production"]["narration_cues"][0]
        cue.update(end=90, scene_ids=["scene-a1", "scene-b", "scene-a2"])

        result = run_generation_harness(lambda prompt: json.dumps(value, ensure_ascii=False), ["안심"], "시설 자료")

        route = result["document"]["production"]["timeline"]["scenes"][2]["sequence"]["entry_action"]
        self.assertIn("돌아오는", route)
        self.assertIn("편집상 이동 시간", route)
        self.assertNotIn("문턱", route)
        self.assertEqual(0, result["repair_count"])

    def test_generation_uses_registered_corridor_for_location_return_without_doors(self):
        value = document(["안심"])
        scenes = value["production"]["timeline"]["scenes"]
        first = json.loads(json.dumps(scenes[0])); second = json.loads(json.dumps(scenes[0])); third = json.loads(json.dumps(scenes[0]))
        first.update(id="scene-a1", reference_ids=["ref-location-roof"], sequence={"continuity_from":None,"exit_action":"정원에서 실내로 이동한다."})
        second.update(id="scene-b", reference_ids=["ref-location-room"], sequence={"continuity_from":"scene-a1","exit_action":"실내에서 머문다."})
        third.update(id="scene-a2", title="정원 산책", reference_ids=["ref-location-roof"], sequence={"continuity_from":"scene-b","entry_action":"활동을 이어간다."})
        value["production"]["reference_assets"] = [
            {"id":"ref-location-roof","kind":"location"},
            {"id":"ref-location-room","kind":"location"},
            {"id":"ref-location-corridor","kind":"location","status":"ready","usage":"장소 전환용 연결 복도","aliases":["연결 복도"]},
        ]
        value["production"]["timeline"]["scenes"] = [first, second, third]
        cue = value["production"]["narration_cues"][0]
        cue.update(end=90, scene_ids=["scene-a1", "scene-b", "scene-a2"])

        result = run_generation_harness(lambda prompt: json.dumps(value, ensure_ascii=False), ["안심"], "시설 자료")

        route = result["document"]["production"]["timeline"]["scenes"][2]["sequence"]["entry_action"]
        self.assertIn("등록된 연결 복도 레퍼런스", route)
        self.assertIn("문·문손잡이·문턱은 생성하지 않는다", route)
        self.assertEqual(0, result["repair_count"])

    def test_transition_bridge_requires_one_corridor_scene_between_locations(self):
        value = document(["안심"])
        base = value["production"]["timeline"]["scenes"][0]
        scenes = []
        for index, location in enumerate(("ref-location-a", "ref-location-bridge", "ref-location-b"), 1):
            scene = json.loads(json.dumps(base))
            scene.update(id=f"scene-{index:02d}", reference_ids=[location])
            scene["sequence"] = {"continuity_from": None if index == 1 else f"scene-{index - 1:02d}"}
            scenes.append(scene)
        value["production"]["timeline"]["scenes"] = scenes
        value["production"]["reference_assets"] = [
            {"id":"ref-location-a","kind":"location"},
            {"id":"ref-location-bridge","kind":"location"},
            {"id":"ref-location-b","kind":"location"},
        ]
        catalog = {
            "ref-location-a":{"id":"ref-location-a","kind":"location","status":"ready"},
            "ref-location-bridge":{"id":"ref-location-bridge","kind":"location","status":"ready","usage_role":"transition_bridge"},
            "ref-location-b":{"id":"ref-location-b","kind":"location","status":"ready"},
        }

        validate_transition_bridge_routes(value, catalog)

    def test_transition_bridge_rejects_direct_location_jump_using_server_catalog(self):
        value = document(["안심"])
        first = value["production"]["timeline"]["scenes"][0]
        second = json.loads(json.dumps(first))
        first.update(id="scene-01", reference_ids=["ref-location-a"])
        second.update(id="scene-02", reference_ids=["ref-location-b"],
                      sequence={"continuity_from":"scene-01"})
        value["production"]["timeline"]["scenes"] = [first, second]
        value["production"]["reference_assets"] = [
            {"id":"ref-location-a","kind":"location"},
            {"id":"ref-location-b","kind":"location"},
        ]
        catalog = {
            "ref-location-a":{"id":"ref-location-a","kind":"location","status":"ready"},
            "ref-location-bridge":{"id":"ref-location-bridge","kind":"location","status":"ready","usage_role":"transition_bridge"},
            "ref-location-b":{"id":"ref-location-b","kind":"location","status":"ready"},
        }

        with self.assertRaisesRegex(UnifiedContentError, "장소가 직접 바뀌었습니다"):
            validate_transition_bridge_routes(value, catalog)

    def test_transition_bridge_rejects_first_last_and_same_destination(self):
        catalog = {
            "ref-location-a":{"id":"ref-location-a","kind":"location","status":"ready"},
            "ref-location-bridge":{"id":"ref-location-bridge","kind":"location","status":"ready","assignment":"connector_corridor"},
            "ref-location-b":{"id":"ref-location-b","kind":"location","status":"ready"},
        }

        def value_for(*locations):
            value = document(["안심"])
            base = value["production"]["timeline"]["scenes"][0]
            scenes = []
            for index, location in enumerate(locations, 1):
                scene = json.loads(json.dumps(base))
                scene.update(id=f"scene-{index:02d}", reference_ids=[location])
                scene["sequence"] = {"continuity_from": None if index == 1 else f"scene-{index - 1:02d}"}
                scenes.append(scene)
            value["production"]["timeline"]["scenes"] = scenes
            value["production"]["reference_assets"] = [
                {"id":reference_id,"kind":"location"} for reference_id in set(locations)
            ]
            return value

        with self.assertRaisesRegex(UnifiedContentError, "첫 씬"):
            validate_transition_bridge_routes(value_for("ref-location-bridge", "ref-location-b"), catalog)
        with self.assertRaisesRegex(UnifiedContentError, "끝낼 수 없습니다"):
            validate_transition_bridge_routes(value_for("ref-location-a", "ref-location-bridge"), catalog)
        validate_transition_bridge_routes(value_for(
            "ref-location-a", "ref-location-bridge", "ref-location-bridge", "ref-location-b"
        ), catalog)
        validate_transition_bridge_routes(value_for(
            "ref-location-a", "ref-location-bridge", "ref-location-bridge",
            "ref-location-bridge", "ref-location-b"
        ), catalog)
        with self.assertRaisesRegex(UnifiedContentError, "서로 다른"):
            validate_transition_bridge_routes(value_for(
                "ref-location-a", "ref-location-bridge", "ref-location-a"
            ), catalog)

    def test_direct_location_edit_is_allowed_without_registered_transition_bridge(self):
        value = document(["안심"])
        first = value["production"]["timeline"]["scenes"][0]
        second = json.loads(json.dumps(first))
        first["reference_ids"] = ["ref-location-a"]
        second.update(id="scene-02", reference_ids=["ref-location-b"],
                      sequence={"continuity_from":"scene-01"})
        value["production"]["timeline"]["scenes"] = [first, second]
        value["production"]["reference_assets"] = [
            {"id":"ref-location-a","kind":"location"},
            {"id":"ref-location-b","kind":"location"},
        ]

        validate_transition_bridge_routes(value)

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
