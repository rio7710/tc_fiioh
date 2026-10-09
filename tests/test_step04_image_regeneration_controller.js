const assert = require('node:assert/strict');
const Controller = require('../01_app/assets/steps/step04/step04-image-regeneration-controller.js');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
function classList() {
  const values = new Set();
  return {add: value => values.add(value), remove: value => values.delete(value), contains: value => values.has(value)};
}
function harness(overrides = {}) {
  const ids = ['imageRegenerationModal', 'imageRegenerationTitle', 'imageRegenerationSceneNo', 'imageBaseGuide', 'imageAdditionalPrompt', 'imageRegenerationFeedback', 'imageRegenerationCreate', 'imageRegenerateBtn', 'imageVariantCount', 'stage', 'imageGenerationMosaic', 'imageGenerationStatus', 'imageGenerationStatusText'];
  const elements = Object.fromEntries(ids.map(id => [id, {id, hidden: false, disabled: false, value: '', textContent: '', dataset: {}, classList: classList(), focusCount: 0, focus() { this.focusCount += 1; }}]));
  const body = {classList: classList()};
  const video = {pauseCount: 0, pause() { this.pauseCount += 1; }};
  const root = {querySelector(selector) { return elements[selector.slice(1)] || null; }};
  let projectId = overrides.projectId === undefined ? 'p1' : overrides.projectId;
  let currentScene = overrides.currentScene === undefined ? 0 : overrides.currentScene;
  let scenes = overrides.scenes || [{id: 's1', name: '첫 장면', text: '첫째\n내레이션', image: '/selected.png'}];
  let candidates = overrides.candidates || new Map();
  let requests = overrides.requests || [];
  const calls = [], states = [], errors = [];
  const deps = {
    getRoot: () => root,
    request: overrides.request || (async (...args) => { calls.push(['request', ...args]); return {state: {done: true}}; }),
    sleep: overrides.sleep || (async ms => { calls.push(['sleep', ms]); }),
    now: overrides.now || (() => 100),
    getActiveProjectId: () => projectId,
    getScenes: () => scenes,
    getCurrentScene: () => currentScene,
    getImageCandidates: () => candidates,
    getRegenerationRequests: () => requests,
    setDemoState: state => { calls.push(['state', state]); states.push(state); },
    getMainVideo: () => video,
    getBody: () => body,
    onError: (feature, error) => { calls.push(['error', feature]); errors.push([feature, error]); }
  };
  return {controller: Controller.create(deps), deps, root, elements, body, video, calls, states, errors,
    setProject: value => { projectId = value; }, setScenes: value => { scenes = value; }, setCurrentScene: value => { currentScene = value; }, setCandidates: value => { candidates = value; }, setRequests: value => { requests = value; }};
}

(async () => {
  const valid = harness().deps;
  assert.equal(Object.isFrozen(Controller), true);
  assert.equal(Object.isFrozen(Controller.create(valid)), true);
  for (const name of ['getRoot', 'request', 'sleep', 'now', 'getActiveProjectId', 'getScenes', 'getCurrentScene', 'getImageCandidates', 'getRegenerationRequests', 'setDemoState', 'getMainVideo', 'getBody', 'onError']) {
    const copy = {...valid}; delete copy[name];
    assert.throws(() => Controller.create(copy), new RegExp(`requires ${name}`));
  }
  let h = harness();
  h.root.querySelector = () => null;
  assert.throws(() => h.controller.open(), /missing #imageRegenerationModal/);
  h = harness(); h.deps.getMainVideo = () => null;
  assert.throws(() => Controller.create(h.deps).open(), /missing #video/);

  h = harness();
  assert.match(h.controller.baseGuide({name: 'A', text: '줄1\n줄2'}), /내레이션 “줄1 줄2”/);
  assert.match(h.controller.baseGuide({name: 'B', text: ''}), /타이틀이 없는 연결 장면/);
  h.controller.open();
  assert.equal(h.video.pauseCount, 1);
  assert.equal(h.elements.imageRegenerationSceneNo.textContent, 'SCENE 01 · IMAGE VARIATION');
  assert.equal(h.elements.imageRegenerationTitle.textContent, '첫 장면 · 후보 추가');
  assert.equal(h.elements.imageRegenerationModal.hidden, false);
  assert.equal(h.body.classList.contains('modal-open'), true);
  assert.equal(h.elements.imageAdditionalPrompt.focusCount, 1);
  h.controller.close();
  assert.equal(h.elements.imageRegenerationModal.hidden, true);
  assert.equal(h.body.classList.contains('modal-open'), false);

  h = harness({candidates: new Map([['s1', [{uri: '/other.png'}, {uri: '/selected.png'}]]])});
  h.controller.updateVariantCount();
  assert.equal(h.elements.imageVariantCount.textContent, '후보 2 / 2');
  h.setCandidates(new Map()); h.setRequests([{scene_index: 0}, {scene_index: '0'}, {scene_index: 1}]);
  h.controller.updateVariantCount();
  assert.equal(h.elements.imageVariantCount.textContent, '후보 1 + 요청 2');

  h = harness();
  h.elements.imageAdditionalPrompt.value = '   ';
  assert.equal(h.controller.request(), undefined);
  assert.equal(h.elements.imageRegenerationFeedback.textContent, '추가하고 싶은 내용을 입력해 주세요.');
  assert.equal(h.elements.imageAdditionalPrompt.focusCount, 1);
  h = harness({projectId: null});
  h.elements.imageAdditionalPrompt.value = '프로젝트 없음';
  assert.throws(() => h.controller.request(), /콘텐츠 프로젝트를 먼저/);
  h = harness({currentScene: -1});
  assert.throws(() => h.controller.open(), /유효한 장면/);

  let ticks = [100, 600];
  h = harness({now: () => ticks.shift(), candidates: new Map([['s1', [{uri: '/selected.png'}]]])});
  h.elements.imageRegenerationModal.dataset.sceneIndex = '0';
  h.elements.imageAdditionalPrompt.value = '표정을 밝게';
  await h.controller.request();
  const requestCall = h.calls.find(item => item[0] === 'request');
  assert.equal(requestCall[1], '/api/image/regenerate');
  assert.deepEqual(JSON.parse(requestCall[2].body), {scene_index: 0, additional_prompt: '표정을 밝게', preserve_existing: true});
  assert.deepEqual(h.calls.filter(item => item[0] === 'sleep').map(item => item[1]), [1100, 1000]);
  assert.deepEqual(h.states, [{done: true}]);
  assert.equal(h.elements.imageGenerationStatusText.textContent, '생성이 완료되었습니다.');
  assert.equal(h.elements.imageGenerationMosaic.hidden, true);
  assert.equal(h.elements.imageGenerationStatus.hidden, true);
  assert.equal(h.elements.imageRegenerationCreate.disabled, false);
  assert.equal(h.elements.imageRegenerateBtn.disabled, false);

  const api = deferred(); let apiCalls = 0;
  h = harness({request: () => { apiCalls += 1; return api.promise; }, sleep: async () => {}});
  h.elements.imageRegenerationModal.dataset.sceneIndex = '0'; h.elements.imageAdditionalPrompt.value = '동일 요청';
  const first = h.controller.request(), second = h.controller.request();
  assert.equal(first, second); assert.equal(apiCalls, 1);
  api.resolve({state: {deduped: true}}); await first;

  const failed = new Error('생성 실패');
  h = harness({request: async () => { throw failed; }});
  h.elements.imageRegenerationModal.dataset.sceneIndex = '0'; h.elements.imageAdditionalPrompt.value = '실패 요청';
  await h.controller.request();
  assert.equal(h.elements.imageRegenerationModal.hidden, false);
  assert.equal(h.elements.imageRegenerationFeedback.textContent, '생성 실패');
  assert.equal(h.errors[0][0], 'request');
  assert.equal(h.elements.imageRegenerationCreate.disabled, false);

  h = harness(); h.video.pause = () => { throw new Error('pause failed'); };
  assert.doesNotThrow(() => h.controller.open());
  assert.equal(h.errors[0][0], 'pause');

  const late = deferred();
  h = harness({request: () => late.promise, sleep: async () => {}});
  h.elements.imageRegenerationModal.dataset.sceneIndex = '0'; h.elements.imageAdditionalPrompt.value = '늦은 요청';
  const lateTask = h.controller.request();
  h.setProject('p2'); h.setScenes([{id: 'b', name: 'B'}]); h.setProject('p1');
  late.resolve({state: {stale: true}}); await lateTask;
  assert.deepEqual(h.states, []);
  assert.equal(h.elements.imageGenerationStatusText.textContent, '생성 중입니다.');

  console.log('Step04 image regeneration controller tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
