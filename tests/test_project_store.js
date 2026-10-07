const assert = require('node:assert/strict');
const {
  createProjectStore,
  PROJECT_DEFAULTS
} = require('../01_app/assets/core/project-store.js');

const store = createProjectStore({
  activeProjectId: 'project-a',
  user: {
    renderSettings: { ratio: '9x16', quality: 'high' },
    brandSettings: { watermark: true, outro: 'v4' }
  }
});

const events = [];
const unsubscribeFirst = store.subscribe(snapshot => events.push(`first:${snapshot.version}`));
store.subscribe(snapshot => events.push(`second:${snapshot.version}`));

const initial = store.getSnapshot();
assert.equal(initial.activeProjectId, 'project-a');
assert.strictEqual(store.getSnapshot(), initial, 'unchanged snapshots must have stable identity');
assert.ok(Object.isFrozen(initial) && Object.isFrozen(initial.project));
assert.throws(() => { initial.project.scenes.push({ id: 'leak' }); }, TypeError);

store.updateProject({
  scenes: [{ id: 'scene-a' }],
  sceneCropPositions: { 'scene-a': { '9x16': 42 } },
  selectedKeywords: ['warmth']
});
assert.deepEqual(events, ['first:1', 'second:1'], 'subscribers run synchronously in registration order');

store.setActiveProject('project-b');
const projectB = store.getSnapshot();
assert.equal(projectB.activeProjectId, 'project-b');
assert.deepEqual(projectB.project, PROJECT_DEFAULTS, 'switching projects must not leak project A state');
assert.deepEqual(projectB.user.renderSettings, { quality: 'high', ratio: '9x16' });
assert.deepEqual(projectB.user.brandSettings, { outro: 'v4', watermark: true });

store.updateProject({ scenes: [{ id: 'scene-b' }], selectedKeywords: ['family'] });
store.resetProjectState();
const reset = store.getSnapshot();
assert.equal(reset.activeProjectId, 'project-b', 'project reset must preserve active project identity');
assert.deepEqual(reset.project, PROJECT_DEFAULTS, 'lifecycle success reset clears only project state');
assert.deepEqual(reset.user.renderSettings, { quality: 'high', ratio: '9x16' });
assert.deepEqual(reset.user.brandSettings, { outro: 'v4', watermark: true });

store.updateRenderSettings({ ratio: '1x1' });
store.updateBrandSettings(settings => ({ ...settings, intro: true }));
const configured = store.getSnapshot();
assert.deepEqual(configured.user.renderSettings, { quality: 'high', ratio: '1x1' });
assert.deepEqual(configured.user.brandSettings, { intro: true, outro: 'v4', watermark: true });

const versionBeforeNoop = configured.version;
const eventCountBeforeNoop = events.length;
store.setActiveProject('project-b');
assert.equal(store.getSnapshot().version, versionBeforeNoop, 'no-op writes must not advance version');
assert.equal(events.length, eventCountBeforeNoop, 'no-op writes must not notify subscribers');

unsubscribeFirst();
store.updateProject({ selectedKeywords: ['expertise'] });
assert.equal(events.at(-1), `second:${versionBeforeNoop + 1}`);
assert.equal(events.filter(item => item === `first:${versionBeforeNoop + 1}`).length, 0);

assert.throws(() => store.updateProject({ invalid: new Map() }), /JSON-safe/);
assert.throws(() => store.setActiveProject(7), /string or null/);

console.log('PASS: deterministic project store isolation and user settings preservation');
