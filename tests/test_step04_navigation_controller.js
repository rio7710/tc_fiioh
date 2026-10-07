const assert = require('node:assert/strict');
const NavigationController = require('../01_app/assets/steps/step04/step04-navigation-controller.js');
const {SceneNav, MobileSync} = require('../01_app/assets/video-editor/index.js');

function control(extra = {}) {
  const listeners = new Map();
  return Object.assign({
    innerHTML: '', value: '', disabled: false, dataset: {},
    classList: {toggle() {}}, setAttribute() {}, scrollIntoView() {},
    addEventListener(type, handler) { const list = listeners.get(type) || []; list.push(handler); listeners.set(type, list); },
    removeEventListener(type, handler) { listeners.set(type, (listeners.get(type) || []).filter(item => item !== handler)); },
    dispatch(type, values = {}) { const event = Object.assign({target: this, currentTarget: this}, values); (listeners.get(type) || []).slice().forEach(handler => handler(event)); },
    listenerCount() { return [...listeners.values()].reduce((sum, list) => sum + list.length, 0); }
  }, extra);
}

const controls = Object.fromEntries(['#sceneList', '#mobileSceneSelect', '#prevBtn', '#nextBtn', '#mobilePrevScene', '#mobileNextScene'].map(key => [key, control()]));
let sceneButtons = [];
const root = {
  querySelector(selector) {
    if (selector === '.scene-btn.active') return sceneButtons.find(button => button.active) || null;
    return controls[selector] || null;
  },
  querySelectorAll(selector) { return selector === '.scene-btn' ? sceneButtons : []; }
};

let scenes = [];
let currentScene = 0;
let currentTime = 0;
let syncCalls = 0;
const controller = NavigationController.create({
  SceneNav,
  MobileSync,
  getScenes: () => scenes,
  getCurrentScene: () => currentScene,
  getCurrentTime: () => currentTime,
  setCurrentTime: value => { currentTime = value; },
  syncPreview: () => { syncCalls += 1; },
  formatTime: MobileSync.formatTime
});

assert.deepEqual(controller.mount(root), {mounted: true});
assert.deepEqual(controller.mount(root), {mounted: false, reason: 'already-mounted'});

function makeScenes(count) {
  return Array.from({length: count}, (_, index) => ({
    id: `scene-${index + 1}`,
    name: `Scene ${index + 1}`,
    start: index * 3,
    end: (index + 1) * 3,
    cueStart: index * 3 + 0.5,
    text: index % 2 ? '' : `Caption ${index + 1}`
  }));
}

for (const count of [1, 3, 7]) {
  scenes = makeScenes(count);
  currentScene = 0;
  const result = controller.render();
  assert.equal(result.sceneCount, count);
  assert.equal((controls['#sceneList'].innerHTML.match(/data-index=/g) || []).length, count, `renders ${count} data-driven scenes`);
  assert.equal((controls['#mobileSceneSelect'].innerHTML.match(/<option/g) || []).length, count + 1, `${count} scenes plus OUT option`);
  assert.match(controls['#sceneList'].innerHTML, /data-outro="true"/);
}

scenes = makeScenes(3);
currentTime = 0;
controls['#nextBtn'].dispatch('click');
assert.equal(currentTime, 3.05, 'desktop next uses canonical scene timing');
controls['#mobileNextScene'].dispatch('click');
assert.equal(currentTime, 6.55, 'mobile next uses the same navigation path');
controls['#nextBtn'].dispatch('click');
assert.equal(currentTime, 8.95, 'last scene next enters OUT');
controls['#prevBtn'].dispatch('click');
assert.equal(currentTime, 6.55, 'OUT previous returns to the final scene');

controls['#mobileSceneSelect'].value = '1';
controls['#mobileSceneSelect'].dispatch('change');
assert.equal(currentTime, 3.05, 'mobile scene selection seeks by timeline data');
controls['#mobileSceneSelect'].value = 'outro';
controls['#mobileSceneSelect'].dispatch('change');
assert.equal(currentTime, 8.95, 'mobile OUT selection seeks to OUT');

controls['#sceneList'].dispatch('click', {target: {closest: () => ({dataset: {index: '0'}})}});
assert.equal(currentTime, 0.55, 'scene list click seeks to selected scene');
controls['#sceneList'].dispatch('click', {target: {closest: () => ({dataset: {outro: 'true'}})}});
assert.equal(currentTime, 8.95, 'scene list OUT click seeks to OUT');

sceneButtons = scenes.map((_, index) => control({dataset: {index: String(index)}, classList: {toggle(_name, active) { this.owner.active = active; }, owner: null}}));
sceneButtons.forEach(button => { button.classList.owner = button; });
const outroButton = control({dataset: {outro: 'true'}, classList: {toggle(_name, active) { this.owner.active = active; }, owner: null}});
outroButton.classList.owner = outroButton;
sceneButtons.push(outroButton);
let mobileState = controller.sync({currentScene: 2, showOutro: false, time: 6.55, duration: 9});
assert.equal(mobileState.selectedValue, '2');
assert.equal(controls['#mobileSceneSelect'].value, '2');
assert.equal(controls['#nextBtn'].disabled, false, 'last scene can move to OUT');
mobileState = controller.sync({currentScene: 2, showOutro: true, time: 8.95, duration: 9});
assert.equal(mobileState.selectedValue, 'outro');
assert.equal(controls['#nextBtn'].disabled, true);
assert.equal(controls['#mobileNextScene'].disabled, true);
assert.equal(controls['#prevBtn'].disabled, false);
assert.equal(outroButton.active, true, 'OUT list item is active');
assert.ok(syncCalls >= 8);

const listenerCount = Object.values(controls).reduce((sum, item) => sum + item.listenerCount(), 0);
assert.ok(listenerCount > 0);
assert.deepEqual(controller.unmount(), {unmounted: true});
assert.equal(Object.values(controls).reduce((sum, item) => sum + item.listenerCount(), 0), 0, 'unmount removes navigation listeners');
assert.deepEqual(controller.unmount(), {unmounted: false}, 'unmount is idempotent');

console.log('Step 4 navigation controller tests passed.');
