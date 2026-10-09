const assert = require('node:assert/strict');
const Controller = require('../01_app/assets/steps/step03/storyboard-look-controller.js');

function harness(initial = {}) {
  const values = new Map(Object.entries(initial));
  const reads = [], writes = [], current = [];
  let projectId = 'A';
  const buttons = ['original', 'warm', 'cool', 'realistic'].map(look => ({dataset: {look}, pressed: '', setAttribute(name, value) { if (name === 'aria-pressed') this.pressed = value; }}));
  const grid = {dataset: {}};
  const root = {querySelector: selector => selector === '#storyboardGrid' ? grid : null, querySelectorAll: selector => selector === '.storyboard-look-btn' ? buttons : []};
  const storage = {getItem(key) { reads.push(key); return values.has(key) ? values.get(key) : null; }, setItem(key, value) { writes.push([key, value]); values.set(key, value); }};
  const deps = {getRoot: () => root, storage, getActiveProjectId: () => projectId, setCurrentLook: value => current.push(value)};
  return {controller: Controller.create(deps), deps, values, reads, writes, current, buttons, grid, setProject: value => { projectId = value; }};
}

(() => {
  let h = harness();
  assert.equal(Object.isFrozen(Controller), true); assert.equal(Object.isFrozen(Controller.allowed), true); assert.equal(Object.isFrozen(h.controller), true);
  for (const name of ['getRoot', 'storage', 'getActiveProjectId', 'setCurrentLook']) {
    const copy = {...h.deps}; delete copy[name]; assert.throws(() => Controller.create(copy), new RegExp(`requires ${name}`));
  }
  assert.deepEqual([...Controller.allowed], ['original', 'warm', 'cool', 'realistic']); assert.equal(Controller.defaultLook, 'original');
  assert.equal(h.controller.normalize('cool'), 'cool'); assert.equal(h.controller.normalize('broken'), 'original');

  assert.equal(h.controller.apply('warm'), 'warm');
  assert.equal(h.grid.dataset.look, 'warm'); assert.equal(h.current.at(-1), 'warm');
  assert.equal(h.buttons.find(button => button.dataset.look === 'warm').pressed, 'true');
  assert.deepEqual(h.writes, [['thinkcast-storyboard-look-A', 'warm']]);
  h.setProject('B'); assert.equal(h.controller.restore(), 'original', 'unsaved B never inherits A memory state');
  assert.equal(h.grid.dataset.look, 'original'); assert.equal(h.writes.length, 1, 'restore never persists a fallback');
  h.setProject('A'); assert.equal(h.controller.restore(), 'warm', 'A restores its own saved look');
  assert.deepEqual(h.reads, ['thinkcast-storyboard-look-B', 'thinkcast-storyboard-look-A']);

  h = harness({'thinkcast-storyboard-look-A': 'warm', 'thinkcast-storyboard-look-B': 'cool'});
  h.setProject('B'); assert.equal(h.controller.restore(), 'cool');
  h.setProject('A'); assert.equal(h.controller.restore(), 'warm');
  assert.equal(h.writes.length, 0); assert.equal(h.values.get('thinkcast-storyboard-look-B'), 'cool');
  h.values.set('thinkcast-storyboard-look-A', 'corrupt'); assert.equal(h.controller.restore(), 'original');
  assert.equal(h.values.get('thinkcast-storyboard-look-A'), 'corrupt', 'corrupt stored value is not overwritten during restore');

  h = harness(); h.setProject(null); assert.equal(h.controller.restore(), 'original'); assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0);
  assert.equal(h.controller.apply('realistic'), 'realistic'); assert.equal(h.writes.length, 0); assert.equal(h.values.has('thinkcast-storyboard-look-null'), false);
  h.setProject('A'); assert.equal(h.controller.apply('invalid'), 'original'); assert.deepEqual(h.writes, [['thinkcast-storyboard-look-A', 'original']]);

  h = harness(); h.deps.getRoot = () => null; assert.throws(() => Controller.create(h.deps).apply('warm'), /DOM root/);
  h = harness(); h.deps.getRoot = () => ({querySelector: () => null, querySelectorAll: () => []}); assert.throws(() => Controller.create(h.deps).restore(), /missing #storyboardGrid/);

  console.log('Storyboard look controller tests passed');
})();
