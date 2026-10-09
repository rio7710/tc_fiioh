const assert = require('node:assert/strict');
const path = require('node:path');

const videoEditor = require('../01_app/assets/video-editor/index.js');
const { SceneNav, RatioProfiles, BrandSelection, MobileSync } = videoEditor;

const mockScenes = [
  { id: 's1', name: 'Scene 1', start: 0, end: 4, cueStart: 0.5, cueEnd: 3.5, text: '첫 번째 장면 타이틀' },
  { id: 's2', name: 'Scene 2', start: 4, end: 9, cueStart: 4.5, cueEnd: 8.5, text: '두 번째 장면 타이틀' },
  { id: 's3', name: 'Scene 3', start: 9, end: 15, cueStart: 9.5, cueEnd: 14.5, text: '' }
];

console.log('--- Step 4 Video Editor Pure State Regression Tests ---');

// 1. Scene Navigation & OUT -> scene -> OUT Tests
console.log('Testing Scene Navigation & OUT -> scene -> OUT transitions...');
{
  const duration = SceneNav.calculateTimelineDuration(mockScenes);
  assert.equal(duration, 15, 'Total duration should be 15 seconds');

  assert.equal(SceneNav.findSceneAtTime(mockScenes, 0), 0);
  assert.equal(SceneNav.findSceneAtTime(mockScenes, 2), 0);
  assert.equal(SceneNav.findSceneAtTime(mockScenes, 4), 1);
  assert.equal(SceneNav.findSceneAtTime(mockScenes, 10), 2);
  assert.equal(SceneNav.findSceneAtTime(mockScenes, 16), 2);

  // Outro active test (threshold: duration - 2.0 = 13.0s)
  assert.equal(SceneNav.isOutroActive(12.9, duration, true), false);
  assert.equal(SceneNav.isOutroActive(13.0, duration, true), true);
  assert.equal(SceneNav.isOutroActive(14.5, duration, true), true);
  assert.equal(SceneNav.isOutroActive(14.5, duration, false), false);

  // Seek time calculations
  assert.equal(SceneNav.calculateSceneSeekTime(mockScenes[0]), 0.55); // cueStart + 0.05
  assert.equal(SceneNav.calculateSceneSeekTime(mockScenes[2]), 9.05); // start + 0.05 (no text)
  assert.equal(
    SceneNav.calculateSceneSeekTime({start: 4, end: 7, cueStart: 0, text: 'shared narration'}),
    4.05,
    'a shared narration cue must not seek backward before the visual scene'
  );
  assert.equal(SceneNav.calculateOutroSeekTime(duration), 14.95);

  // Initial state at start
  let state = SceneNav.createInitialNavigationState(mockScenes, { initialTime: 0, outroEnabled: true });
  assert.equal(state.currentSceneIndex, 0);
  assert.equal(state.isOutro, false);
  assert.equal(state.canPrev, false, 'Scene 0 cannot go prev');
  assert.equal(state.canNext, true, 'Scene 0 can go next');

  // Forward Navigation Cycle: Scene 0 -> Scene 1 -> Scene 2 -> OUT
  state = SceneNav.navigateScene(mockScenes, state, 'NEXT_SCENE');
  assert.equal(state.currentSceneIndex, 1);
  assert.equal(state.isOutro, false);
  assert.equal(state.canPrev, true);
  assert.equal(state.canNext, true);

  state = SceneNav.navigateScene(mockScenes, state, 'NEXT_SCENE');
  assert.equal(state.currentSceneIndex, 2);
  assert.equal(state.isOutro, false);
  assert.equal(state.canPrev, true);
  assert.equal(state.canNext, true, 'Last scene can go next to OUT');

  // Transition to OUT
  state = SceneNav.navigateScene(mockScenes, state, 'NEXT_SCENE');
  assert.equal(state.isOutro, true, 'Should be in OUT state');
  assert.equal(state.canPrev, true, 'OUT can go prev back to last scene');
  assert.equal(state.canNext, false, 'OUT cannot go next');
  assert.equal(state.currentTime, 14.95);

  // Backward Navigation Cycle: OUT -> Scene 2 -> Scene 1 -> Scene 0
  state = SceneNav.navigateScene(mockScenes, state, 'PREV_SCENE');
  assert.equal(state.isOutro, false);
  assert.equal(state.currentSceneIndex, 2);

  state = SceneNav.navigateScene(mockScenes, state, 'PREV_SCENE');
  assert.equal(state.currentSceneIndex, 1);

  state = SceneNav.navigateScene(mockScenes, state, 'PREV_SCENE');
  assert.equal(state.currentSceneIndex, 0);
  assert.equal(state.canPrev, false);

  // Direct OUT -> scene -> OUT jump
  state = SceneNav.navigateScene(mockScenes, state, 'SEEK_OUTRO');
  assert.equal(state.isOutro, true);

  state = SceneNav.navigateScene(mockScenes, state, { type: 'SEEK_SCENE', index: 1 });
  assert.equal(state.isOutro, false);
  assert.equal(state.currentSceneIndex, 1);

  state = SceneNav.navigateScene(mockScenes, state, 'SEEK_OUTRO');
  assert.equal(state.isOutro, true);

  console.log('✓ Scene Navigation & OUT -> scene -> OUT tests passed');
}

// 2. Mobile Sync Tests
console.log('Testing Mobile Sync state calculation and resolution...');
{
  const duration = 15;
  // Scene 0 active
  let mobileState = MobileSync.computeMobileSyncState(mockScenes, 0, false, 0.55, duration, true);
  assert.equal(mobileState.selectedValue, '0');
  assert.equal(mobileState.prevDisabled, true);
  assert.equal(mobileState.nextDisabled, false);
  assert.equal(mobileState.options.length, 4, '3 scenes + 1 outro option');
  assert.equal(mobileState.options[3].value, 'outro');
  assert.equal(mobileState.displayLabel, 'SCENE 01 / 03');

  // OUT active
  mobileState = MobileSync.computeMobileSyncState(mockScenes, 2, true, 14.95, duration, true);
  assert.equal(mobileState.selectedValue, 'outro');
  assert.equal(mobileState.prevDisabled, false);
  assert.equal(mobileState.nextDisabled, true);
  assert.equal(mobileState.displayLabel, 'OUTRO (00:15)');

  // Dropdown selection resolution
  let action = MobileSync.resolveMobileSelectChange('1', mockScenes);
  assert.deepEqual(action, { type: 'SEEK_SCENE', index: 1 });

  action = MobileSync.resolveMobileSelectChange('outro', mockScenes);
  assert.deepEqual(action, { type: 'SEEK_OUTRO' });

  action = MobileSync.resolveMobileSelectChange('invalid', mockScenes);
  assert.deepEqual(action, { type: 'SEEK_SCENE', index: 0 });

  console.log('✓ Mobile Sync tests passed');
}

// 3. Ratio Profiles & Pan Availability (16x9, 9x16, 4x5, 1x1) Tests
console.log('Testing Ratio Profiles (16x9, 9x16, 4x5, 1x1)...');
{
  const requiredProfiles = ['16x9', '9x16', '4x5', '1x1'];
  requiredProfiles.forEach(key => {
    const profile = RatioProfiles.getProfileByKey(key);
    assert.equal(profile.key, key, `Profile ${key} key check`);
    assert.ok(profile.aspectRatio > 0, `Profile ${key} aspect ratio check`);
    assert.ok(profile.width > 0 && profile.height > 0, `Profile ${key} dimension check`);
  });

  // Check specific specs for all 4 ratio profiles
  const p169 = RatioProfiles.getProfileByKey('16x9');
  assert.equal(p169.className, 'preview-landscape');
  assert.equal(p169.aspectRatio, 16 / 9);

  const p916 = RatioProfiles.getProfileByKey('9x16');
  assert.equal(p916.className, 'preview-portrait');
  assert.equal(p916.safeZoneLabel, 'REELS SAFE AREA');
  assert.equal(p916.aspectRatio, 9 / 16);

  const p45 = RatioProfiles.getProfileByKey('4x5');
  assert.equal(p45.className, 'preview-feed');
  assert.equal(p45.safeZoneLabel, 'FEED SAFE AREA');
  assert.equal(p45.aspectRatio, 4 / 5);

  const p11 = RatioProfiles.getProfileByKey('1x1');
  assert.equal(p11.className, 'preview-square');
  assert.equal(p11.safeZoneLabel, 'SQUARE SAFE AREA');
  assert.equal(p11.aspectRatio, 1.0);

  const ratioInputs = {
    '16x9': 'preview-landscape',
    '9x16': 'preview-portrait',
    '4x5': 'preview-feed',
    '1x1': 'preview-square'
  };
  Object.entries(ratioInputs).forEach(([key, className]) => {
    assert.equal(RatioProfiles.calculateCropFormat(key), key, `${key} key resolves`);
    assert.equal(RatioProfiles.calculateCropFormat(className), key, `${className} single class resolves`);
    assert.equal(RatioProfiles.calculateCropFormat(`stage-card ${className} active`), key, `${className} multi-class DOM string resolves`);
  });
  assert.equal(RatioProfiles.calculateCropFormat('stage-card unknown-class'), '16x9', 'unknown DOM classes keep the landscape fallback');

  // Platform mapping
  assert.equal(RatioProfiles.getProfileByPlatform('youtube').key, '16x9');
  assert.equal(RatioProfiles.getProfileByPlatform('instagram').key, '9x16');
  assert.equal(RatioProfiles.getProfileByPlatform('facebook').key, '4x5');
  assert.equal(RatioProfiles.getProfileByPlatform('tiktok').key, '9x16');
  assert.equal(RatioProfiles.getProfileByPlatform('threads').key, '9x16');
  assert.equal(RatioProfiles.getProfileByPlatform('linkedin').key, '4x5');
  assert.equal(RatioProfiles.getProfileByPlatform('square').key, '1x1');

  // Pan availability
  // Landscape source (1920x1080) in vertical/feed/square vs 16x9
  assert.equal(RatioProfiles.calculatePanAvailability('16x9', 1920, 1080), false, '16x9 target cannot pan landscape source');
  assert.equal(RatioProfiles.calculatePanAvailability('9x16', 1920, 1080), true, '9x16 target can pan landscape source');
  assert.equal(RatioProfiles.calculatePanAvailability('4x5', 1920, 1080), true, '4x5 target can pan landscape source');
  assert.equal(RatioProfiles.calculatePanAvailability('1x1', 1920, 1080), true, '1x1 target can pan landscape source');
  assert.equal(RatioProfiles.calculatePanAvailability('9x16', 1080, 1920), false, 'Portrait target cannot pan portrait source');

  // Video pan clamping & storage
  assert.equal(RatioProfiles.clampVideoPan(25), 25);
  assert.equal(RatioProfiles.clampVideoPan(-10), 0);
  assert.equal(RatioProfiles.clampVideoPan(120), 100);

  // Stored crop positions
  let store = {};
  assert.equal(RatioProfiles.getStoredSceneCropPosition(store, 's1', '9x16'), 50, 'Default pan 50');
  assert.equal(RatioProfiles.getStoredSceneCropPosition(store, 's1', '16x9'), 50, '16x9 always 50');

  const updateResult = RatioProfiles.storeSceneCropPosition(store, 'proj1', 's1', '9x16', 75);
  store = updateResult.updatedPositions;
  assert.equal(RatioProfiles.getStoredSceneCropPosition(store, 's1', '9x16'), 75);
  assert.deepEqual(updateResult.payload, {
    project_id: 'proj1',
    scene_id: 's1',
    format: '9x16',
    pan_x: 75
  });

  const updateResult45 = RatioProfiles.storeSceneCropPosition(store, 'proj1', 's1', '4x5', 30);
  store = updateResult45.updatedPositions;
  assert.equal(RatioProfiles.getStoredSceneCropPosition(store, 's1', '4x5'), 30);
  assert.equal(RatioProfiles.getStoredSceneCropPosition(store, 's1', '9x16'), 75);

  const updateResult11 = RatioProfiles.storeSceneCropPosition(store, 'proj1', 's1', '1x1', 40);
  store = updateResult11.updatedPositions;
  assert.equal(RatioProfiles.getStoredSceneCropPosition(store, 's1', '1x1'), 40);

  console.log('✓ Ratio Profiles (16x9, 9x16, 4x5, 1x1) tests passed');
}

// 4. Brand Selection Snapshot Tests
console.log('Testing Brand Selection Snapshot logic...');
{
  const mockAssets = [
    { version_id: 'v_intro1', role: 'intro', uri: 'thinkcast_intro.mp4' },
    { version_id: 'v_outro1', role: 'outro', uri: 'greenhill_outro_v4_16x9.png' },
    { version_id: 'v_watermark1', role: 'watermark', uri: 'thinkcast_watermark.png' }
  ];

  const mockSelections = [
    { role: 'intro', enabled: true, version_id: 'v_intro1' },
    { role: 'outro', enabled: true, version_id: 'v_outro1', position: 'center-center', widthRatio: 0.9, background: 'black', backgroundOpacity: 0.85 },
    { role: 'watermark', enabled: true, version_id: 'v_watermark1', position: 'top-right', widthRatio: 0.15 }
  ];

  const snapshot = BrandSelection.createBrandSelectionSnapshot(mockAssets, mockSelections, {
    watermarkProfiles: { '9x16': { position: 'top-left', width_ratio: 0.2 } },
    outroProfiles: { '9x16': { position: 'center-center', width_ratio: 0.8, background: 'black', background_opacity: 0.9 } }
  });

  const validation = BrandSelection.validateBrandSnapshot(snapshot);
  assert.equal(validation.valid, true);

  assert.equal(snapshot.roles.outro.asset.version_id, 'v_outro1');
  assert.equal(snapshot.roles.watermark.position, 'top-right');

  // Watermark profile fallback
  const wm916 = BrandSelection.calculateActiveWatermarkProfile(snapshot.watermarkProfiles, '9x16');
  assert.equal(wm916.position, 'top-left');
  assert.equal(wm916.width_ratio, 0.2);

  const wm169 = BrandSelection.calculateActiveWatermarkProfile(snapshot.watermarkProfiles, '16x9');
  assert.equal(wm169.position, 'top-right');

  // Outro background color calculation
  assert.equal(BrandSelection.calculateOutroBackgroundColor({ background: 'none' }), 'transparent');
  assert.equal(BrandSelection.calculateOutroBackgroundColor({ background: 'black', background_opacity: 0.8 }), 'rgba(0, 0, 0, 0.8)');
  assert.equal(BrandSelection.calculateOutroBackgroundColor({ background: 'white', background_opacity: 0.5 }), 'rgba(255, 255, 255, 0.5)');

  // Outro ratio companions generation
  const companions = BrandSelection.ensureOutroRatioAssets(mockAssets[1]);
  assert.equal(companions.length, 4, 'Should generate companions for 16x9, 9x16, 4x5, 1x1');
  assert.deepEqual(companions.map(c => c.format), ['16x9', '9x16', '4x5', '1x1']);
  assert.equal(companions[1].uri, 'greenhill_outro_v4_9x16.png');
  assert.equal(companions[2].uri, 'greenhill_outro_v4_4x5.png');
  assert.equal(companions[3].uri, 'greenhill_outro_v4_1x1.png');

  console.log('✓ Brand Selection Snapshot tests passed');
}

console.log('\nALL VIDEO EDITOR PURE STATE TESTS PASSED SUCCESSFULLY!');
