const assert = require('node:assert/strict');
const Controller = require('../01_app/assets/steps/step04/step04-ratio-crop-controller.js');
const RatioProfiles = require('../01_app/assets/video-editor/ratio-profiles.js');

(async () => {

function node(initial = []) {
  const names = new Set(initial);
  const item = { dataset: {}, style: { values: {}, setProperty(k, v) { this.values[k] = v; } }, textContent: '', naturalWidth: 1920, naturalHeight: 1080, videoWidth: 0, videoHeight: 0, attrs: {} };
  Object.defineProperty(item, 'className', { get: () => [...names].join(' ') });
  item.classList = {
    contains: name => names.has(name), add: (...values) => values.forEach(value => names.add(value)),
    remove: (...values) => values.forEach(value => names.delete(value)),
    toggle(name, force) { force ? names.add(name) : names.delete(name); }
  };
  item.setAttribute = (key, value) => { item.attrs[key] = value; };
  return item;
}

const stage = node();
const card = node(['preview-landscape']);
const image = node();
const video = node();
const badge = node();
const safe = node();
const platforms = ['youtube', 'instagram', 'facebook', 'square'].map(platform => Object.assign(node(), { dataset: { platform } }));
const ratios = ['16x9', '9x16', '4x5', '1x1'].map(ratio => Object.assign(node(), { dataset: { ratio } }));
const nodes = { '#stage': stage, '#stageCard': card, '#sceneImage': image, '#sceneVideo': video, '#previewFormatBadge': badge, '#formatSafeZone': safe };
const root = { querySelector: selector => nodes[selector] || null, querySelectorAll: selector => selector === '.platform-preview-btn' ? platforms : selector === '.ratio-btn' ? ratios : [] };
let scenes = [{ id: 'one' }, { id: 'two' }];
let currentScene = 0;
let crops = {};
let pan = 50;
let project = 'project-a';
let platformState = '';
let saves = 0;
let outroCalls = 0;
let errors = 0;
const apiCalls = [];
const controller = Controller.create({
  root, RatioProfiles, getScenes: () => scenes, getCurrentScene: () => currentScene,
  getCropPositions: () => crops, setCropPositions: value => { crops = value; },
  getVideoPanX: () => pan, setVideoPanX: value => { pan = value; },
  setCurrentPreviewPlatform: value => { platformState = value; }, getActiveProjectId: () => project,
  api: async (...args) => { apiCalls.push(args); return { ok: true }; }, saveEditorSettings: () => { saves += 1; },
  updateWatermarkPreview: () => { throw new Error('isolated'); }, updateCommonOutroPreview: () => { outroCalls += 1; },
  onError: () => { errors += 1; }
});

const expected = {
  youtube: ['preview-landscape', 'YouTube · 16:9', '', '16x9'],
  instagram: ['preview-portrait', 'Instagram Reels · 9:16', 'REELS SAFE AREA', '9x16'],
  facebook: ['preview-feed', 'Facebook Feed · 4:5', 'FEED SAFE AREA', '4x5'],
  square: ['preview-square', 'Square Feed · 1:1 · 1080×1080', 'SQUARE SAFE AREA', '1x1']
};
for (const [platform, [className, label, safeLabel, ratio]] of Object.entries(expected)) {
  const result = controller.setPlatformPreview(platform);
  assert.equal(platformState, platform);
  assert.equal(card.classList.contains(className), true);
  assert.equal(badge.textContent, label);
  assert.equal(safe.dataset.label, safeLabel);
  assert.equal(result.formatKey, ratio);
  platforms.forEach(button => assert.equal(button.attrs['aria-pressed'], String(button.dataset.platform === platform)));
  ratios.forEach(button => {
    const active = button.dataset.ratio === ratio;
    assert.equal(button.attrs['aria-pressed'], String(active));
    assert.equal(button.classList.contains('active'), active);
  });
}
assert.equal(outroCalls, 4, 'outro callback continues after isolated watermark failure');
assert.equal(errors, 4, 'callback failures are reported');
assert.equal(saves, 4, 'each platform change saves editor settings');

controller.setVideoPan(140);
assert.equal(pan, 100); assert.equal(stage.style.values['--video-pan-x'], '100%');
controller.setVideoPan(-5);
assert.equal(pan, 0);
card.classList.remove('preview-landscape', 'preview-portrait', 'preview-feed', 'preview-square'); card.classList.add('preview-portrait');
assert.equal(controller.updatePanAvailability(), true);
assert.equal(stage.classList.contains('can-pan'), true);

pan = 22; currentScene = 0;
assert.deepEqual(controller.storeCurrentSceneCrop(), { project_id: 'project-a', scene_id: 'one', format: '9x16', pan_x: 22 });
card.classList.remove('preview-portrait'); card.classList.add('preview-feed'); pan = 66;
controller.storeCurrentSceneCrop();
currentScene = 1; pan = 88; project = 'project-b';
assert.deepEqual(controller.storeCurrentSceneCrop(), { project_id: 'project-b', scene_id: 'two', format: '4x5', pan_x: 88 });
assert.deepEqual(crops, { one: { '9x16': 22, '4x5': 66 }, two: { '4x5': 88 } }, 'scene and ratio positions remain independent');
const cropCopy = controller.getSceneCropPositions(); cropCopy.one['9x16'] = 99;
assert.equal(crops.one['9x16'], 22, 'crop getter is clone safe');
controller.setSceneCropPositions({ one: { '9x16': 33 } });
const supplied = { one: { '9x16': 44 } }; controller.setSceneCropPositions(supplied); supplied.one['9x16'] = 77;
assert.equal(crops.one['9x16'], 44, 'crop setter is clone safe');

currentScene = 99;
assert.equal(controller.storeCurrentSceneCrop(), null, 'missing scene does not create a crop payload');
currentScene = 0; project = 'project-a'; pan = 35;
await controller.persistCurrentSceneCrop();
assert.equal(apiCalls.at(-1)[0], '/api/project/crop-position');
assert.deepEqual(JSON.parse(apiCalls.at(-1)[1].body), { project_id: 'project-a', scene_id: 'one', format: '4x5', pan_x: 35 });

const failing = Controller.create({ ...{
  root, RatioProfiles, getScenes: () => scenes, getCurrentScene: () => 0, getCropPositions: () => crops,
  setCropPositions: value => { crops = value; }, getVideoPanX: () => 30, getActiveProjectId: () => 'p', saveEditorSettings: () => { saves += 1; },
  api: async () => { throw new Error('offline'); }, onError: () => { errors += 1; }
} });
await assert.doesNotReject(() => failing.persistCurrentSceneCrop(), 'API failure remains isolated');
assert.doesNotThrow(() => Controller.create({ RatioProfiles, getScenes: () => [] }).setPlatformPreview('youtube'), 'optional DOM and missing scene are safe');

console.log('Step04 ratio crop controller tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
