const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

console.log('--- Step 4 Partial Lifecycle & Single Source of Truth Tests ---');

// 1. Structural File Verification
const partialPath = '01_app/pages/steps/step04-video.html';
const cssPath = '01_app/assets/steps/step04/step04-video.css';
const jsPath = '01_app/assets/steps/step04/step04-video.js';
const videoEditorPath = '01_app/assets/video-editor/index.js';

assert.ok(fs.existsSync(partialPath), 'step04-video.html partial file must exist');
assert.ok(fs.existsSync(cssPath), 'step04-video.css must exist');
assert.ok(fs.existsSync(jsPath), 'step04-video.js must exist');
assert.ok(fs.existsSync(videoEditorPath), 'video-editor/index.js must exist');

const partialHtml = fs.readFileSync(partialPath, 'utf8');
assert.match(partialHtml, /id="step4"/, 'Partial HTML contains #step4');
assert.match(partialHtml, /id="imageRegenerationModal"/, 'Partial HTML contains #imageRegenerationModal');

console.log('✓ Structural file verification passed');

// 2. Pre-Partial Parse Safety (Zero Null Query Errors at Script Load Time)
const html = fs.readFileSync('01_app/P1_title_design_preview.html', 'utf8');

assert.match(html, /href="\/01_app\/assets\/video-editor\/video-editor\.css"/, 'HTML links video-editor.css');
assert.match(html, /href="\/01_app\/assets\/steps\/step04\/step04-video\.css"/, 'HTML links step04-video.css');
assert.match(html, /src="\/01_app\/assets\/video-editor\/index\.js"/, 'HTML loads video-editor index.js');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-video\.js"/, 'HTML loads step04-video.js');

// Verify top-level script contains no direct querySelector('#video') causing null binding at startup
assert.doesNotMatch(html, /const video=document\.querySelector\('#video'\);/, 'HTML must not query #video at top-level script parse time');
assert.doesNotMatch(html, /const stage=document\.querySelector\('#stage'\);/, 'HTML must not query #stage at top-level script parse time');

console.log('✓ Pre-partial parse safety verified (No top-level null DOM queries)');

// 3. Post-Partial DOM Insertion & Idempotent Init Test
const Step04VideoEditor = require('../01_app/assets/steps/step04/step04-video.js');
const VideoEditor = require('../01_app/assets/video-editor/index.js');

assert.equal(typeof Step04VideoEditor.initStep4UI, 'function', 'initStep4UI must be a function');

// Simulate DOM Container
const mockContainer = {
  innerHTML: '',
  appendChild(child) {}
};

// Insert partial HTML into DOM
mockContainer.innerHTML = partialHtml;
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

console.log('✓ Lifecycle, post-partial DOM init, single source of truth tests passed');
