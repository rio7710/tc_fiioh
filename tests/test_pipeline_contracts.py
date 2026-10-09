import importlib.util
import json
import re
import sys
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
HTML_PATH = ROOT / "01_app" / "P1_title_design_preview.html"
MANIFEST_PATH = ROOT / "01_app" / "data" / "pipeline_manifest.json"
DEMO_DATA_PATH = ROOT / "01_app" / "data" / "demo_data.json"


def load_render_server():
    module_path = ROOT / "01_app" / "render_server.py"
    spec = importlib.util.spec_from_file_location("greenhill_render_server", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class PipelineContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        step4_html = (ROOT / "01_app" / "pages" / "steps" / "step04-video.html").read_text(encoding="utf-8")
        step4_js = (ROOT / "01_app" / "assets" / "steps" / "step04" / "step04-video.js").read_text(encoding="utf-8")
        cls.render_controller = (ROOT / "01_app" / "assets" / "steps" / "step04" / "step04-render-controller.js").read_text(encoding="utf-8")
        cls.session_bootstrap_controller = (ROOT / "01_app" / "assets" / "core" / "session-bootstrap-controller.js").read_text(encoding="utf-8")
        cls.script_editor_controller = (ROOT / "01_app" / "assets" / "steps" / "step03" / "step03-script-editor-controller.js").read_text(encoding="utf-8")
        cls.production_workflow_controller = (ROOT / "01_app" / "assets" / "steps" / "step03" / "production-workflow-controller.js").read_text(encoding="utf-8")
        cls.scene_video_controller = (ROOT / "01_app" / "assets" / "steps" / "step03" / "scene-video-controller.js").read_text(encoding="utf-8")
        cls.scene_image_controller = (ROOT / "01_app" / "assets" / "steps" / "step03" / "scene-image-controller.js").read_text(encoding="utf-8")
        cls.candidate_selection_controller = (ROOT / "01_app" / "assets" / "steps" / "step03" / "candidate-selection-controller.js").read_text(encoding="utf-8")
        cls.scene_voice_controller = (ROOT / "01_app" / "assets" / "steps" / "step03" / "scene-voice-controller.js").read_text(encoding="utf-8")
        cls.voice_profile_controller = (ROOT / "01_app" / "assets" / "steps" / "step03" / "voice-profile-controller.js").read_text(encoding="utf-8")
        cls.storyboard_grid_renderer = (ROOT / "01_app" / "assets" / "steps" / "step03" / "storyboard-grid-renderer.js").read_text(encoding="utf-8")
        cls.image_regeneration_controller = (ROOT / "01_app" / "assets" / "steps" / "step04" / "step04-image-regeneration-controller.js").read_text(encoding="utf-8")
        step5_html = (ROOT / "01_app" / "pages" / "steps" / "step05-calendar.html").read_text(encoding="utf-8")
        step5_css = (ROOT / "01_app" / "assets" / "steps" / "step05" / "step05-calendar.css").read_text(encoding="utf-8")
        cls.shell = HTML_PATH.read_text(encoding="utf-8")
        cls.html = "\n".join((cls.shell, step4_html, step4_js, step5_html, step5_css))
        cls.manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        cls.demo_data = json.loads(DEMO_DATA_PATH.read_text(encoding="utf-8"))
        cls.server = load_render_server()

    def test_scene_timeline_is_contiguous_and_data_driven(self):
        scenes = self.server.timeline_from_data(self.demo_data)
        self.assertAlmostEqual(0.0, scenes[0]["start"])
        for previous, current in zip(scenes, scenes[1:]):
            self.assertAlmostEqual(previous["end"], current["start"], msg=f"gap between {previous['id']} and {current['id']}")
        self.assertEqual("timeline.scenes[-1].end", self.manifest["project_clock"]["duration_source"])
        self.assertTrue(all(scene["media_type"] in {"image", "video"} for scene in scenes))

    def test_title_and_narration_contracts_match(self):
        timed_scenes = self.server.timed_script_scenes(self.demo_data)
        script_lines = self.demo_data["state"]["script"]["lines"]
        self.assertEqual(len(script_lines), len(timed_scenes))
        self.assertEqual(len(self.server.NARRATION_TRACKS), len(timed_scenes))
        self.assertEqual(list(range(len(timed_scenes))), [scene["script_line_index"] for scene in timed_scenes])

    def test_render_assets_exist(self):
        self.assertTrue((ROOT / "02_media" / "video" / "P1_merged.mp4").is_file())
        scene_dir = ROOT / "02_media" / "images" / "scenes"
        for index in range(1, 15):
            self.assertTrue((scene_dir / f"scene_{index:02d}.webp").is_file())
        dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn("COPY 02_media/images/scenes/scene_*.webp", dockerfile)
        for path in self.server.MUSIC.values():
            if path is not None:
                self.assertTrue(path.is_file(), path)
        for _, filename in self.server.NARRATION_TRACKS:
            self.assertTrue((ROOT / "02_media" / "narration" / filename).is_file(), filename)

    def test_final_composite_accepts_scene_artifacts(self):
        scene = {"id": "scene-01"}
        artifact = {"scene-01": {"uri": "02_media/video/P1_merged.mp4"}}
        resolved = self.server.scene_video_path(scene, 0, artifact)
        self.assertEqual((ROOT / "02_media" / "video" / "P1_merged.mp4").resolve(), resolved)
        with self.assertRaisesRegex(ValueError, "원격 영상"):
            self.server.scene_video_path(scene, 0, {"scene-01": {"uri": "https://object.example/scene-01.mp4"}})
        with mock.patch.object(self.server, "SOURCE_CLIPS", ROOT / "missing-scene-clips"):
            self.assertEqual(self.server.MERGED_DEMO_VIDEO.resolve(), self.server.scene_video_path(scene, 0))

    def test_platforms_share_matching_output_formats(self):
        groups = self.server.group_platform_formats([
            "youtube", "instagram", "facebook", "tiktok", "naver", "kakaotalk", "threads", "x", "linkedin"
        ])
        self.assertEqual(3, len(groups))
        self.assertEqual(["youtube", "naver", "kakaotalk", "x"], groups[0]["platforms"])
        self.assertEqual(["instagram", "tiktok", "threads"], groups[1]["platforms"])
        self.assertEqual(["facebook", "linkedin"], groups[2]["platforms"])

    def test_composite_rejects_missing_caption_pngs(self):
        with self.assertRaisesRegex(ValueError, "모두 준비되지 않았습니다"):
            self.server.validate_caption_overlays({}, 1)

    def test_timeline_and_calendar_rules_are_not_hardcoded_in_ui(self):
        render_workflow = self.html + "\n" + self.render_controller
        self.assertIn("applyTimeline(demoData.timeline)", self.html)
        self.assertNotRegex(self.html, r"const scenes\s*=\s*\[")
        self.assertNotRegex(self.html, r"\{start:[0-9.]*,end:[0-9.]*,rate:")
        # Identity is project + local date + platform, never a mutable title.
        self.assertIn("item.start===start&&item.extendedProps?.projectId===activeProjectId&&item.extendedProps?.platform===platform", self.html)
        self.assertNotIn("item.start===start&&item.title===title&&item.extendedProps?.platform===platform", self.html)
        self.assertIn("const unique=new Map()", self.html)
        self.assertIn('id="calendarContentView"', self.html)
        self.assertIn('id="contentUnavailableModal"', self.html)
        self.assertIn("연결된 콘텐츠가 없습니다.", self.html)
        self.assertIn("recordCurrentProduction(result)", render_workflow)
        self.assertIn("renderCalendar({preserveScroll:true})", self.html)
        self.assertIn("overflow-anchor:none", self.html)
        self.assertIn("applySceneProgressEvent", self.html)
        self.assertIn("runDemoSceneProgress", self.html)
        self.assertIn("장면별 이미지 생성 상태", self.production_workflow_controller)
        self.assertNotIn("장면별 이미지 생성 상태", self.shell)
        self.assertIn("const sceneId=card.dataset.scene", self.scene_voice_controller)
        self.assertNotIn("const sceneId=card.dataset.scene", self.shell)
        self.assertIn(".storyboard-video-status", self.html)
        self.assertIn("async function poll(card,taskId", self.scene_video_controller)
        self.assertNotIn("/api/storyboard/video-status?task_id=", self.shell)
        self.assertIn("/api/storyboard/image-generate", self.scene_image_controller)
        self.assertNotIn("/api/storyboard/image-generate", self.shell)
        self.assertIn("/api/storyboard/image-select", self.candidate_selection_controller)
        self.assertIn("/api/storyboard/video-select", self.candidate_selection_controller)
        self.assertNotIn("/api/storyboard/image-select", self.shell)
        self.assertNotIn("/api/storyboard/video-select", self.shell)
        self.assertIn("/api/voice/generate-scene", self.scene_voice_controller)
        self.assertNotIn("/api/voice/generate-scene", self.shell)
        self.assertIn("/api/voice/select", self.voice_profile_controller)
        self.assertIn("/api/voice/sample?profile=", self.voice_profile_controller)
        self.assertIn("return voiceProfileController.preview(button)", self.shell)
        self.assertIn("production.timeline?.scenes", self.storyboard_grid_renderer)
        self.assertIn("return storyboardGridRenderer.render()", self.shell)
        self.assertNotIn("const storyboardScenes=", self.shell)
        self.assertIn("/api/image/regenerate", self.image_regeneration_controller)
        self.assertIn("additional_prompt: additionalPrompt", self.image_regeneration_controller)
        self.assertNotIn("const additionalPrompt=imageAdditionalPrompt.value.trim()", self.shell)
        self.assertIn("장면별 최종 영상 합성 상태", render_workflow)
        self.assertIn("applySequentialSceneProgress", self.html)
        self.assertIn("selectedOutputFormatGroups", self.html)
        self.assertIn("setupCompositeFormatBadges", self.html)
        self.assertIn("applyCompositeFormatProgress", self.html)
        self.assertIn("composite-platform-badge", self.html)
        self.assertNotIn("{name:'배포 규격 최적화'", self.html)
        self.assertIn("scenes.map(scene=>scene.id)", self.html)
        self.assertIn("const sceneLabel = `S#${String(sceneIndex + 1).padStart(2, '0')}`", self.script_editor_controller)
        self.assertNotIn("const sceneLabel", self.shell)

    def test_composite_format_success_activates_only_selected_platform_icons(self):
        self.assertIn("[...selectedPlatforms].forEach(platform=>", self.html)
        self.assertIn("groups.find(item=>item.label===label)", self.html)
        self.assertIn("group.platforms.push(platform)", self.html)
        self.assertIn("group.platforms.map(platform=>`<span class=\"composite-platform-badge\"", self.html)
        self.assertIn('.composite-platform-badge[data-status="running"] .calendar-platform::before,.composite-platform-badge[data-status="succeeded"] .calendar-platform::before{background:var(--calendar-brand,#333)}', self.html)
        self.assertIn("completeAll||formatIndex<currentIndex-1?'succeeded'", self.html)

    def test_worker_manifest_is_a_valid_dag(self):
        workers = self.manifest["workers"]
        worker_ids = [worker["id"] for worker in workers]
        self.assertEqual(len(worker_ids), len(set(worker_ids)))
        known = set(worker_ids)
        for worker in workers:
            self.assertTrue(set(worker["depends_on"]) <= known, worker["id"])

        visiting = set()
        visited = set()
        graph = {worker["id"]: worker["depends_on"] for worker in workers}

        def visit(worker_id):
            self.assertNotIn(worker_id, visiting, f"cycle at {worker_id}")
            if worker_id in visited:
                return
            visiting.add(worker_id)
            for dependency in graph[worker_id]:
                visit(dependency)
            visiting.remove(worker_id)
            visited.add(worker_id)

        for worker_id in worker_ids:
            visit(worker_id)

    def test_phase_worker_references_are_complete(self):
        worker_ids = {worker["id"] for worker in self.manifest["workers"]}
        phase_ids = [worker_id for phase in self.manifest["phases"] for worker_id in phase["workers"]]
        self.assertEqual(worker_ids, set(phase_ids))
        self.assertEqual(len(phase_ids), len(set(phase_ids)))

    def test_image_regeneration_preserves_base_and_gates_video(self):
        workers = {worker["id"]: worker for worker in self.manifest["workers"]}
        regeneration = workers["scene_image_regeneration"]
        self.assertEqual("manual", regeneration["trigger"])
        self.assertIn("base_prompt_ref", regeneration["input"])
        self.assertIn("additional_prompt", regeneration["input"])
        self.assertIn("preserve_existing", regeneration["input"])
        self.assertEqual(["scene_image_approval"], workers["image_to_video"]["depends_on"])

        phases = {phase["id"]: phase["workers"] for phase in self.manifest["phases"]}
        self.assertIn("scene_image_approval", phases["production"])
        self.assertIn("image_to_video", phases["export"])
        self.assertNotIn("image_to_video", phases["production"])

    def test_session_cookie_contract(self):
        self.assertIn("deps.request('/api/session')", self.session_bootstrap_controller)
        # Exercise the actual endpoint without a live server or production DB.
        handler = object.__new__(self.server.Handler)
        handler.path = '/api/session'
        handler.send_json = mock.Mock()
        handler.current_user = mock.Mock(return_value=None)
        with mock.patch.object(self.server, 'sync_default_group_resources') as sync:
            handler.do_GET()
            handler.send_json.assert_called_once_with(200, {
                'ok': True, 'authenticated': False, 'user': None, 'group': None})
            sync.assert_not_called()
        user = {'user_id': 'test-user'}
        handler.current_user.return_value = user
        handler.send_json.reset_mock()
        with mock.patch.object(self.server, 'sync_default_group_resources', return_value={'group_id': 'test-group'}) as sync:
            handler.do_GET()
            self.assertTrue(handler.send_json.call_args.args[1]['authenticated'])
            self.assertEqual(handler.send_json.call_args.args[1]['user'], user)
            sync.assert_called_once_with('test-user')
        handler.path = '/api/projects'
        handler.current_user.return_value = None
        handler.send_json.reset_mock()
        handler.do_GET()
        self.assertEqual(401, handler.send_json.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
