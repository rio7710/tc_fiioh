const assert = require('node:assert/strict');
const Step04BrandState = require('../01_app/assets/steps/step04/step04-brand-state.js');

const state = Step04BrandState.create({selections: [
  {role: 'watermark', settings: {position: 'bottom-right', width_ratio: 0.2, profiles: {'9x16': {position: 'top-left', width_ratio: 0.3}}}},
  {role: 'outro', settings: {position: 'center-center', width_ratio: 0.9, background: 'black', background_opacity: 0.7, profiles: {'4x5': {position: 'bottom-center', width_ratio: 0.8, background: 'white', background_opacity: 0.4, version_id: 'outro-45'}}}}
]});

assert.deepEqual(state.activeWatermarkProfile('9x16'), {position: 'top-left', width_ratio: 0.3});
assert.deepEqual(state.activeWatermarkProfile('16x9'), {position: 'bottom-right', width_ratio: 0.2});
state.updateWatermarkProfile('16x9', {position: 'center-left', width_ratio: 0.25});
state.updateWatermarkProfile('1x1', {position: 'bottom-left', width_ratio: 0.4});
assert.equal(state.activeWatermarkProfile('16x9').position, 'center-left');
assert.equal(state.activeWatermarkProfile('1x1').position, 'bottom-left');
assert.equal(state.activeWatermarkProfile('9x16').position, 'top-left', 'ratio profiles remain independent');

assert.equal(state.activeOutroProfile('4x5').version_id, 'outro-45');
state.updateOutroProfile('16x9', {background: 'black', background_opacity: 5, width_ratio: 0});
assert.equal(state.activeOutroProfile('16x9').background_opacity, 1);
assert.equal(state.activeOutroProfile('16x9').width_ratio, 0.06);
state.updateOutroProfile('1x1', {position: 'invalid', background: 'invalid', background_opacity: -1, width_ratio: 4});
assert.equal(state.activeOutroProfile('1x1').position, 'center-center');
assert.equal(state.activeOutroProfile('1x1').background, 'black', 'invalid background preserves the validated active value');
assert.equal(state.activeOutroProfile('1x1').background_opacity, 0);
assert.equal(state.activeOutroProfile('1x1').width_ratio, 1);
assert.equal(state.activeOutroProfile('4x5').version_id, 'outro-45', 'outro ratios remain independent');

const snapshot = state.snapshot();
snapshot.watermarkProfiles['9x16'].position = 'bottom-right';
snapshot.outroProfiles['4x5'].version_id = 'changed';
assert.equal(state.activeWatermarkProfile('9x16').position, 'top-left', 'snapshot watermark profile is isolated');
assert.equal(state.activeOutroProfile('4x5').version_id, 'outro-45', 'snapshot outro profile is isolated');

const watermarkSettings = state.serializeSettings('watermark');
const outroSettings = state.serializeSettings('outro');
assert.deepEqual(Object.keys(watermarkSettings), ['position', 'width_ratio', 'profiles']);
assert.deepEqual(Object.keys(outroSettings), ['position', 'width_ratio', 'background', 'background_opacity', 'profiles']);
watermarkSettings.profiles['16x9'].width_ratio = 1;
assert.equal(state.activeWatermarkProfile('16x9').width_ratio, 0.25, 'serialized settings are isolated');
assert.equal(outroSettings.profiles['4x5'].version_id, 'outro-45', 'serialized settings preserve ratio asset identity');

state.hydrate({watermark: {position: 'top-center', width_ratio: 2}, outro: {background: 'white', background_opacity: 0.25}});
assert.equal(state.activeWatermarkProfile('16x9').width_ratio, 1, 'hydrate clamps width');
assert.equal(state.activeOutroProfile('9x16').background, 'white');
assert.throws(() => state.activeWatermarkProfile('3x2'), /Unsupported Step 4 ratio/);
assert.throws(() => state.serializeSettings('intro'), /Unsupported Step 4 brand role/);

console.log('Step 4 brand overlay state tests passed.');
