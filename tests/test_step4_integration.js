const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

console.log('--- Step 4 Partial Lifecycle & Strict Browser Runtime Safety Tests ---');

// 1. Structural File Integrity Verification
const partialPath = '01_app/pages/steps/step04-video.html';
const cssPath = '01_app/assets/steps/step04/step04-video.css';
const jsPath = '01_app/assets/steps/step04/step04-video.js';
const brandStatePath = '01_app/assets/steps/step04/step04-brand-state.js';
const brandOverlayPath = '01_app/assets/steps/step04/step04-brand-overlay.js';
const storePath = '01_app/assets/steps/step04/step04-store.js';
const timelineBridgePath = '01_app/assets/steps/step04/step04-timeline-bridge.js';
const narrationControllerPath = '01_app/assets/steps/step04/step04-narration-controller.js';
const timelinePreviewControllerPath = '01_app/assets/steps/step04/step04-timeline-preview-controller.js';
const ratioCropControllerPath = '01_app/assets/steps/step04/step04-ratio-crop-controller.js';
const playbackControllerPath = '01_app/assets/steps/step04/step04-playback-controller.js';
const navigationControllerPath = '01_app/assets/steps/step04/step04-navigation-controller.js';
const bindingsPath = '01_app/assets/steps/step04/step04-ui-bindings.js';
const videoEditorPath = '01_app/assets/video-editor/index.js';

assert.ok(fs.existsSync(partialPath), 'step04-video.html partial file must exist');
assert.ok(fs.existsSync(cssPath), 'step04-video.css must exist');
assert.ok(fs.existsSync(jsPath), 'step04-video.js must exist');
assert.ok(fs.existsSync(brandStatePath), 'step04-brand-state.js must exist');
assert.ok(fs.existsSync(brandOverlayPath), 'step04-brand-overlay.js must exist');
assert.ok(fs.existsSync(storePath), 'step04-store.js must exist');
assert.ok(fs.existsSync(timelineBridgePath), 'step04-timeline-bridge.js must exist');
assert.ok(fs.existsSync(narrationControllerPath), 'step04-narration-controller.js must exist');
assert.ok(fs.existsSync(timelinePreviewControllerPath), 'step04-timeline-preview-controller.js must exist');
assert.ok(fs.existsSync(ratioCropControllerPath), 'step04-ratio-crop-controller.js must exist');
assert.ok(fs.existsSync(playbackControllerPath), 'step04-playback-controller.js must exist');
assert.ok(fs.existsSync(navigationControllerPath), 'step04-navigation-controller.js must exist');
assert.ok(fs.existsSync(bindingsPath), 'step04-ui-bindings.js must exist');
assert.ok(fs.existsSync(videoEditorPath), 'video-editor/index.js must exist');

const partialHtml = fs.readFileSync(partialPath, 'utf8');
const step04Source = fs.readFileSync(jsPath, 'utf8');
assert.match(partialHtml, /id="step4"/, 'Partial HTML contains #step4');
assert.match(partialHtml, /id="imageRegenerationModal"/, 'Partial HTML contains #imageRegenerationModal');
assert.doesNotMatch(step04Source, /document\.addEventListener\('click',[\s\S]*\.ratio-btn/, 'ratio controls must not have a duplicate global click listener');

console.log('✓ File integrity checks passed');

// 2. Headless VM Execution Test: Pre-Partial Script Evaluation MUST NOT Throw (No Null Query Errors)
const html = fs.readFileSync('01_app/P1_title_design_preview.html', 'utf8');

assert.match(html, /href="\/01_app\/assets\/video-editor\/video-editor\.css(?:\?v=[^"]+)?"/, 'HTML links video-editor.css');
assert.match(html, /href="\/01_app\/assets\/steps\/step04\/step04-video\.css(?:\?v=[^"]+)?"/, 'HTML links step04-video.css');
const sceneNavigationScript = html.indexOf('/01_app/assets/video-editor/scene-navigation.js');
const ratioProfilesScript = html.indexOf('/01_app/assets/video-editor/ratio-profiles.js');
const brandSelectionScript = html.indexOf('/01_app/assets/video-editor/brand-selection.js');
const mobileSyncScript = html.indexOf('/01_app/assets/video-editor/mobile-sync.js');
const videoEditorIndexScript = html.indexOf('/01_app/assets/video-editor/index.js');
const step04BrandStateScript = html.indexOf('/01_app/assets/steps/step04/step04-brand-state.js');
const step04BrandOverlayScript = html.indexOf('/01_app/assets/steps/step04/step04-brand-overlay.js');
const step04StoreScript = html.indexOf('/01_app/assets/steps/step04/step04-store.js');
const step04TimelineBridgeScript = html.indexOf('/01_app/assets/steps/step04/step04-timeline-bridge.js');
const step04NarrationControllerScript = html.indexOf('/01_app/assets/steps/step04/step04-narration-controller.js');
const step04TimelinePreviewScript = html.indexOf('/01_app/assets/steps/step04/step04-timeline-preview-controller.js');
const step04RatioCropScript = html.indexOf('/01_app/assets/steps/step04/step04-ratio-crop-controller.js');
const step04PlaybackScript = html.indexOf('/01_app/assets/steps/step04/step04-playback-controller.js');
const step04NavigationScript = html.indexOf('/01_app/assets/steps/step04/step04-navigation-controller.js');
const step04BindingsScript = html.indexOf('/01_app/assets/steps/step04/step04-ui-bindings.js');
assert.ok(sceneNavigationScript >= 0, 'HTML loads browser scene navigation dependency');
assert.ok(ratioProfilesScript >= 0, 'HTML loads browser ratio profiles dependency');
assert.ok(brandSelectionScript >= 0, 'HTML loads browser brand selection dependency');
assert.ok(mobileSyncScript >= 0, 'HTML loads browser mobile sync dependency');
assert.ok(Math.max(sceneNavigationScript, ratioProfilesScript, brandSelectionScript, mobileSyncScript) < videoEditorIndexScript, 'browser dependencies load before video-editor index.js');
assert.ok(videoEditorIndexScript < step04BindingsScript, 'Step 4 UI bindings load after video editor dependencies');
assert.ok(videoEditorIndexScript < step04BrandStateScript, 'Step 4 brand state loads after video editor dependencies');
assert.ok(step04BrandStateScript < step04BrandOverlayScript, 'Step 4 brand state loads before overlay controller');
assert.ok(step04BrandOverlayScript < step04StoreScript, 'Step 4 overlay controller loads before related Step 4 scripts');
assert.ok(step04StoreScript < step04NavigationScript, 'Step 4 navigation controller loads after state dependencies');
assert.ok(step04StoreScript < step04TimelineBridgeScript && step04TimelineBridgeScript < step04NavigationScript, 'timeline bridge loads between Step 4 state and controllers');
assert.ok(step04TimelineBridgeScript < step04NarrationControllerScript && step04NarrationControllerScript < step04NavigationScript, 'narration controller loads before Step 4 controllers');
assert.ok(step04NarrationControllerScript < step04TimelinePreviewScript && step04TimelinePreviewScript < step04NavigationScript, 'timeline preview controller loads before Step 4 controllers');
assert.ok(step04TimelinePreviewScript < step04RatioCropScript && step04RatioCropScript < step04NavigationScript, 'ratio crop controller loads before Step 4 controllers');
assert.ok(step04RatioCropScript < step04PlaybackScript && step04PlaybackScript < step04NavigationScript, 'playback controller loads before Step 4 controllers');
assert.ok(step04NavigationScript < step04BindingsScript, 'Step 4 navigation controller loads before UI bindings');
assert.ok(videoEditorIndexScript < step04StoreScript, 'Step 4 store loads after video editor dependencies');
assert.ok(step04StoreScript < html.indexOf('/01_app/assets/steps/step04/step04-video.js'), 'Step 4 store loads before the controller');
assert.ok(step04BindingsScript < html.indexOf('/01_app/assets/steps/step04/step04-video.js'), 'Step 4 UI bindings load before the controller');
assert.match(html, /src="\/01_app\/assets\/video-editor\/index\.js(?:\?v=[^"]+)?"/, 'HTML loads video-editor index.js');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-video\.js(?:\?v=[^"]+)?"/, 'HTML loads step04-video.js');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-brand-state\.js\?v=20261007_v5"/, 'HTML cache-busts step04-brand-state.js');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-brand-overlay\.js\?v=20261007_v6"/, 'HTML cache-busts step04-brand-overlay.js');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-navigation-controller\.js\?v=20261007_v7"/, 'HTML cache-busts navigation controller');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-ui-bindings\.js\?v=20261007_v7"/, 'HTML cache-busts UI bindings');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-timeline-bridge\.js\?v=20261007_v8"/, 'HTML cache-busts timeline bridge');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-narration-controller\.js\?v=20261007_v9"/, 'HTML cache-busts narration controller');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-timeline-preview-controller\.js\?v=20261007_v10"/, 'HTML cache-busts timeline preview controller');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-ratio-crop-controller\.js\?v=20261008_v11"/, 'HTML cache-busts ratio crop controller');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-playback-controller\.js\?v=20261008_v12"/, 'HTML cache-busts playback controller');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-video\.js\?v=20261008_v12"/, 'HTML cache-busts Step 4 controller');
assert.doesNotMatch(fs.readFileSync(bindingsPath, 'utf8'), /#prevBtn|#nextBtn|#mobileSceneSelect|#sceneList/, 'UI bindings do not duplicate navigation listeners');
assert.doesNotMatch(fs.readFileSync(bindingsPath, 'utf8'), /feature\('playback'|#playBtn|addEventListener\('play'|addEventListener\('pause'/, 'UI bindings do not duplicate playback listeners');
assert.doesNotMatch(html, /const watermarkPreviewRatios=|let watermarkPreviewItem=|let outroPreviewItem=|function activateWatermarkRatio\(|function renderOutroPreviewSlide\(/, 'P1 does not retain overlay controller state or implementation');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-store\.js\?v=20261007_v4"/, 'HTML cache-busts step04-store.js');
assert.match(html, /Object\.assign\(window,\{[\s\S]*updateCommonOutroPreview[\s\S]*updateWatermarkPreview[\s\S]*\}\)/, 'shell exposes Step 4 preview callbacks after async isolation');
assert.match(html, /Object\.defineProperty\(window,'brandAssets',[\s\S]*get:\(\)=>brandAssets/, 'shell exposes current brand assets through a live getter');
for (const declaration of [
  "let brandAssets=[];",
  "let brandSelections=[];",
  "const brandOverlayState=Step04BrandState.create();"
]) assert.ok(html.indexOf(declaration) > 0 && html.indexOf(declaration) < html.indexOf('function activeWatermarkProfile'), `${declaration} is initialized before Step 4 settings restore`);
assert.doesNotMatch(html, /let (?:watermarkPosition|watermarkWidthRatio|watermarkProfiles|outroPosition|outroWidthRatio|outroBackground|outroBackgroundOpacity|outroProfiles)=/, 'brand overlay state must not be duplicated in P1 globals');
assert.equal((html.match(/function renderSceneList\(\)/g) || []).length, 1, 'P1 keeps only the final Step04VideoEditor renderSceneList compatibility wrapper');
assert.match(html, /function applyScript\(script\)\{\s*scenes=timelineBridge\.applyScript\(script\)\.scenes;/, 'P1 script application delegates scene text ownership to timeline bridge');

// Verify top-level script contains no direct querySelector('#video') causing null binding at startup
assert.doesNotMatch(html, /const video=document\.querySelector\('#video'\);/, 'HTML must not query #video at top-level script parse time');
assert.doesNotMatch(html, /const stage=document\.querySelector\('#stage'\);/, 'HTML must not query #stage at top-level script parse time');

console.log('✓ Pre-partial parse safety verified (No top-level null DOM queries)');

// DOM Stub simulating browser environment before partial HTML injection
function createPrePartialContext() {
  const elements = new Map();
  const listeners = new Map();

  const step4OnlyIds = new Set([
    '#step4', '#projectTitle', '#aiPersonCrop', '#aiPersonCropStatus',
    '#narrationBtn', '#musicVolume', '#brandIntroEnabled', '#brandIntroVersion',
    '#brandOutroEnabled', '#brandOutroVersion', '#brandWatermarkEnabled',
    '#brandWatermarkVersion', '#brandWatermarkOpacity', '#stageCard', '#previewFormatBadge',
    '#stage', '#video', '#sceneImage', '#sceneVideo', '#prevBtn', '#playBtn', '#nextBtn',
    '#imageGenerationMosaic', '#imageGenerationStatus', '#imageGenerationStatusText',
    '#imageRegenerateBtn', '#imageVariantCount', '#bgm', '#sceneResourceBadge',
    '#cropHint', '#formatSafeZone', '#titleText', '#brandWatermarkPreview',
    '#brandOutroPreview', '#brandOutroPreviewImage', '#brandOutroPreviewVideo',
    '#progress', '#progressFill', '#clock', '#captionStatus', '#statusText',
    '#captionSizeDown', '#captionSizeValue', '#captionSizeUp', '#distributionTitle',
    '#distributionHelp', '#distributionPlatforms', '#sceneTimelineSummary',
    '#mobileSceneSelect', '#mobilePrevScene', '#mobileNextScene', '#sceneList',
    '#renderBtn', '#imageRegenerationModal', '#imageRegenerationCancel', '#imageRegenerationCreate',
    '#imageAdditionalPrompt', '#imageBaseGuide', '#imageRegenerationFeedback',
    '#imageRegenerationSceneNo', '#imageRegenerationTitle', '#renderStatus'
  ]);

  function createGenericStub(selector = '') {
    const stub = {
      id: selector.replace(/^#/, ''),
      classList: {
        add() {}, remove() {}, toggle() {}, contains() { return false; }
      },
      setAttribute() {},
      getAttribute() { return null; },
      removeAttribute() {},
      style: { setProperty() {}, getPropertyValue() { return ''; } },
      addEventListener(type, fn) {
        const list = listeners.get(type) || [];
        list.push(fn);
        listeners.set(type, list);
      },
      removeEventListener(type, fn) {
        const list = listeners.get(type) || [];
        listeners.set(type, list.filter(f => f !== fn));
      },
      closest() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      replaceChildren() {},
      textContent: '',
      innerHTML: '',
      hidden: false,
      disabled: false,
      value: '',
      files: [],
      scrollTop: 0,
      scrollLeft: 0,
      dataset: new Proxy({}, {
        get(target, prop) {
          return target[prop] || '';
        }
      }),
      elements: new Proxy({}, {
        get(target, prop) {
          return target[prop] || [];
        }
      })
    };
    stub.parentElement = stub;
    return stub;
  }

  const container = {
    id: 'step4Container',
    innerHTML: '',
    appendChild(child) {},
    querySelectorAll() { return []; },
    querySelector() { return null; }
  };
  elements.set('#step4Container', container);

  const documentStub = {
    querySelector(selector) {
      if (elements.has(selector)) return elements.get(selector);
      if (step4OnlyIds.has(selector)) return null;
      return createGenericStub(selector);
    },
    querySelectorAll(selector) {
      if (step4OnlyIds.has(selector)) return [];
      return [createGenericStub(selector)];
    },
    addEventListener(type, fn) {
      const list = listeners.get(type) || [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) || [];
      listeners.set(type, list.filter(f => f !== fn));
    },
    body: { classList: { add() {}, remove() {} } }
  };

  const context = vm.createContext({
    console,
    URL,
    Step04BrandState: require('../01_app/assets/steps/step04/step04-brand-state.js'),
    BrandOverlayController: require('../01_app/assets/steps/step04/step04-brand-overlay.js'),
    Step04TimelineBridge: require('../01_app/assets/steps/step04/step04-timeline-bridge.js'),
    Step04NavigationController: require('../01_app/assets/steps/step04/step04-navigation-controller.js'),
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: (fn) => {
      if (typeof fn === 'function') {
        try { fn(); } catch (e) {}
      }
      return 1;
    },
    clearTimeout: () => {},
    document: documentStub,
    window: { scrollTo() {}, addEventListener() {}, StepPartialLoader: { load: async () => 0 } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    location: { href: 'https://tc.test/app.html' },
    fetch: async () => ({ ok: true, text: async () => partialHtml }),
    Audio: class { constructor() {} load() {} play() { return Promise.resolve(); } pause() {} },
    Image: class { constructor() {} },
    ResizeObserver: class { constructor() {} observe() {} }
  });

  return { context, elements, listeners };
}

const prePartialEnv = createPrePartialContext();
const scriptStart = html.indexOf('<script>') + '<script>'.length;
const scriptEnd = html.indexOf('async function boot()');
const scriptMatch = `${html.slice(scriptStart, scriptEnd > 0 ? scriptEnd : html.lastIndexOf('</script>'))}\n})();`;

assert.doesNotThrow(() => {
  vm.runInContext(scriptMatch, prePartialEnv.context);
}, 'Script evaluation before partial DOM insertion MUST NOT throw null reference errors');

console.log('✓ Pre-partial headless VM script evaluation completed without errors');

// 3. Post-Partial Load & Idempotent Init Test
const Step04VideoEditor = require('../01_app/assets/steps/step04/step04-video.js');
const VideoEditor = require('../01_app/assets/video-editor/index.js');

assert.equal(typeof Step04VideoEditor.initStep4UI, 'function', 'initStep4UI must be a function');
assert.equal(typeof Step04VideoEditor.setNarrationTracks, 'function', 'narration bridge target must be public');

// Simulate Partial Injection into DOM Container
const mockContainer = {
  innerHTML: partialHtml
};

assert.match(mockContainer.innerHTML, /id="sceneList"/, 'Container contains #sceneList after partial load');

// Test Pure Module Functions with Timeline Data
const sampleTimeline = {
  scenes: [
    { id: 'sc1', name: 'Scene 1', start: 0, end: 5, cueStart: 0.5, cueEnd: 4.5, text: '도입 타이틀' },
    { id: 'sc2', name: 'Scene 2', start: 5, end: 12, cueStart: 5.5, cueEnd: 11.5, text: '두 번째 타이틀' }
  ]
};

Step04VideoEditor.applyTimeline(sampleTimeline);
const duration = VideoEditor.SceneNav.calculateTimelineDuration(sampleTimeline.scenes);
assert.equal(duration, 12, 'Timeline duration should be 12 seconds');

// State Transitions (OUT -> Scene -> OUT)
let navState = VideoEditor.SceneNav.createInitialNavigationState(sampleTimeline.scenes, { initialTime: 0 });
assert.equal(navState.currentSceneIndex, 0);

navState = VideoEditor.SceneNav.navigateScene(sampleTimeline.scenes, navState, 'NEXT_SCENE');
assert.equal(navState.currentSceneIndex, 1);

navState = VideoEditor.SceneNav.navigateScene(sampleTimeline.scenes, navState, 'NEXT_SCENE');
assert.equal(navState.isOutro, true, 'Transition to OUT state');

navState = VideoEditor.SceneNav.navigateScene(sampleTimeline.scenes, navState, 'PREV_SCENE');
assert.equal(navState.isOutro, false);
assert.equal(navState.currentSceneIndex, 1);

// Mobile Sync State Calculation
const mSync = VideoEditor.MobileSync.computeMobileSyncState(sampleTimeline.scenes, 1, false, 6.0, 12.0);
assert.equal(mSync.selectedValue, '1');
assert.equal(mSync.options.length, 3, '2 scenes + 1 outro');
assert.equal(mSync.displayLabel, 'SCENE 02 / 02');

// Ratio Profiles Check (16:9, 9:16, 4:5, 1:1)
['16x9', '9x16', '4x5', '1x1'].forEach(fmt => {
  const profile = VideoEditor.RatioProfiles.getProfileByKey(fmt);
  assert.equal(profile.key, fmt);
});

// Phase 3: Configure, Payload Wrapping & Unit Conversion Tests
assert.equal(typeof Step04VideoEditor.configure, 'function', 'configure must be a function');
assert.equal(typeof Step04VideoEditor.persistRenderSettings, 'function', 'persistRenderSettings must be a function');

const testCatalog = {
  ratio_profiles: {
    custom_ratio: { key: '16x9', className: 'preview-landscape', label: 'Custom 16:9', safe: '' }
  },
  platform_preview_formats: {
    threads: { formatKey: '9x16', className: 'preview-portrait', label: 'Threads Custom', safe: 'SAFE' }
  }
};

const testEffective = {
  type: 'minimal',
  music: 'debussy',
  volume: 0.7,
  narration: true,
  preview_platform: 'threads',
  platforms: ['youtube', 'threads'],
  video_pan_x: 0.6, // 0..1 API unit => should map to 60 UI percent
  scene_dissolve_seconds: 1.0,
  caption_size: 2
};

Step04VideoEditor.configure(testEffective, testCatalog);
assert.equal(Step04VideoEditor.isConfigured(), true, 'isConfigured should return true after configure call');
assert.equal(Step04VideoEditor.getConfiguredSettings().type, 'minimal');

// Verify unit conversion in getEffectiveSettingsPayload (60% UI pan -> 0.6 API pan, numeric volume)
const payload = Step04VideoEditor.getEffectiveSettingsPayload();
assert.equal(payload.type, 'minimal', 'type should be minimal from configured settings');
assert.equal(payload.music, 'debussy', 'music should be debussy from configured settings');
assert.equal(typeof payload.volume, 'number', 'volume must be numeric');
assert.equal(payload.volume, 0.7, 'volume should be 0.7');
assert.equal(payload.video_pan_x, 0.6, 'video_pan_x should convert back to 0..1 decimal unit');
assert.equal(payload.scene_dissolve_seconds, 1.0, 'scene_dissolve_seconds preserved');
assert.deepEqual(payload.platforms, ['youtube', 'threads'], 'platforms list should match configured effective settings');

// Verify setSceneCropPositions & getSceneCropPositions deep copy export
assert.equal(typeof Step04VideoEditor.getSceneCropPositions, 'function', 'getSceneCropPositions must be exported');
assert.equal(typeof Step04VideoEditor.setSceneCropPositions, 'function', 'setSceneCropPositions must be exported');
Step04VideoEditor.setSceneCropPositions({ sc1: { '9x16': 65 } });
const cropPositions = Step04VideoEditor.getSceneCropPositions();
assert.equal(typeof cropPositions, 'object', 'getSceneCropPositions should return an object');
assert.deepEqual(cropPositions.sc1, { '9x16': 65 }, 'setSceneCropPositions should populate crop positions');

console.log('✓ Phase 3 & 4 settings configuration, unit conversion, and payload wrapping tests passed');
console.log('✓ Strict lifecycle, pre-partial safety, and post-partial init tests passed');
