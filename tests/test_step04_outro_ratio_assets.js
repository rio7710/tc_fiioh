const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Step04BrandState = require('../01_app/assets/steps/step04/step04-brand-state.js');

const html = fs.readFileSync('01_app/P1_title_design_preview.html', 'utf8');
const start = html.indexOf('function ensureOutroRatioAssets(');
const end = html.indexOf('function renderBrandChoices(', start);
assert.ok(start >= 0 && end > start, 'P1 exposes the outro ratio asset policy');

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
const brandOverlayState = Step04BrandState.create({outro: {profiles}});
const context = {brandOverlayState, brandAssets: assets};
vm.runInNewContext(`${html.slice(start, end)};this.ensureOutroRatioAssets=ensureOutroRatioAssets;`, context);

const original = brandOverlayState.snapshot();
context.ensureOutroRatioAssets(assets[0]);
assert.deepEqual(brandOverlayState.snapshot(), original, 'default refresh preserves every valid ratio profile');

const missing = brandOverlayState.snapshot();
delete missing.outroProfiles['9x16'].version_id;
brandOverlayState.hydrate(missing);
context.ensureOutroRatioAssets(assets[0]);
const supplemented = brandOverlayState.snapshot();
assert.equal(supplemented.outroProfiles['9x16'].version_id, 'green-9x16', 'default policy fills only the missing companion ID');
for (const ratio of ratios.filter(value => value !== '9x16')) {
  assert.equal(supplemented.outroProfiles[ratio].version_id, `custom-${ratio}`, `${ratio} valid custom ID is preserved`);
}
for (const ratio of ratios) {
  for (const key of ['position', 'width_ratio', 'background', 'background_opacity']) {
    assert.equal(supplemented.outroProfiles[ratio][key], original.outroProfiles[ratio][key], `${ratio} ${key} is preserved`);
  }
}

context.ensureOutroRatioAssets(assets[0], {force: true});
assert.deepEqual(ratios.map(ratio => brandOverlayState.snapshot().outroProfiles[ratio].version_id),
  ['green-main', 'green-9x16', 'green-4x5', 'green-1x1'], 'force remaps all ratios to the Greenhill companion set');

context.ensureOutroRatioAssets(assets.at(-1), {force: true});
assert.deepEqual(ratios.map(ratio => brandOverlayState.snapshot().outroProfiles[ratio].version_id),
  Array(4).fill('plain-main'), 'force remaps a plain outro to its common representative');

console.log('Step04 outro ratio asset policy tests passed');
