/* Step 04 Video Editor Isolated JS Controller */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['/01_app/assets/video-editor/index.js', './step04-ui-bindings.js', './step04-store.js', './step04-navigation-controller.js', './step04-narration-controller.js', './step04-timeline-preview-controller.js', './step04-ratio-crop-controller.js', './step04-playback-controller.js', './step04-settings-controller.js', './step04-style-controller.js', './step04-timeline-orchestrator.js', './step04-lifecycle-controller.js', './step04-ui-actions-controller.js'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../../video-editor/index.js'), require('./step04-ui-bindings.js'), require('./step04-store.js'), require('./step04-navigation-controller.js'), require('./step04-narration-controller.js'), require('./step04-timeline-preview-controller.js'), require('./step04-ratio-crop-controller.js'), require('./step04-playback-controller.js'), require('./step04-settings-controller.js'), require('./step04-style-controller.js'), require('./step04-timeline-orchestrator.js'), require('./step04-lifecycle-controller.js'), require('./step04-ui-actions-controller.js'));
  } else {
    root.Step04VideoEditor = factory(root.VideoEditor, root.Step04UIBindings, root.Step04Store, root.Step04NavigationController, root.Step04NarrationController, root.Step04TimelinePreviewController, root.Step04RatioCropController, root.Step04PlaybackController, root.Step04SettingsController, root.Step04StyleController, root.Step04TimelineOrchestrator, root.Step04LifecycleController, root.Step04UIActionsController);
  }
}(typeof self !== 'undefined' ? self : this, function (VideoEditor, UIBindings, Step04Store, NavigationController, NarrationController, TimelinePreviewController, RatioCropController, PlaybackController, SettingsController, StyleController, TimelineOrchestrator, LifecycleController, UIActionsController) {
  'use strict';

  const { SceneNav, RatioProfiles, BrandSelection, MobileSync } = VideoEditor || {};

  // Step 4 State (Single Source of Truth)
  let timelineOrchestrator = null;
  const editorState = Step04Store.create();
  const navigationController = NavigationController.create({
    SceneNav,
    MobileSync,
    getScenes: () => timelineOrchestrator?.getScenes() || [],
    getCurrentScene: () => editorState.get('currentScene'),
    getCurrentTime: () => timelineOrchestrator?.getPreviewTime() || 0,
    setCurrentTime: value => timelineOrchestrator?.setPreviewTime(value),
    syncPreview: () => sync(),
    formatTime: fmt
  });
  const narrationController = NarrationController.create({
    getRoot: () => typeof document !== 'undefined' ? document : null,
    isNarrationEnabled: () => editorState.get('narrationEnabled'),
    setNarrationEnabled: value => editorState.set('narrationEnabled', value),
    getActiveNarration: () => editorState.get('activeNarration'),
    setActiveNarration: value => editorState.set('activeNarration', value),
    getPreviewVideo: () => typeof document !== 'undefined' ? document.querySelector('#video') : null,
    saveEditorSettings: () => saveEditorSettings()
  });
  const previewController = TimelinePreviewController.create({
    root: typeof document !== 'undefined' ? document : null,
    SceneNav,
    formatTime: fmt,
    getScenes: () => timelineOrchestrator?.getScenes() || [],
    getCurrentScene: () => editorState.get('currentScene'),
    setCurrentScene: value => editorState.set('currentScene', value),
    getDissolveSeconds: () => editorState.get('sceneDissolveSeconds'),
    applyStoredSceneCrop: () => applyStoredSceneCrop(),
    syncNavigation: view => navigationController.sync(view)
  });
  const ratioCropController = RatioCropController.create({
    getRoot: () => typeof document !== 'undefined' ? document : null,
    RatioProfiles,
    getScenes: () => timelineOrchestrator?.getScenes() || [],
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
  const styleController = StyleController.create({
    getRoot: () => typeof document !== 'undefined' ? document : null,
    setState: (key, value) => editorState.set(key, value),
    getCatalog: () => settingsController.getConfiguredCatalog(),
    saveEditorSettings: () => saveEditorSettings()
  });
  timelineOrchestrator = TimelineOrchestrator.create({
    getRoot: () => typeof document !== 'undefined' ? document : null,
    setCurrentScene: value => editorState.set('currentScene', value),
    renderSceneList: () => renderSceneList(),
    previewSync: time => previewController.sync(time),
    updateSummary: () => previewController.updateSummary(),
    syncNarration: time => syncNarration(time),
    scheduleFrame: callback => requestAnimationFrame(callback),
    onMediaSeekError: error => console.error('[Step04:media-seek]', error)
  });
  const uiActionsController = UIActionsController.create({
    getRoot: () => typeof document !== 'undefined' ? document : null,
    getBody: () => typeof document !== 'undefined' ? document.body : null,
    startRender: () => typeof window !== 'undefined' && typeof window.startRenderWorkflow === 'function' ? window.startRenderWorkflow() : undefined,
    getBrandAssets: () => typeof window !== 'undefined' ? (window.brandAssets || []) : [],
    hasShellFeature: name => typeof window !== 'undefined' && typeof window[name] === 'function',
    callShellFeature: (name, ...args) => callShellFeature(name, ...args),
    getSelectedPlatforms: () => editorState.get('selectedPlatforms'),
    setSelectedPlatforms: value => editorState.set('selectedPlatforms', value),
    saveEditorSettings: () => saveEditorSettings()
  });
  const lifecycleController = LifecycleController.create({
    getDocument: () => typeof document !== 'undefined' ? document : null,
    UIBindings,
    navigationMount: doc => navigationController.mount(doc),
    playbackMount: () => playbackController.mount(),
    getBindingOptions: () => getStep4BindingOptions(),
    restoreEditorSettings: () => restoreEditorSettings(),
    onError: (label, error) => console.error(label, error)
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
    return styleController.setSceneDissolveSeconds(seconds);
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
    return styleController.setCaptionSize(level);
  }

  function setNarration(enabled) {
    return narrationController.setEnabled(enabled);
  }

  function setType(type) {
    return styleController.setType(type);
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
    return navigationController.render();
  }

  function currentNavigationState() {
    return navigationController.currentState();
  }

  function navigatePreview(action) {
    return navigationController.navigate(action);
  }

  function sync() {
    return timelineOrchestrator.sync();
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
    return timelineOrchestrator.applyTimeline(timeline);
  }

  function setNarrationTracks(payload) {
    return narrationController.setTracks(payload);
  }

  function openImageRegeneration() {
    return uiActionsController.openImageRegeneration();
  }

  function closeImageRegeneration() {
    return uiActionsController.closeImageRegeneration();
  }

  function requestImageRegeneration() {
    return uiActionsController.requestImageRegeneration();
  }

  function getStep4BindingOptions() {
    return {
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
      platformForRatio: ratio => uiActionsController.platformForRatio(ratio),
      startRender: () => uiActionsController.startRender(),
      openDistributionHelp: () => uiActionsController.openDistributionHelp(),
      brandChanged: event => uiActionsController.brandChanged(event),
      toggleDistribution: (platform, button) => uiActionsController.toggleDistribution(platform, button)
    };
  }

  function initStep4UI() { return lifecycleController.init(); }

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
    isInitialized: () => lifecycleController.isInitialized(),
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
