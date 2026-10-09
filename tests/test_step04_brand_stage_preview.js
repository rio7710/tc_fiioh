const assert = require('node:assert/strict');
const Controller = require('../01_app/assets/steps/step04/step04-brand-stage-preview.js');
const BrandState = require('../01_app/assets/steps/step04/step04-brand-state.js');

function node(extra = {}) {
  const attributes = {};
  const value = Object.assign({hidden: false, checked: false, value: '', style: {}, dataset: {}}, extra);
  Object.defineProperty(value, 'src', {get() { return attributes.src || ''; }, set(next) { attributes.src = String(next); }, configurable: true});
  value.getAttribute = name => attributes[name] ?? null;
  value.removeAttribute = name => { delete attributes[name]; };
  return value;
}
function assertPosition(target, position) {
  const [vertical, horizontal] = position.split('-');
  assert.equal(target.style[horizontal === 'right' ? 'right' : 'left'], horizontal === 'center' ? '50%' : '3.5%');
  assert.equal(target.style[vertical === 'bottom' ? 'bottom' : 'top'], vertical === 'center' ? '50%' : '3.5%');
  const expected = `${horizontal === 'center' ? 'translateX(-50%)' : ''}${horizontal === 'center' && vertical === 'center' ? ' ' : ''}${vertical === 'center' ? 'translateY(-50%)' : ''}`;
  assert.equal(target.style.transform, expected);
}

const ratios = ['16x9', '9x16', '4x5', '1x1'];
const positions = ['top-left', 'top-center', 'top-right', 'center-left', 'center-center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right'];
const watermarkProfiles = Object.fromEntries(ratios.map((ratio, index) => [ratio, {position: positions[index], width_ratio: .1 + index * .1}]));
const outroProfiles = Object.fromEntries(ratios.map((ratio, index) => [ratio, {
  version_id: `outro-${ratio}`, position: positions[index + 4], width_ratio: .4 + index * .1,
  background: index % 2 ? 'black' : 'white', background_opacity: .2 + index * .2
}]));
const state = BrandState.create({watermark: {profiles: watermarkProfiles}, outro: {profiles: outroProfiles}});
const assets = ratios.map((ratio, index) => ({role: 'outro', version_id: `outro-${ratio}`, media_type: index % 2 ? 'video' : 'image'}));
const nodes = {
  '#brandWatermarkEnabled': node({checked: true}), '#brandWatermarkVersion': node({value: 'mark-1'}),
  '#brandWatermarkPreview': node(), '#brandWatermarkOpacity': node({value: '.65'}),
  '#brandOutroEnabled': node({checked: true}), '#brandOutroVersion': node({value: 'outro-16x9'}),
  '#brandOutroPreview': node(), '#brandOutroPreviewImage': node(), '#brandOutroPreviewVideo': node()
};
const root = {querySelector: selector => nodes[selector] || null};
let ratio = '16x9';
const ensureCalls = [];
const controller = Controller.create({getRoot: () => root, state, getAssets: () => assets,
  ensureOutroRatioAssets: (...args) => ensureCalls.push(args), getCurrentRatio: () => ratio});

for (const current of ratios) {
  ratio = current;
  assert.equal(controller.currentRatio(), current);
  assert.deepEqual(controller.activeWatermarkProfile(), state.activeWatermarkProfile(current));
  assert.deepEqual(controller.activeOutroProfile(), state.activeOutroProfile(current));
  controller.updateWatermark();
  assert.equal(nodes['#brandWatermarkPreview'].style.width, `${watermarkProfiles[current].width_ratio * 100}%`);
  assert.equal(nodes['#brandWatermarkPreview'].style.opacity, '.65');
  assertPosition(nodes['#brandWatermarkPreview'], watermarkProfiles[current].position);
  nodes['#brandOutroVersion'].value = `outro-${current}`;
  controller.updateOutro();
  const profile = outroProfiles[current];
  const active = assets.find(asset => asset.version_id === profile.version_id).media_type === 'video' ? nodes['#brandOutroPreviewVideo'] : nodes['#brandOutroPreviewImage'];
  assert.equal(active.style.width, `${profile.width_ratio * 100}%`);
  assert.equal(nodes['#brandOutroPreview'].style.backgroundColor, controller.backgroundColor(profile));
  assertPosition(active, profile.position);
}
assert.equal(ensureCalls.length, 4);
ensureCalls.forEach(args => assert.equal(args.length, 1, 'common preview never requests force remapping'));

ratio = '16x9'; nodes['#brandOutroVersion'].value = 'outro-16x9'; controller.updateOutro();
const staleImageSrc = nodes['#brandOutroPreviewImage'].getAttribute('src');
ratio = '9x16'; nodes['#brandOutroVersion'].value = 'outro-9x16'; controller.updateOutro();
assert.equal(nodes['#brandOutroPreviewImage'].hidden, true);
assert.equal(nodes['#brandOutroPreviewVideo'].hidden, false);
assert.equal(nodes['#brandOutroPreviewImage'].getAttribute('src'), staleImageSrc, 'inactive image keeps its current stale src');
const staleVideoSrc = nodes['#brandOutroPreviewVideo'].getAttribute('src');
ratio = '4x5'; nodes['#brandOutroVersion'].value = 'outro-4x5'; controller.updateOutro();
assert.equal(nodes['#brandOutroPreviewVideo'].hidden, true);
assert.equal(nodes['#brandOutroPreviewVideo'].getAttribute('src'), staleVideoSrc, 'inactive video keeps its current stale src');
nodes['#brandOutroEnabled'].checked = false; controller.updateOutro();
assert.equal(nodes['#brandOutroPreviewImage'].getAttribute('src'), null);
assert.equal(nodes['#brandOutroPreviewVideo'].getAttribute('src'), null);
assert.equal(nodes['#brandOutroPreview'].style.backgroundColor, 'transparent');

nodes['#brandWatermarkEnabled'].checked = false; controller.updateWatermark();
assert.equal(nodes['#brandWatermarkPreview'].hidden, true);
assert.equal(nodes['#brandWatermarkPreview'].src, '');

for (const position of positions) {
  const target = node(); controller.applyPosition(target, position);
  assert.equal(target.style.inset, 'auto');
  assertPosition(target, position);
}
assert.equal(controller.backgroundColor({background: 'white', background_opacity: 2}), 'rgba(255,255,255,1)');
assert.equal(controller.backgroundColor({background: 'black', background_opacity: -1}), 'rgba(0,0,0,0)');
assert.equal(controller.backgroundColor({background: 'none', background_opacity: .5}), 'transparent');
assert.equal(Object.isFrozen(controller), true);

assert.throws(() => Controller.create(), /requires getRoot/);
assert.throws(() => Controller.create({getRoot() {}, getAssets() {}, ensureOutroRatioAssets() {}, getCurrentRatio() {}}), /requires brand state/);
const missing = Controller.create({getRoot: () => ({querySelector: () => null}), state, getAssets: () => [], ensureOutroRatioAssets() {}, getCurrentRatio: () => '16x9'});
assert.throws(() => missing.roleControls('outro'), /missing #brandOutroEnabled/);
assert.throws(() => missing.updateWatermark(), /missing #brandWatermarkEnabled/);

console.log('Step04 brand stage preview tests passed');
