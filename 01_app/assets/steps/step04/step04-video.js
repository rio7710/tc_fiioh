/* Step 04 Video Editor Isolated JS Controller */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['/01_app/assets/video-editor/index.js', './step04-ui-bindings.js', './step04-store.js', './step04-navigation-controller.js', './step04-narration-controller.js', './step04-timeline-preview-controller.js', './step04-ratio-crop-controller.js', './step04-playback-controller.js', './step04-settings-controller.js'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../../video-editor/index.js'), require('./step04-ui-bindings.js'), require('./step04-store.js'), require('./step04-navigation-controller.js'), require('./step04-narration-controller.js'), require('./step04-timeline-preview-controller.js'), require('./step04-ratio-crop-controller.js'), require('./step04-playback-controller.js'), require('./step04-settings-controller.js'));
  } else {
    root.Step04VideoEditor = factory(root.VideoEditor, root.Step04UIBindings, root.Step04Store, root.Step04NavigationController, root.Step04NarrationController, root.Step04TimelinePreviewController, root.Step04RatioCropController, root.Step04PlaybackController, root.Step04SettingsController);
  }
}(typeof self !== 'undefined' ? self : this, function (VideoEditor, UIBindings, Step04Store, NavigationController, NarrationController, TimelinePreviewController, RatioCropController, PlaybackController, SettingsController) {
  'use strict';

  const { SceneNav, RatioProfiles, BrandSelection, MobileSync } = VideoEditor || {};

  // Step 4 State (Single Source of Truth)
  let scenes = [];
  const editorState = Step04Store.create();
  let pendingDissolveOverlay = null;
  let isStep4Initialized = false;
  const navigationController = NavigationController.create({
    SceneNav,
    MobileSync,
    getScenes: () => scenes,
    getCurrentScene: () => editorState.get('currentScene'),
    getCurrentTime: () => typeof document !== 'undefined' ? (document.querySelector('#video')?.currentTime || 0) : 0,
    setCurrentTime: value => { const video = typeof document !== 'undefined' ? document.querySelector('#video') : null; if (video) video.currentTime = value; },
    syncPreview: () => sync(),
    formatTime: fmt
  });
  const narrationController = NarrationController.create({
    isNarrationEnabled: () => editorState.get('narrationEnabled'),
    getActiveNarration: () => editorState.get('activeNarration'),
    setActiveNarration: value => editorState.set('activeNarration', value),
    getPreviewVideo: () => typeof document !== 'undefined' ? document.querySelector('#video') : null
  });
  const previewController = TimelinePreviewController.create({
    root: typeof document !== 'undefined' ? document : null,
    SceneNav,
    formatTime: fmt,
    getScenes: () => scenes,
    getCurrentScene: () => editorState.get('currentScene'),
    setCurrentScene: value => editorState.set('currentScene', value),
    getDissolveSeconds: () => editorState.get('sceneDissolveSeconds'),
    applyStoredSceneCrop: () => applyStoredSceneCrop(),
    syncNavigation: view => navigationController.sync(view)
  });
  const ratioCropController = RatioCropController.create({
    getRoot: () => typeof document !== 'undefined' ? document : null,
    RatioProfiles,
    getScenes: () => scenes,
    getCurrentScene: () => editorState.get('currentScene'),
    getCropPositions: () => editorState.get('sceneCropPositions'),
    setCropPositions: value => editorState.set('sceneCropPositions', value),
    getVideoPanX: () => editorState.get('videoPanX'),
    setVideoPanX: value => editorState.set('videoPanX', value),
    setCurrentPreviewPlatform: value => editorState.set('currentPreviewPlatform', value),
    getActiveProjectId: () => typeof window !== 'undefined' ? window.activeProjectId : null,
    api: (...args) => typeof window !== 'undefined' && typeof window.api === 'function' ? window.api(...args) : undefined,
    saveEditorSettings: () => saveEditorSettings(),
    updateWatermarkPreview: () => callShellFeature('updateWatermarkPreview'),
    updateCommonOutroPreview: () => callShellFeature('updateCommonOutroPreview'),
    onError: (message, error) => console.error(message, error)
  });
  const playbackController = PlaybackController.create({
    getRoot: () => typeof document !== 'undefined' ? document : null,
    getSelectedMusic: () => editorState.get('selectedMusic'),
    setSelectedMusic: value => editorState.set('selectedMusic', value),
    getCatalog: () => settingsController.getConfiguredCatalog(),
    saveEditorSettings: () => saveEditorSettings(),
    sync: () => sync(),
    stopNarration: () => stopNarration(),
    syncNarration: (time, force) => syncNarration(time, force),
    updatePanAvailability: () => updatePanAvailability(),
    onError: (name, error) => console.error(`[Step04:${name}]`, error)
  });
  const settingsController = SettingsController.create({
    getRoot: () => typeof document !== 'undefined' ? document : null,
    storage: typeof localStorage !== 'undefined' ? localStorage : null,
    storageKey: 'thinkcast-editor-settings-v1',
    api: (...args) => typeof window !== 'undefined' && typeof window.api === 'function' ? window.api(...args) : undefined,
    getState: key => editorState.get(key), setState: (key, value) => editorState.set(key, value),
    configureRatioCatalog: catalog => RatioProfiles?.configureCatalog?.(catalog),
    clampVideoPan: value => RatioProfiles ? RatioProfiles.clampVideoPan(value) : Math.max(0, Math.min(100, Number(value) || 50)),
    setVideoPan: value => setVideoPan(value), setCaptionSize: value => setCaptionSize(value),
    setNarration: value => setNarration(value), setType: value => setType(value), setMusic: value => setMusic(value),
    setPlatformPreview: value => setPlatformPreview(value), setSceneDissolveSeconds: value => setSceneDissolveSeconds(value),
    onError: (name, error) => console.error(`[Step04:${name}]`, error)
  });

  function callShellFeature(name, ...args) {
    if (typeof window === 'undefined' || typeof window[name] !== 'function') return undefined;
    try {
      return window[name](...args);
    } catch (error) {
      console.error(`[Step04:${name}]`, error);
      return undefined;
    }
  }

  function fmt(seconds) {
    return MobileSync ? MobileSync.formatTime(seconds) : '00:00';
  }

  function currentCropFormat() {
    return ratioCropController.currentCropFormat();
  }

  function updatePanAvailability() {
    return ratioCropController.updatePanAvailability();
  }

  function setVideoPan(value) {
    return ratioCropController.setVideoPan(value);
  }

  function setSceneDissolveSeconds(seconds) {
    const val = Number.isFinite(Number(seconds)) ? Math.max(0, Math.min(3, Number(seconds))) : 0.5;
    editorState.set('sceneDissolveSeconds', val);
    if (typeof document !== 'undefined') {
      const stage = document.querySelector('#stage');
      if (stage) stage.style.setProperty('--scene-dissolve-seconds', `${val}s`);
    }
  }

  function configure(settings, catalog) { return settingsController.configure(settings, catalog); }
  function getEffectiveSettingsPayload() { return settingsController.getEffectiveSettingsPayload(); }
  function persistRenderSettings() { return settingsController.persistRenderSettings(); }

  function setSceneCropPositions(positions) {
    return ratioCropController.setSceneCropPositions(positions);
  }

  function getSceneCropPositions() {
    return ratioCropController.getSceneCropPositions();
  }

  function applyStoredSceneCrop() {
    return ratioCropController.applyStoredSceneCrop();
  }

  function storeCurrentSceneCrop() {
    return ratioCropController.storeCurrentSceneCrop();
  }

  async function persistCurrentSceneCrop() {
    return ratioCropController.persistCurrentSceneCrop();
  }

  function saveEditorSettings() { return settingsController.saveEditorSettings(); }
  function loadEditorSettings() { return settingsController.loadEditorSettings(); }
  function restoreEditorSettings(settingsOverride) { return settingsController.restoreEditorSettings(settingsOverride); }

  function setCaptionSize(level) {
    const captionSizeLevel = Math.max(-5, Math.min(5, level));
    editorState.set('captionSizeLevel', captionSizeLevel);
    if (typeof document === 'undefined') return;
    const stage = document.querySelector('#stage');
    const captionSizeValue = document.querySelector('#captionSizeValue');
    const captionSizeDown = document.querySelector('#captionSizeDown');
    const captionSizeUp = document.querySelector('#captionSizeUp');

    if (stage) stage.style.setProperty('--caption-size-offset', `${captionSizeLevel * .278}cqmin`);
    if (captionSizeValue) captionSizeValue.textContent = captionSizeLevel === 0 ? '기본' : `${captionSizeLevel > 0 ? '+' : ''}${captionSizeLevel}`;
    if (captionSizeDown) captionSizeDown.disabled = captionSizeLevel === -5;
    if (captionSizeUp) captionSizeUp.disabled = captionSizeLevel === 5;
    saveEditorSettings();
  }

  function setNarration(enabled) {
    const narrationEnabled = Boolean(enabled);
    editorState.set('narrationEnabled', narrationEnabled);
    if (typeof document !== 'undefined') {
      const narrationBtn = document.querySelector('#narrationBtn');
      if (narrationBtn) {
        narrationBtn.classList.toggle('active', narrationEnabled);
        narrationBtn.setAttribute('aria-pressed', String(narrationEnabled));
        narrationBtn.textContent = narrationEnabled ? 'STT 내레이션 켬' : 'STT 내레이션 끔';
      }
      const video = document.querySelector('#video');
      if (video) {
        narrationEnabled ? syncNarration(video.currentTime, true) : stopNarration();
      }
    }
    saveEditorSettings();
  }

  function setType(type) {
    editorState.set('currentType', type);
    if (typeof document === 'undefined') return;
    const stage = document.querySelector('#stage');
    if (stage) {
      stage.classList.remove('type-card', 'type-minimal', 'type-editorial', 'type-bubble', 'type-block', 'type-action');
      stage.classList.add(`type-${type}`);
    }
    document.querySelectorAll('.type-btn').forEach(btn => {
      const selected = btn.dataset.type === type;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });
    saveEditorSettings();
  }

  function setMusic(track) {
    return playbackController.setMusic(track);
  }

  function setPlatformPreview(platform) {
    return ratioCropController.setPlatformPreview(platform);
  }

  function stopNarration() {
    return narrationController.stop();
  }

  function startNarration(index, t) {
    return narrationController.start(index, t);
  }

  function syncNarration(t, force = false) {
    return narrationController.sync(t, force);
  }

  function alignMusic() {
    return playbackController.alignMusic();
  }

  function renderSceneList() {
    if (typeof document !== 'undefined') navigationController.mount(document);
    return navigationController.render();
  }

  function currentNavigationState() {
    return navigationController.currentState();
  }

  function navigatePreview(action) {
    return navigationController.navigate(action);
  }

  function sync() {
    if (!scenes.length || typeof document === 'undefined') return;
    const video = document.querySelector('#video');
    if (!video) return;
    const t = video.currentTime || 0;
    const view = previewController.sync(t);
    syncNarration(view.time);
    if (!video.paused) requestAnimationFrame(sync);
  }

  function seekScene(index) {
    return navigationController.seekScene(index);
  }

  function seekOutroPreview() {
    return navigationController.seekOutro();
  }

  function togglePlay() {
    return playbackController.togglePlay();
  }

  function applyTimeline(timeline) {
    const source = Array.isArray(timeline?.scenes) ? timeline.scenes : [];
    scenes = source.map(scene => ({
      ...scene,
      text: scene.text || scene.script || scene.narration || scene.line || scene.title || scene.name || '',
      image: scene.image || scene.preview_uri || '',
      cueStart: scene.cueStart != null ? Number(scene.cueStart) : (scene.cue_start != null ? Number(scene.cue_start) : Number(scene.start || 0)),
      cueEnd: scene.cueEnd != null ? Number(scene.cueEnd) : (scene.cue_end != null ? Number(scene.cue_end) : Number(scene.end || 0))
    }));
    editorState.set('currentScene', -1);
    renderSceneList();
    if (typeof document !== 'undefined') {
      previewController.updateSummary();
      sync();
    }
  }

  function setNarrationTracks(payload) {
    return narrationController.setTracks(payload);
  }

  function openImageRegeneration() {
    if (typeof document === 'undefined') return;
    const imageRegenerationModal = document.querySelector('#imageRegenerationModal');
    if (imageRegenerationModal) imageRegenerationModal.hidden = false;
  }

  function closeImageRegeneration() {
    if (typeof document === 'undefined') return;
    const imageRegenerationModal = document.querySelector('#imageRegenerationModal');
    if (imageRegenerationModal) imageRegenerationModal.hidden = true;
  }

  function requestImageRegeneration() {
    closeImageRegeneration();
  }

  // Initialization strictly after partial HTML insertion into DOM
  function initStep4UI() {
    if (typeof document === 'undefined') return false;
    const step4 = document.querySelector('#step4');
    if (!step4) return false;
    if (isStep4Initialized) return true;
    navigationController.mount(document);
    playbackController.mount();
    const result = UIBindings?.bind({
      document,
      root: step4,
      openImageRegeneration,
      closeImageRegeneration,
      requestImageRegeneration,
      setType,
      setMusic,
      setPlatformPreview,
      setCaptionSize,
      setNarration,
      persistRenderSettings,
      getCaptionSize: () => editorState.get('captionSizeLevel'),
      getNarrationEnabled: () => editorState.get('narrationEnabled'),
      setCurrentVolume: value => { editorState.set('currentVolume', value); saveEditorSettings(); },
      platformForRatio: ratio => ratio === '9x16' ? 'instagram' : ratio === '4x5' ? 'facebook' : ratio === '1x1' ? 'square' : 'youtube',
      startRender: () => typeof window.startRenderWorkflow === 'function' ? window.startRenderWorkflow() : undefined,
      openDistributionHelp: () => {
        const modal = document.querySelector('#platformGuideModal');
        if (modal) { modal.hidden = false; document.body.classList.add('modal-open'); }
      },
      brandChanged: async event => {
        if (event.target.id === 'brandOutroVersion') {
          const assets = window.brandAssets || [];
          callShellFeature('ensureOutroRatioAssets', assets.find(item => item.version_id === event.target.value));
        }
        callShellFeature('updateWatermarkPreview');
        callShellFeature('updateCommonOutroPreview');
        const saved = callShellFeature('saveBrandSelections');
        if (saved && typeof saved.then === 'function') await saved;
      },
      toggleDistribution: (platform, button) => {
        if (!platform) return;
        const selectedPlatforms = editorState.get('selectedPlatforms');
        selectedPlatforms.has(platform) ? selectedPlatforms.delete(platform) : selectedPlatforms.add(platform);
        editorState.set('selectedPlatforms', selectedPlatforms);
        button.setAttribute('aria-pressed', String(selectedPlatforms.has(platform)));
        saveEditorSettings();
      }
    });
    if (!result?.bound) return false;

    try { restoreEditorSettings(); }
    catch (error) { console.error('[Step04:settings-restore]', error); }
    isStep4Initialized = true;
    return true;
  }

  return {
    configure: configure,
    getConfiguredSettings: () => settingsController.getConfiguredSettings(),
    getConfiguredCatalog: () => settingsController.getConfiguredCatalog(),
    isConfigured: () => settingsController.isConfigured(),
    persistRenderSettings: persistRenderSettings,
    setSceneDissolveSeconds: setSceneDissolveSeconds,
    getSceneDissolveSeconds: () => editorState.get('sceneDissolveSeconds'),
    getEffectiveSettingsPayload: getEffectiveSettingsPayload,
    getSceneCropPositions: getSceneCropPositions,
    setSceneCropPositions: setSceneCropPositions,
    initStep4UI: initStep4UI,
    isInitialized: () => isStep4Initialized,
    applyTimeline: applyTimeline,
    setNarrationTracks: setNarrationTracks,
    sync: sync,
    seekScene: seekScene,
    seekOutroPreview: seekOutroPreview,
    navigatePreview: navigatePreview,
    currentNavigationState: currentNavigationState,
    togglePlay: togglePlay,
    stopNarration: stopNarration,
    startNarration: startNarration,
    syncNarration: syncNarration,
    alignMusic: alignMusic,
    renderSceneList: renderSceneList,
    setPlatformPreview: setPlatformPreview,
    setMusic: setMusic,
    setType: setType,
    restoreEditorSettings: restoreEditorSettings,
    saveEditorSettings: saveEditorSettings,
    loadEditorSettings: loadEditorSettings,
    setCaptionSize: setCaptionSize,
    setNarration: setNarration,
    updatePanAvailability: updatePanAvailability,
    setVideoPan: setVideoPan,
    currentCropFormat: currentCropFormat,
    applyStoredSceneCrop: applyStoredSceneCrop,
    storeCurrentSceneCrop: storeCurrentSceneCrop,
    persistCurrentSceneCrop: persistCurrentSceneCrop,
    openImageRegeneration: openImageRegeneration,
    closeImageRegeneration: closeImageRegeneration,
    requestImageRegeneration: requestImageRegeneration,
    unmountNavigation: () => navigationController.unmount()
  };
}));
