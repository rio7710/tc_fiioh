const assert = require('node:assert/strict');
const Controller = require('../01_app/assets/steps/step04/step04-brand-selection-controller.js');
const BrandState = require('../01_app/assets/steps/step04/step04-brand-state.js');

(async () => {

function selectNode() {
  let markup = '';
  return {value: '', disabled: false, get innerHTML() { return markup; }, set innerHTML(value) {
    markup = value; const first = value.match(/<option value="([^"]*)"/); this.value = first ? first[1] : '';
  }};
}
const nodes = {
  '#brandIntroEnabled': {checked: false, disabled: false}, '#brandIntroVersion': selectNode(),
  '#brandOutroEnabled': {checked: false, disabled: false}, '#brandOutroVersion': selectNode(),
  '#brandWatermarkEnabled': {checked: false, disabled: false}, '#brandWatermarkVersion': selectNode(),
  '#brandWatermarkOpacity': {value: '.8'}
};
const root = {querySelector: selector => nodes[selector] || null};
const state = BrandState.create();
const order = [];
let sceneCount = 1;
let requestCall = null;
let requestResult = {selections: []};
let rejectRequest = false;
const controller = Controller.create({
  getRoot: () => root,
  request: async (...args) => { requestCall = args; if (rejectRequest) throw new Error('offline'); return requestResult; },
  state,
  isOutroRatioCompanion: item => Boolean(item.companion),
  ensureOutroRatioAssets: (...args) => order.push(['ensure', ...args]),
  updateWatermarkPreview: () => order.push(['watermark']),
  updateOutroPreview: () => order.push(['outro']),
  getSceneCount: () => sceneCount,
  renderSceneList: () => order.push(['scenes']),
  escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
});

const assets = [
  {role: 'intro', active: true, version_id: 'intro-1', name: '<Intro>', version: 1},
  {role: 'outro', active: true, version_id: 'outro-1', name: 'Outro', version: 2},
  {role: 'outro', active: true, version_id: 'outro-companion', name: 'Hidden', version: 2, companion: true},
  {role: 'watermark', active: true, version_id: 'mark-1', name: 'Mark', version: 3},
  {role: 'watermark', active: false, version_id: 'mark-inactive', name: 'Inactive', version: 4}
];
const selections = [
  {role: 'intro', enabled: true, version_id: 'missing', settings: {}},
  {role: 'outro', enabled: true, version_id: 'outro-1', settings: {profiles: {'16x9': {version_id: 'outro-1', width_ratio: .7}}}},
  {role: 'watermark', enabled: true, version_id: 'mark-1', settings: {opacity: .55, profiles: {'16x9': {position: 'top-left', width_ratio: .2}}}}
];
const hydrated = controller.hydrate({assets, selections});
assets[0].name = 'mutated'; selections[1].version_id = 'mutated';
assert.equal(controller.getAssets()[0].name, '<Intro>', 'hydrate isolates asset input');
assert.equal(controller.getSelections()[1].version_id, 'outro-1', 'hydrate isolates selection input');
hydrated.assets[0].name = 'snapshot mutation';
assert.equal(controller.getAssets()[0].name, '<Intro>', 'hydrate result is isolated');

controller.renderChoices();
assert.match(nodes['#brandIntroVersion'].innerHTML, /&lt;Intro>/);
assert.doesNotMatch(nodes['#brandOutroVersion'].innerHTML, /outro-companion/);
assert.doesNotMatch(nodes['#brandWatermarkVersion'].innerHTML, /mark-inactive/);
assert.equal(nodes['#brandIntroVersion'].value, 'intro-1', 'invalid saved selection falls back to first active asset');
assert.equal(nodes['#brandIntroEnabled'].checked, true);
assert.equal(nodes['#brandOutroVersion'].value, 'outro-1');
assert.equal(nodes['#brandWatermarkVersion'].value, 'mark-1');
assert.equal(nodes['#brandWatermarkOpacity'].value, .55);
assert.equal(state.activeWatermarkProfile('16x9').width_ratio, .2);
assert.equal(state.activeOutroProfile('16x9').width_ratio, .7);
assert.deepEqual(order.map(item => item[0]), ['ensure', 'watermark', 'outro', 'scenes'], 'restore callback order is stable');
assert.equal(order[0].length, 2, 'restore ensure never passes force options');

nodes['#brandIntroEnabled'].checked = false;
nodes['#brandWatermarkOpacity'].value = '.65';
const serialized = controller.serializeSelections();
assert.deepEqual(serialized.map(item => item.role), ['intro', 'outro', 'watermark']);
assert.equal(serialized[0].enabled, false);
assert.equal(serialized[2].settings.opacity, .65);
serialized[1].settings.profiles['16x9'].width_ratio = .1;
assert.equal(state.activeOutroProfile('16x9').width_ratio, .7, 'serialized settings are isolated from state');

requestResult = {ok: true, selections: [{role: 'intro', enabled: false, version_id: 'intro-1', settings: {}}]};
order.length = 0;
const saved = await controller.saveSelections();
assert.equal(requestCall[0], '/api/content-brand-selection');
assert.equal(requestCall[1].method, 'POST');
const body = JSON.parse(requestCall[1].body);
assert.deepEqual(Object.keys(body), ['selections'], 'save payload intentionally omits project_id');
assert.equal(body.selections.length, 3);
assert.deepEqual(controller.getSelections(), requestResult.selections);
assert.equal(saved, undefined, 'save preserves the shell function return contract');
requestResult.selections[0].version_id = 'external-mutation';
assert.equal(controller.getSelections()[0].version_id, 'intro-1', 'saved response input is isolated');
assert.deepEqual(order, [['scenes']]);

sceneCount = 0; order.length = 0; await controller.saveSelections(); assert.deepEqual(order, []);
rejectRequest = true;
await assert.rejects(() => controller.saveSelections(), /offline/, 'request rejection propagates');
assert.equal(Object.isFrozen(controller), true);
assert.throws(() => Controller.create(), /requires getRoot/);
assert.throws(() => Controller.create({getRoot() {}, request() {}, isOutroRatioCompanion() {}, ensureOutroRatioAssets() {}, updateWatermarkPreview() {}, updateOutroPreview() {}, getSceneCount() {}, renderSceneList() {}, escapeHtml() {}}), /requires brand state/);
const missing = Controller.create({getRoot: () => ({querySelector: () => null}), request() {}, state, isOutroRatioCompanion() {}, ensureOutroRatioAssets() {}, updateWatermarkPreview() {}, updateOutroPreview() {}, getSceneCount: () => 0, renderSceneList() {}, escapeHtml: String});
assert.throws(() => missing.renderChoices(), /missing #brandIntroEnabled/);

console.log('Step04 brand selection controller tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
