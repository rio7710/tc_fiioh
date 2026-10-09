const assert = require('node:assert/strict');
const Route = require('../01_app/assets/core/content-route.js');
const Navigation = require('../01_app/assets/core/shell-navigation-controller.js');

(async () => {
  let href = 'https://tc.test/app.html?project_id=A#index';
  const location = {}; Object.defineProperty(location, 'href', {get: () => href});
  const historyCalls = [];
  const history = {pushState(_s, _t, next) { historyCalls.push(['push', next]); href = next; }, replaceState(_s, _t, next) { historyCalls.push(['replace', next]); href = next; }};
  const windowListeners = new Map();
  const fakeWindow = {addEventListener(type, fn) { windowListeners.set(type, fn); }, removeEventListener(type, fn) { if (windowListeners.get(type) === fn) windowListeners.delete(type); }};
  const rootListeners = new Map();
  const topListeners = new Map();
  const views = ['stepIndex', 'stepProject', 'step1', 'step2', 'step3', 'step31', 'step4', 'step5'].map(id => ({id, hidden: true}));
  const messages = {'#keywordMessage': {textContent: ''}, '#storyboardMessage': {textContent: ''}, '#projectDetailNote': {textContent: ''}, '#contentIndexMessage': {textContent: ''}};
  const topNav = {active: '', setActive(value) { this.active = value; }, addEventListener(type, fn) { topListeners.set(type, fn); }, removeEventListener(type, fn) { if (topListeners.get(type) === fn) topListeners.delete(type); }};
  const root = {
    querySelectorAll: selector => selector === '.step-view' ? views : [],
    querySelector: selector => selector === 'thinkcast-top-nav' ? topNav : messages[selector] || null,
    addEventListener(type, fn) { rootListeners.set(type, fn); }, removeEventListener(type, fn) { if (rootListeners.get(type) === fn) rootListeners.delete(type); }
  };
  let loggedIn = true, active = 'A';
  const projects = {A: {}, B: {}};
  const calls = [], errors = [];
  let stateLoader = async () => ({content: true});
  let contentLoader = async () => ({});
  let refresh = async () => {};
  let storyboardError = null;
  const video = {pause() { calls.push(['pause']); }};
  const deps = {
    contentRoute: Route, getLocation: () => location, getHistory: () => history, getWindow: () => fakeWindow,
    isLoggedIn: () => loggedIn, getActiveProjectId: () => active, setActiveProjectId: id => { active = id; calls.push(['active', id]); }, getProjects: () => projects,
    refreshProjectIndex: () => refresh(), loadProjectState: (...args) => stateLoader(...args), loadProjectContent: (...args) => contentLoader(...args),
    openIndexProject: (...args) => calls.push(['open', ...args]), updateContentUuidLabels: () => calls.push(['uuid']), getPreviewVideo: () => video,
    scrollTo: value => calls.push(['scroll', value]), renderStoryboardGrid: () => { calls.push(['storyboard']); if (storyboardError) throw storyboardError; },
    connectStoryboardAssetsToEditor: () => calls.push(['connect']), setContentIndexError: (...args) => calls.push(['error', ...args]), onError: (...args) => errors.push(args)
  };
  const controller = Navigation.create(deps);
  assert.equal(Object.isFrozen(controller), true);
  assert.throws(() => Navigation.create(), /requires getLocation/);
  assert.throws(() => Navigation.create({...deps, contentRoute: {}}), /requires contentRoute/);
  assert.equal(controller.mount(root), true); assert.equal(controller.mount(root), true);
  assert.equal(rootListeners.size, 1); assert.equal(topListeners.size, 1); assert.equal(windowListeners.size, 2);

  assert.deepEqual(controller.readRoute(), {step: 'index', projectId: 'A', explicitProject: true});
  controller.writeRoute('4', 'replace');
  assert.equal(historyCalls.at(-1)[0], 'replace'); assert.match(href, /project_id=A#step4$/);
  const token = controller.begin(); assert.equal(controller.isStale(token), false); controller.begin(); assert.equal(controller.isStale(token), true);

  calls.length = 0; href = 'https://tc.test/app.html?project_id=A#index';
  controller.showStep('3-1', 'replace');
  assert.equal(views.find(view => !view.hidden).id, 'step31'); assert.equal(topNav.active, '3');
  assert.deepEqual(calls.slice(0, 3).map(item => item[0]), ['uuid', 'pause', 'scroll']); assert.equal(historyCalls.at(-1)[0], 'replace');
  video.pause = () => { throw new Error('pause failed'); }; controller.showStep('4');
  assert.match(errors.at(-1)[1].message, /pause failed/); assert.equal(views.find(view => !view.hidden).id, 'step4');
  loggedIn = false; controller.showStep('5'); assert.equal(views.find(view => !view.hidden).id, 'step1'); loggedIn = true;

  active = 'A'; calls.length = 0; await controller.navigate('3-1');
  assert.deepEqual(calls.filter(item => ['storyboard', 'connect'].includes(item[0])), [['storyboard']]);
  active = 'A'; stateLoader = async () => ({content: false}); calls.length = 0;
  assert.equal(await controller.navigate('4'), '2'); assert.equal(messages['#keywordMessage'].textContent, '저장된 키워드를 확인한 뒤 대본 구성을 시작해 주세요.');
  assert.equal(views.find(view => !view.hidden).id, 'step2');
  stateLoader = async () => ({content: true}); calls.length = 0; await controller.navigate('4'); assert.ok(calls.some(item => item[0] === 'connect'));
  active = null; assert.equal(await controller.navigate('3'), 'index');

  active = 'A'; delete projects.A; refresh = async () => { projects.A = {}; }; calls.length = 0;
  assert.equal(await controller.navigate('project', {historyMode: 'replace'}), 'project'); assert.deepEqual(calls.at(-1), ['open', 'A', 'replace']);
  active = null; assert.equal(await controller.navigate('project'), 'index');

  active = 'A'; let release; stateLoader = () => new Promise(resolve => { release = resolve; }); calls.length = 0;
  const stale = controller.navigate('4'); controller.begin(); release({content: true}); assert.equal(await stale, undefined);
  assert.equal(calls.some(item => item[0] === 'connect'), false, 'stale state load does not prepare');
  stateLoader = async () => ({content: true});
  let releaseContent; contentLoader = () => new Promise(resolve => { releaseContent = resolve; });
  const staleContent = controller.navigate('4'); await Promise.resolve(); controller.begin(); releaseContent({}); assert.equal(await staleContent, undefined);

  storyboardError = new Error('storyboard failed'); active = 'A'; contentLoader = async () => ({});
  await assert.rejects(() => controller.navigate('3-1'), /storyboard failed/);
  assert.equal(messages['#storyboardMessage'].textContent, '콘티를 불러오지 못했습니다: storyboard failed'); storyboardError = null;

  active = 'A'; calls.length = 0; href = 'https://tc.test/app.html?project_id=B#step4';
  const historyCount = historyCalls.length;
  await controller.restoreRoute(); assert.equal(active, 'B'); assert.equal(historyCalls.length, historyCount, 'restoring the same route does not append history');
  const count = calls.length; await controller.restoreRoute(); assert.equal(calls.length, count, 'same href restores once');
  href = 'https://tc.test/app.html?project_id=missing#step4'; await controller.restoreRoute();
  assert.equal(active, null); assert.ok(calls.some(item => item[0] === 'error' && /찾을 수 없습니다/.test(item[2])));

  active = 'A'; stateLoader = async () => ({content: true});
  await rootListeners.get('click')({target: {closest: () => ({dataset: {go: '2'}})}});
  assert.equal(views.find(view => !view.hidden).id, 'step2', 'delegated data-go navigates');
  stateLoader = async () => { throw new Error('delegated failed'); };
  await rootListeners.get('click')({target: {closest: () => ({dataset: {go: '2'}})}});
  assert.equal(messages['#projectDetailNote'].textContent, 'delegated failed');
  await topListeners.get('thinkcast-step-change')({detail: {step: '2'}});
  assert.equal(messages['#projectDetailNote'].textContent, 'delegated failed');
  assert.equal(views.find(view => !view.hidden).id, 'stepIndex', 'top-nav failure returns to index');
  stateLoader = async () => ({content: true});

  controller.unmount(); assert.equal(rootListeners.size, 0); assert.equal(topListeners.size, 0); assert.equal(windowListeners.size, 0);
  assert.equal(controller.mount(root), true, 'remount succeeds'); controller.unmount();
  assert.throws(() => controller.mount({...root, querySelector: selector => selector === 'thinkcast-top-nav' ? null : root.querySelector(selector)}), /missing thinkcast-top-nav/);
  assert.equal(controller.mount(root), true, 'failed mount rolls back'); controller.unmount();

  console.log('Shell navigation controller tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
