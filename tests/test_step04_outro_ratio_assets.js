const assert = require('node:assert/strict');
const Step04BrandState = require('../01_app/assets/steps/step04/step04-brand-state.js');
const Step04OutroRatioAssets = require('../01_app/assets/steps/step04/step04-outro-ratio-assets.js');

const ratios = ['16x9', '9x16', '4x5', '1x1'];
const assets = [
  {role: 'outro', version_id: 'green-main', uri: 'greenhill_outro_v4_16x9.png', active: true},
  ...ratios.slice(1).map(ratio => ({role: 'outro', version_id: `green-${ratio}`, uri: `greenhill_outro_v4_${ratio}.png`, active: true})),
  ...ratios.map(ratio => ({role: 'outro', version_id: `custom-${ratio}`, uri: `custom-${ratio}.png`, active: true})),
  {role: 'outro', version_id: 'plain-main', uri: 'plain.png', active: true}
];
const profiles = Object.fromEntries(ratios.map((ratio, index) => [ratio, {
  version_id: `custom-${ratio}`, position: index % 2 ? 'bottom-right' : 'top-left',
  width_ratio: .2 + index * .1, background: index % 2 ? 'black' : 'white', background_opacity: .4 + index * .1
}]));
const state = Step04BrandState.create({outro: {profiles}});
const controller = Step04OutroRatioAssets.create({state, getAssets: () => assets});

const original = state.snapshot();
assert.equal(controller.ensure(assets[0]), undefined);
assert.deepEqual(state.snapshot(), original, 'default refresh preserves every valid ratio profile');
const missing = state.snapshot();
delete missing.outroProfiles['9x16'].version_id;
state.hydrate(missing);
controller.ensure(assets[0]);
const supplemented = state.snapshot();
assert.equal(supplemented.outroProfiles['9x16'].version_id, 'green-9x16', 'default policy fills only the missing companion ID');
for (const ratio of ratios.filter(value => value !== '9x16')) assert.equal(supplemented.outroProfiles[ratio].version_id, `custom-${ratio}`, `${ratio} valid custom ID is preserved`);
for (const ratio of ratios) for (const key of ['position', 'width_ratio', 'background', 'background_opacity']) assert.equal(supplemented.outroProfiles[ratio][key], original.outroProfiles[ratio][key], `${ratio} ${key} is preserved`);

controller.ensure(assets[0], {force: true});
assert.deepEqual(ratios.map(ratio => state.snapshot().outroProfiles[ratio].version_id), ['green-main', 'green-9x16', 'green-4x5', 'green-1x1'], 'force remaps all ratios to the Greenhill companion set');
controller.ensure(assets.at(-1), {force: true});
assert.deepEqual(ratios.map(ratio => state.snapshot().outroProfiles[ratio].version_id), Array(4).fill('plain-main'), 'force remaps a plain outro to its common representative');

const invalid = state.snapshot();
invalid.outroProfiles['4x5'].version_id = 'missing-version';
invalid.outroProfiles['1x1'].version_id = 'inactive-version';
assets.push({role: 'outro', version_id: 'inactive-version', uri: 'inactive.png', active: false});
state.hydrate(invalid);
controller.ensure(assets[0]);
assert.equal(state.snapshot().outroProfiles['4x5'].version_id, 'green-4x5', 'missing ID is supplemented');
assert.equal(state.snapshot().outroProfiles['1x1'].version_id, 'green-1x1', 'inactive ID is supplemented');

const beforeNull = state.snapshot();
assert.equal(controller.ensure(null), undefined, 'null item is a no-op');
assert.deepEqual(state.snapshot(), beforeNull);
assert.equal(controller.isCompanion(assets.find(asset => asset.uri === 'greenhill_outro_v4_9x16.png')), true);
assert.equal(controller.isCompanion(assets[0]), false);
assert.equal(Object.isFrozen(controller), true);
assert.throws(() => Step04OutroRatioAssets.create(), /requires state/);
assert.throws(() => Step04OutroRatioAssets.create({state: {}}), /state requires snapshot/);
assert.throws(() => Step04OutroRatioAssets.create({state}), /requires getAssets/);

console.log('Step04 outro ratio asset policy tests passed');
