const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Step04 = require('../01_app/assets/steps/step04/step04-video.js');

const browserContext = vm.createContext({ console });
browserContext.self = browserContext;
browserContext.globalThis = browserContext;
[
  '01_app/assets/video-editor/scene-navigation.js',
  '01_app/assets/video-editor/ratio-profiles.js',
  '01_app/assets/video-editor/brand-selection.js',
  '01_app/assets/video-editor/mobile-sync.js',
  '01_app/assets/video-editor/index.js',
  '01_app/assets/steps/step04/step04-brand-state.js',
  '01_app/assets/steps/step04/step04-brand-overlay.js',
  '01_app/assets/steps/step04/step04-store.js',
  '01_app/assets/steps/step04/step04-narration-controller.js',
  '01_app/assets/steps/step04/step04-timeline-preview-controller.js',
  '01_app/assets/steps/step04/step04-ratio-crop-controller.js',
  '01_app/assets/steps/step04/step04-playback-controller.js',
  '01_app/assets/steps/step04/step04-settings-controller.js',
  '01_app/assets/steps/step04/step04-style-controller.js',
  '01_app/assets/steps/step04/step04-timeline-orchestrator.js',
  '01_app/assets/steps/step04/step04-lifecycle-controller.js',
  '01_app/assets/steps/step04/step04-ui-actions-controller.js',
  '01_app/assets/steps/step04/step04-navigation-controller.js',
  '01_app/assets/steps/step04/step04-ui-bindings.js',
  '01_app/assets/steps/step04/step04-video.js'
].forEach(file => vm.runInContext(fs.readFileSync(file, 'utf8'), browserContext, { filename: file }));
assert.ok(browserContext.VideoEditor.SceneNav, 'browser bundle exposes scene navigation');
assert.ok(browserContext.VideoEditor.MobileSync, 'browser bundle exposes mobile synchronization');
assert.ok(browserContext.Step04BrandState, 'browser bundle exposes Step 4 brand state');
assert.ok(browserContext.BrandOverlayController, 'browser bundle exposes Step 4 brand overlay controller');
assert.ok(browserContext.Step04NavigationController, 'browser bundle exposes Step 4 navigation controller');
assert.ok(browserContext.Step04NarrationController, 'browser bundle exposes Step 4 narration controller');
assert.ok(browserContext.Step04TimelinePreviewController, 'browser bundle exposes Step 4 timeline preview controller');
assert.ok(browserContext.Step04RatioCropController, 'browser bundle exposes Step 4 ratio crop controller');
assert.ok(browserContext.Step04PlaybackController, 'browser bundle exposes Step 4 playback controller');
assert.ok(browserContext.Step04SettingsController, 'browser bundle exposes Step 4 settings controller');
assert.ok(browserContext.Step04StyleController, 'browser bundle exposes Step 4 style controller');
assert.ok(browserContext.Step04TimelineOrchestrator, 'browser bundle exposes Step 4 timeline orchestrator');
assert.ok(browserContext.Step04LifecycleController, 'browser bundle exposes Step 4 lifecycle controller');
assert.ok(browserContext.Step04UIActionsController, 'browser bundle exposes Step 4 UI actions controller');
assert.ok(browserContext.Step04VideoEditor, 'browser bundle initializes Step 4 after its dependencies');

const scenes = [
  { id: 'one', name: 'One', start: 0, end: 5, cueStart: 0.5, text: 'one' },
  { id: 'two', name: 'Two', start: 5, end: 12, cueStart: 5.5, text: 'two' }
];

Step04.applyTimeline({ scenes });

const videoListeners = {};
let mediaTime = 0;
let mediaSeekable = false;
const video = { paused: true, addEventListener(type, fn) { videoListeners[type] = fn; }, play() {}, pause() {} };
Object.defineProperty(video, 'currentTime', {
  get() { return mediaTime; },
  set(value) { if (mediaSeekable) mediaTime = value; }
});
const sceneListListeners = {};
const sceneList = { innerHTML: '', addEventListener(type, fn) { sceneListListeners[type] = fn; }, removeEventListener() {} };
const mobileSelect = { innerHTML: '', value: '' };
const nextBtn = { disabled: false, addEventListener(type, fn) { this[type] = fn; }, removeEventListener() {} };
const prevBtn = { disabled: false, addEventListener(type, fn) { this[type] = fn; }, removeEventListener() {} };
const originalDocument = global.document;
const originalWindow = global.window;
let outroRefreshes = 0;
let watermarkRefreshes = 0;
const stageCard = {
  className: 'stage-card preview-landscape',
  classList: {
    remove() { stageCard.className = 'stage-card'; },
    add(name) { stageCard.className += ` ${name}`; }
  }
};
global.window = {
  updateCommonOutroPreview() { outroRefreshes += 1; },
  updateWatermarkPreview() { watermarkRefreshes += 1; }
};
global.document = {
  querySelector(selector) {
    if (selector === '#step4') return { id: 'step4' };
    if (selector === '#video') return video;
    if (selector === '#sceneList') return sceneList;
    if (selector === '#nextBtn') return nextBtn;
    if (selector === '#prevBtn') return prevBtn;
    if (selector === '#mobileSceneSelect') return mobileSelect;
    if (selector === '#stageCard' || selector === '.stage-card') return stageCard;
    return null;
  },
  querySelectorAll() { return []; }
};

try {
  assert.equal(Step04.initStep4UI(), true, 'partial lifecycle mounts navigation before scene rendering');
  Step04.renderSceneList();
  assert.match(sceneList.innerHTML, /data-index="0"/);
  assert.match(sceneList.innerHTML, /data-index="1"/);
  assert.match(sceneList.innerHTML, /data-outro="true"/);
  assert.match(mobileSelect.innerHTML, /value="outro"/);

  nextBtn.click();
  assert.equal(video.currentTime, 0, 'unseekable media clock remains unchanged');
  assert.equal(Step04.currentNavigationState().currentSceneIndex, 1, 'mounted next listener advances logical preview');
  prevBtn.click();
  assert.equal(Step04.currentNavigationState().currentSceneIndex, 0, 'mounted previous listener moves logical preview back');
  sceneListListeners.click({ target: { closest: () => ({ dataset: { index: '1' } }) } });
  assert.equal(Step04.currentNavigationState().currentSceneIndex, 1, 'mounted scene-list delegation updates logical preview');
  sceneListListeners.click({ target: { closest: () => ({ dataset: { outro: 'true' } }) } });
  assert.equal(Step04.currentNavigationState().isOutro, true, 'mounted scene-list delegation activates OUT logically');
  mediaSeekable = true;
  Step04.navigatePreview({ type: 'SEEK_SCENE', index: 0 });
  video.currentTime = 0;

  let state = Step04.navigatePreview('NEXT_SCENE');
  assert.equal(state.currentSceneIndex, 1);
  assert.equal(state.isOutro, false);
  assert.equal(video.currentTime, 5.55);

  state = Step04.navigatePreview('NEXT_SCENE');
  assert.equal(state.isOutro, true, 'last scene next enters OUT');
  assert.equal(video.currentTime, 11.95);

  state = Step04.navigatePreview('PREV_SCENE');
  assert.equal(state.isOutro, false, 'OUT previous returns to last scene');
  assert.equal(state.currentSceneIndex, 1);
  assert.equal(video.currentTime, 5.55);

  state = Step04.navigatePreview({ type: 'SEEK_OUTRO' });
  assert.equal(state.isOutro, true, 'scene can return directly to OUT');
  assert.equal(video.currentTime, 11.95);

  const outroBaseline = outroRefreshes;
  const watermarkBaseline = watermarkRefreshes;
  Step04.setPlatformPreview('instagram');
  assert.match(stageCard.className, /preview-portrait/, 'ratio selection updates the preview frame');
  assert.equal(outroRefreshes, outroBaseline + 1, 'ratio selection refreshes the ratio-specific outro');
  assert.equal(watermarkRefreshes, watermarkBaseline + 1, 'ratio selection refreshes the ratio-specific watermark');

  global.window.updateWatermarkPreview = () => { throw new Error('isolated watermark failure'); };
  assert.doesNotThrow(() => Step04.setPlatformPreview('youtube'), 'watermark failure must not stop ratio navigation');
  assert.equal(outroRefreshes, outroBaseline + 2, 'outro refresh continues when watermark refresh fails');
} finally {
  global.document = originalDocument;
  global.window = originalWindow;
}

console.log('Step 4 preview navigation integration passed');
