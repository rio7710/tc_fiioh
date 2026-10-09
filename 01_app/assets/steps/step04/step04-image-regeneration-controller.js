(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Step04ImageRegenerationController = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const required = [
    'getRoot', 'request', 'sleep', 'now', 'getActiveProjectId', 'getScenes',
    'getCurrentScene', 'getImageCandidates', 'getRegenerationRequests',
    'setDemoState', 'getMainVideo', 'getBody', 'onError'
  ];
  const selectors = Object.freeze({
    modal: '#imageRegenerationModal', title: '#imageRegenerationTitle',
    sceneNo: '#imageRegenerationSceneNo', baseGuide: '#imageBaseGuide',
    prompt: '#imageAdditionalPrompt', feedback: '#imageRegenerationFeedback',
    create: '#imageRegenerationCreate', regenerate: '#imageRegenerateBtn',
    variantCount: '#imageVariantCount', stage: '#stage',
    mosaic: '#imageGenerationMosaic', status: '#imageGenerationStatus',
    statusText: '#imageGenerationStatusText'
  });

  function create(dependencies) {
    const deps = dependencies || {};
    required.forEach(name => {
      if (typeof deps[name] !== 'function') throw new TypeError(`Step04ImageRegenerationController requires ${name}`);
    });
    let invocation = 0;
    const sceneIdentities = new WeakMap();
    let nextSceneIdentity = 1;
    const inFlight = new Map();

    function nodes() {
      const rootNode = deps.getRoot();
      if (!rootNode || typeof rootNode.querySelector !== 'function') throw new TypeError('Step04ImageRegenerationController requires a DOM root');
      const found = {};
      Object.entries(selectors).forEach(([name, selector]) => {
        found[name] = rootNode.querySelector(selector);
        if (!found[name]) throw new Error(`Step04ImageRegenerationController missing ${selector}`);
      });
      found.video = deps.getMainVideo();
      if (!found.video || typeof found.video.pause !== 'function') throw new Error('Step04ImageRegenerationController missing #video');
      found.body = deps.getBody();
      if (!found.body || !found.body.classList) throw new Error('Step04ImageRegenerationController missing document body');
      return found;
    }

    function sceneSnapshot() {
      const scenes = deps.getScenes();
      if (!Array.isArray(scenes)) throw new TypeError('Step04ImageRegenerationController requires scenes array');
      const sceneIndex = Number(deps.getCurrentScene());
      if (!Number.isInteger(sceneIndex) || sceneIndex < 0 || sceneIndex >= scenes.length) throw new RangeError('유효한 장면을 선택해 주세요.');
      const scene = scenes[sceneIndex];
      if (!scene || !scene.id) throw new Error('선택한 장면 정보를 찾을 수 없습니다.');
      return { scenes, sceneIndex, scene };
    }

    function requestsForScene(sceneIndex) {
      const requests = deps.getRegenerationRequests();
      if (!Array.isArray(requests)) throw new TypeError('Step04ImageRegenerationController requires regeneration requests array');
      return requests.filter(item => Number(item.scene_index) === sceneIndex);
    }

    function baseGuide(scene) {
      if (!scene) throw new TypeError('Step04ImageRegenerationController requires scene');
      const narration = scene.text
        ? ` 내레이션 “${String(scene.text).replace(/\n/g, ' ')}”의 의미와 감정 흐름을 반영합니다.`
        : ' 타이틀이 없는 연결 장면의 자연스러운 흐름을 유지합니다.';
      return `“${scene.name}” 장면의 기존 캐릭터, 공간, 구도, 조명과 그린힐의 따뜻하고 안정적인 브랜드 톤을 변경하지 않습니다.${narration}`;
    }

    function updateVariantCount() {
      const ui = nodes();
      const { sceneIndex, scene } = sceneSnapshot();
      const candidatesMap = deps.getImageCandidates();
      if (!candidatesMap || typeof candidatesMap.get !== 'function') throw new TypeError('Step04ImageRegenerationController requires image candidates Map');
      const candidates = candidatesMap.get(scene.id) || [];
      if (!Array.isArray(candidates)) throw new TypeError('Step04ImageRegenerationController requires scene candidates array');
      if (candidates.length) {
        const selectedIndex = Math.max(0, candidates.findIndex(item => item.uri === scene.image));
        ui.variantCount.textContent = `후보 ${selectedIndex + 1} / ${candidates.length}`;
        return;
      }
      const requests = requestsForScene(sceneIndex).length;
      ui.variantCount.textContent = requests ? `후보 1 + 요청 ${requests}` : '후보 1';
    }

    function open() {
      const ui = nodes();
      const { sceneIndex, scene } = sceneSnapshot();
      try { ui.video.pause(); } catch (error) { deps.onError('pause', error); }
      ui.sceneNo.textContent = `SCENE ${String(sceneIndex + 1).padStart(2, '0')} · IMAGE VARIATION`;
      ui.title.textContent = `${scene.name} · 후보 추가`;
      ui.baseGuide.textContent = baseGuide(scene);
      ui.prompt.value = '';
      ui.feedback.textContent = '';
      ui.modal.dataset.sceneIndex = String(sceneIndex);
      ui.modal.hidden = false;
      ui.body.classList.add('modal-open');
      ui.prompt.focus();
    }

    function close(resetCreate = true) {
      const ui = nodes();
      ui.modal.hidden = true;
      if (resetCreate) ui.create.disabled = false;
      ui.body.classList.remove('modal-open');
    }

    function identityFor(scenes) {
      if (!sceneIdentities.has(scenes)) sceneIdentities.set(scenes, nextSceneIdentity++);
      return sceneIdentities.get(scenes);
    }

    function request() {
      const ui = nodes();
      const additionalPrompt = String(ui.prompt.value || '').trim();
      if (!additionalPrompt) {
        ui.feedback.textContent = '추가하고 싶은 내용을 입력해 주세요.';
        ui.prompt.focus();
        return;
      }
      const projectId = deps.getActiveProjectId();
      if (!projectId) throw new Error('콘텐츠 프로젝트를 먼저 열어 주세요.');
      const snapshot = sceneSnapshot();
      const modalIndex = Number(ui.modal.dataset.sceneIndex || 0);
      if (!Number.isInteger(modalIndex) || modalIndex !== snapshot.sceneIndex) throw new RangeError('선택한 장면이 변경되었습니다.');
      const key = `${projectId}:${identityFor(snapshot.scenes)}:${modalIndex}:${additionalPrompt}`;
      if (inFlight.has(key)) return inFlight.get(key);
      const token = ++invocation;
      const current = () => token === invocation && deps.getActiveProjectId() === projectId && deps.getScenes() === snapshot.scenes;
      const task = (async () => {
        ui.create.disabled = true;
        ui.feedback.textContent = '';
        close(false);
        ui.regenerate.disabled = true;
        ui.variantCount.textContent = '새 후보 생성 중…';
        ui.stage.classList.add('is-image-generating');
        ui.mosaic.classList.remove('is-complete');
        ui.mosaic.hidden = false;
        ui.status.classList.remove('is-complete');
        ui.statusText.textContent = '생성 중입니다.';
        ui.status.hidden = false;
        const startedAt = deps.now();
        try {
          const result = await deps.request('/api/image/regenerate', {method: 'POST', body: JSON.stringify({scene_index: modalIndex, additional_prompt: additionalPrompt, preserve_existing: true})});
          await deps.sleep(Math.max(0, 1600 - (deps.now() - startedAt)));
          if (!current()) return;
          deps.setDemoState(result.state);
          ui.prompt.value = '';
          updateVariantCount();
          ui.mosaic.classList.add('is-complete');
          ui.status.classList.add('is-complete');
          ui.statusText.textContent = '생성이 완료되었습니다.';
          ui.stage.classList.remove('is-image-generating');
          await deps.sleep(1000);
          if (!current()) return;
          ui.mosaic.hidden = true;
          ui.status.hidden = true;
        } catch (error) {
          if (!current()) return;
          ui.mosaic.hidden = true;
          ui.status.hidden = true;
          ui.stage.classList.remove('is-image-generating');
          ui.feedback.textContent = error.message;
          ui.modal.hidden = false;
          ui.body.classList.add('modal-open');
          ui.prompt.focus();
          deps.onError('request', error);
        } finally {
          if (current()) {
            ui.create.disabled = false;
            ui.regenerate.disabled = false;
            if (ui.modal.hidden) updateVariantCount();
          }
          inFlight.delete(key);
        }
      })();
      inFlight.set(key, task);
      return task;
    }

    return Object.freeze({requestsForScene, updateVariantCount, baseGuide, open, close, request});
  }

  return Object.freeze({create});
}));
