const assert = require('node:assert/strict');
const Controller = require('../01_app/assets/steps/step03/storyboard-flow-controller.js');

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; }
function node(id) {
  const listeners = new Map();
  return {id, textContent: 'old', disabled: false, listeners,
    addEventListener(type, handler) { const list = listeners.get(type) || []; list.push(handler); listeners.set(type, list); },
    removeEventListener(type, handler) { listeners.set(type, (listeners.get(type) || []).filter(item => item !== handler)); },
    click(target = this) { for (const handler of listeners.get('click') || []) handler({target}); }};
}
function harness(overrides = {}) {
  const names = ['scriptNext', 'scriptMessage', 'storyboardNext', 'storyboardMessage', 'storyboardLookToolbar'];
  const nodes = Object.fromEntries(names.map(name => [name, node(name)]));
  const root = {querySelector: selector => nodes[selector.slice(1)] || null};
  const calls = [];
  const deps = {
    getRoot: () => root, renderStoryboardGrid: overrides.render || (() => calls.push('render')),
    showStep: overrides.show || (step => calls.push(['show', step])), updateScriptDiff: overrides.diff || (() => 0),
    saveScriptChanges: overrides.save || (async () => calls.push('save')), connectStoryboardAssetsToEditor: overrides.connect || (() => calls.push('connect')),
    applyStoryboardLook: overrides.look || (look => calls.push(['look', look]))
  };
  return {controller: Controller.create(deps), deps, nodes, root, calls};
}

(async () => {
  let h = harness();
  assert.equal(Object.isFrozen(Controller), true); assert.equal(Object.isFrozen(h.controller), true);
  for (const name of ['getRoot', 'renderStoryboardGrid', 'showStep', 'updateScriptDiff', 'saveScriptChanges', 'connectStoryboardAssetsToEditor', 'applyStoryboardLook']) {
    const copy = {...h.deps}; delete copy[name]; assert.throws(() => Controller.create(copy), new RegExp(`requires ${name}`));
  }
  const incomplete = {querySelector: selector => selector === '#storyboardLookToolbar' ? null : node(selector)};
  assert.throws(() => h.controller.mount(incomplete), /missing #storyboardLookToolbar/);
  assert.equal([...Object.values(h.nodes)].reduce((sum, item) => sum + (item.listeners.get('click') || []).length, 0), 0, 'failed mount binds nothing');
  assert.equal(h.controller.mount(h.root), true); assert.equal(h.controller.mount(h.root), true);
  assert.equal(h.nodes.scriptNext.listeners.get('click').length, 1); assert.equal(h.nodes.storyboardNext.listeners.get('click').length, 1); assert.equal(h.nodes.storyboardLookToolbar.listeners.get('click').length, 1);

  h.nodes.scriptNext.click(); assert.deepEqual(h.calls, ['render', ['show', '3-1']]); assert.equal(h.nodes.scriptMessage.textContent, '');
  h = harness({render: () => { throw new Error('render failed'); }}); h.controller.mount(); h.nodes.scriptNext.click();
  assert.equal(h.nodes.scriptMessage.textContent, 'render failed'); assert.deepEqual(h.calls, []);

  h = harness({diff: () => 0}); h.controller.mount(); await h.controller.advanceStoryboard();
  assert.deepEqual(h.calls, ['connect', ['show', 4]]); assert.equal(h.nodes.storyboardNext.disabled, false); assert.equal(h.nodes.storyboardMessage.textContent, '');
  h = harness({diff: () => 2}); h.controller.mount(); await h.controller.advanceStoryboard();
  assert.deepEqual(h.calls, ['save', 'connect', ['show', 4]]);
  h = harness({diff: () => { throw new Error('diff failed'); }}); h.controller.mount(); await h.controller.advanceStoryboard();
  assert.equal(h.nodes.storyboardMessage.textContent, 'diff failed'); assert.deepEqual(h.calls, []);
  h = harness({diff: () => 1, save: async () => { throw new Error('save failed'); }}); h.controller.mount(); await h.controller.advanceStoryboard();
  assert.equal(h.nodes.storyboardMessage.textContent, 'save failed'); assert.deepEqual(h.calls, []); assert.equal(h.nodes.storyboardNext.disabled, false);
  h = harness({connect: () => { throw new Error('connect failed'); }}); h.controller.mount(); await h.controller.advanceStoryboard();
  assert.equal(h.nodes.storyboardMessage.textContent, 'connect failed'); assert.equal(h.calls.some(item => Array.isArray(item) && item[0] === 'show'), false);

  const save = deferred(); let saves = 0, connects = 0, shows = 0;
  h = harness({diff: () => 1, save: () => { saves += 1; return save.promise; }, connect: () => { connects += 1; }, show: () => { shows += 1; }}); h.controller.mount();
  const first = h.controller.advanceStoryboard(), second = h.controller.advanceStoryboard(); assert.equal(first, second); assert.equal(h.nodes.storyboardNext.disabled, true);
  await Promise.resolve(); assert.equal(saves, 1); save.resolve(); await first; assert.equal(connects, 1); assert.equal(shows, 1); assert.equal(h.nodes.storyboardNext.disabled, false);

  h = harness(); h.controller.mount();
  h.controller.applyLookEvent({target: {}}); h.controller.applyLookEvent({target: {closest: () => null}}); h.controller.applyLookEvent({target: {closest: () => ({dataset: {}})}});
  assert.deepEqual(h.calls, []);
  const lookButton = {dataset: {look: 'cool'}, closest: () => lookButton}; h.nodes.storyboardLookToolbar.click(lookButton);
  assert.deepEqual(h.calls, [['look', 'cool']]);

  const oldRoot = h.root, oldNodes = h.nodes; h.controller.unmount(); assert.equal(oldNodes.scriptNext.listeners.get('click').length, 0);
  const replacement = harness(); h.controller.mount(replacement.root); replacement.nodes.scriptNext.click(); assert.deepEqual(h.calls, [['look', 'cool'], 'render', ['show', '3-1']]);
  h.controller.unmount(); h.controller.unmount(); h.controller.mount(oldRoot); oldNodes.scriptNext.click(); assert.equal(h.calls.filter(item => item === 'render').length, 2);
  console.log('Storyboard flow controller tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
