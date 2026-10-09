const assert = require('node:assert/strict');
const UserSettings = require('../01_app/assets/core/user-settings-controller.js');

function makeElement(id = '') {
  const listeners = new Map();
  const children = [];
  const element = {
    id, listeners, children, dataset: {}, style: {setProperty() {}, overflow: ''}, classList: {toggle() {}},
    value: id.includes('Count') ? '3' : id.includes('Interval') ? '1' : id.includes('SceneCount') ? '0' : '',
    checked: id === 'userAiKeywords', hidden: false, disabled: false, inert: false, open: false, textContent: '',
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(listener); },
    removeEventListener(type, listener) { listeners.set(type, (listeners.get(type) || []).filter(item => item !== listener)); },
    async emit(type, event = {}) { for (const listener of listeners.get(type) || []) await listener({preventDefault() {}, currentTarget: element, target: element, ...event}); },
    setAttribute() {}, getAttribute() { return null; }, focus() {},
    showModal() { this.open = true; }, close() { this.open = false; return this.emit('close'); },
    getBoundingClientRect() { return {left: 0, right: 100, top: 0, bottom: 100}; },
    closest() { return makeElement('layout'); },
    querySelector(selector) {
      if (selector.includes(':checked')) return {value: 'day', checked: true};
      if (selector === '.user-output-grid') return element;
      return null;
    },
    querySelectorAll() { return []; }, replaceChildren(...items) { children.splice(0, children.length, ...items); },
    append(...items) { children.push(...items); }, reset() {}, reportValidity() { return true; }, checkValidity() { return true; },
    pause() {}, play() { return Promise.resolve(); }
  };
  return element;
}

function harness() {
  const elements = new Map();
  const get = selector => {
    const id = selector.replace(/^#/, '');
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  };
  const root = {
    body: makeElement('body'),
    querySelector: get,
    querySelectorAll() { return []; },
    getElementById: get,
    createElement: tag => makeElement(tag),
    createTextNode: text => ({textContent: text})
  };
  get('#userKeywordMonth').value = '2026-10';
  get('#userCropMode').value = 'default';
  get('#userVoiceProfile').value = 'warm_female';
  const requests = [];
  const intervals = [];
  const cleared = [];
  const errors = [];
  const controller = UserSettings.create({
    getRoot: () => root,
    request: async (path, options) => {
      requests.push([path, options]);
      return {settings: null, runs: []};
    },
    getIndexProjects: () => ({project: {steps: [{key: '1', label: '기본'}, {key: '2', label: '키워드'}]}}),
    refreshProjectIndex: async () => {},
    confirm: () => true,
    fetch: async () => ({ok: true, blob: async () => ({})}),
    createObjectURL: () => 'blob:voice', revokeObjectURL() {}, createRequestId: () => 'request-id',
    setInterval(callback, delay) { const timer = {callback, delay}; intervals.push(timer); return timer; },
    clearInterval(timer) { cleared.push(timer); },
    onError(feature, error) { errors.push([feature, error]); },
    authUI: {isLoggedIn: () => true, getActiveAccount: () => ({user: {id: 'user-1'}})},
    storage: {getItem: () => null}
  });
  return {controller, root, get, requests, intervals, cleared, errors};
}

assert.throws(() => UserSettings.create({}), /requires getRoot/);
const fixture = harness();
assert.equal(Object.isFrozen(fixture.controller), true);
assert.equal(fixture.controller.mount(), true);
assert.equal(fixture.controller.mount(), true);
assert.equal(fixture.get('#userSettingsOpen').listeners.get('click').length, 1, 'mount is idempotent');

(async () => {
  await fixture.get('#userSettingsOpen').emit('click');
  assert.equal(fixture.requests[0][0], '/api/automation');
  assert.equal(fixture.get('#userSettingsDialog').open, true);
  assert.equal(fixture.intervals[0].delay, 5000);
  const stageButton = fixture.get('#userAutomationStages').children[0];
  assert.equal(stageButton.listeners.get('click').length, 1, 'dynamic stage listener is tracked');

  fixture.get('#userChannelKeyInput').value = 'secret';
  await fixture.get('#userChannelKeyClose').emit('click');
  assert.equal(fixture.get('#userChannelKeyInput').value, '', 'channel key is cleared on close');

  await fixture.get('#userSettingsSave').emit('click');
  const post = fixture.requests.find(([, options]) => options?.method === 'POST');
  assert.ok(post, 'save dispatches automation POST');
  assert.equal(JSON.parse(post[1].body).request_id, 'request-id');
  assert.equal(JSON.parse(post[1].body).action, 'save');

  assert.equal(fixture.controller.unmount(), true);
  assert.ok(fixture.cleared.includes(fixture.intervals[0]), 'unmount clears polling');
  assert.equal(fixture.get('#userSettingsOpen').listeners.get('click').length, 0, 'unmount removes static listeners');
  assert.equal(stageButton.listeners.get('click').length, 0, 'unmount removes dynamic listeners');
  assert.equal(fixture.controller.unmount(), false);
  assert.equal(fixture.controller.mount(), true);
  assert.equal(fixture.get('#userSettingsOpen').listeners.get('click').length, 1, 'remount binds one fresh listener');
  const requestCount = fixture.requests.length;
  await fixture.get('#userSettingsOpen').emit('click');
  assert.equal(fixture.requests.length, requestCount + 1, 'remounted open listener remains functional');
  console.log('User settings controller tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
