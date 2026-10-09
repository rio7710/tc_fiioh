const assert = require('node:assert/strict');
const DataController = require('../01_app/assets/steps/step05/step05-calendar-data-controller.js');

assert.throws(() => DataController.create({}), /requires store/);
assert.throws(() => DataController.create({store: {load() {}, hydrate() {}, save() {}}}), /requires getEntries/);

const localEntries = [{id: 'local'}];
const serverEntries = [{id: 'server'}];
const loadResult = {entries: localEntries, error: null};
const hydrateResult = {entries: serverEntries, error: null};
const saveResult = {ok: true, error: null};
const hydrateInputs = [];
const savedInputs = [];
const assigned = [];
const renders = [];
let currentEntries = [{id: 'initial'}];
const store = {
  load() { return loadResult; },
  async hydrate(entries) { hydrateInputs.push(entries); return hydrateResult; },
  save(entries) { savedInputs.push(entries); return saveResult; }
};
const controller = DataController.create({
  store,
  getEntries: () => currentEntries,
  setEntries(entries) { currentEntries = entries; assigned.push(entries); },
  render(options) { renders.push(options); }
});
assert.equal(Object.isFrozen(controller), true);
assert.equal(controller.load(), loadResult, 'load preserves store result identity');
assert.equal(currentEntries, localEntries);
assert.equal(assigned[0], localEntries);

(async () => {
  const hydrateInput = currentEntries;
  assert.equal(await controller.hydrate(), hydrateResult, 'hydrate preserves store result identity');
  assert.equal(hydrateInputs[0], hydrateInput, 'hydrate passes the invocation-time entries snapshot');
  assert.equal(currentEntries, serverEntries);
  assert.equal(assigned[1], serverEntries);
  assert.deepEqual(renders, [{preserveScroll: true}]);

  assert.equal(controller.save(), saveResult, 'save preserves store result identity');
  assert.equal(savedInputs[0], serverEntries, 'save reads current entries at invocation time');

  const rejection = new Error('hydrate failed');
  const rejecting = DataController.create({
    store: {load() { return loadResult; }, hydrate() { return Promise.reject(rejection); }, save() { return saveResult; }},
    getEntries: () => localEntries,
    setEntries() { throw new Error('must not assign after rejection'); },
    render() { throw new Error('must not render after rejection'); }
  });
  await assert.rejects(rejecting.hydrate(), rejection, 'hydrate rejection propagates unchanged');
  console.log('Step 5 calendar data controller tests passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
