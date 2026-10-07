/* Step 04 Video Editor Isolated JS Controller */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['/01_app/assets/video-editor/index.js', './step04-ui-bindings.js', './step04-store.js', './step04-navigation-controller.js'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../../video-editor/index.js'), require('./step04-ui-bindings.js'), require('./step04-store.js'), require('./step04-navigation-controller.js'));
  } else {
    root.Step04VideoEditor = factory(root.VideoEditor, root.Step04UIBindings, root.Step04Store, root.Step04NavigationController);
  }
}(typeof self !== 'undefined' ? self : this, function (VideoEditor, UIBindings, Step04Store, NavigationController) {
  'use strict';

  const { SceneNav, RatioProfiles, BrandSelection, MobileSync } = VideoEditor || {};

  // Step 4 State (Single Source of Truth)
  let scenes = [];
  let narrations = [];
  let narrationAudios = [];
  const editorState = Step04Store.create();
  let pendingDissolveOverlay = null;
  let isStep4Initialized = false;
  let configuredSettings = null;
  let configuredCatalog = null;
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

  function timelineDuration() {
    return SceneNav ? SceneNav.calculateTimelineDuration(scenes) : (scenes.length ? scenes[scenes.length - 1].end : 0);
  }

  function sceneAt(t) {
    return SceneNav ? SceneNav.findSceneAtTime(scenes, t) : 0;
  }

  function currentCropFormat() {
    if (typeof document === 'undefined') return '16x9';
    const stageCard = document.querySelector('#stageCard') || document.querySelector('.stage-card');
    if (!stageCard) return '16x9';
    return RatioProfiles ? RatioProfiles.calculateCropFormat(stageCard.className) : '16x9';
  }

  function updatePanAvailability() {
    if (typeof document === 'undefined') return;
    const stage = document.querySelector('#stage');
    const stageCard = document.querySelector('#stageCard') || document.querySelector('.stage-card');
    const sceneVideo = document.querySelector('#sceneVideo');
    const sceneImage = document.querySelector('#sceneImage');
    if (!stage || !stageCard || !sceneVideo || !sceneImage) return;

    const sourceWidth = stage.classList.contains('has-scene-video') ? sceneVideo.videoWidth : sceneImage.naturalWidth;
    const sourceHeight = stage.classList.contains('has-scene-video') ? sceneVideo.videoHeight : sceneImage.naturalHeight;

    const canPan = RatioProfiles
      ? RatioProfiles.calculatePanAvailability(stageCard.className, sourceWidth, sourceHeight)
      : false;

    stage.classList.toggle('can-pan', canPan);
  }

  function setVideoPan(value) {
    const videoPanX = RatioProfiles ? RatioProfiles.clampVideoPan(value) : Math.max(0, Math.min(100, Number(value) || 50));
    editorState.set('videoPanX', videoPanX);
    if (typeof document === 'undefined') return;
    const stage = document.querySelector('#stage');
    if (stage) stage.style.setProperty('--video-pan-x', `${videoPanX}%`);
  }

  function setSceneDissolveSeconds(seconds) {
    const val = Number.isFinite(Number(seconds)) ? Math.max(0, Math.min(3, Number(seconds))) : 0.5;
    editorState.set('sceneDissolveSeconds', val);
    if (typeof document !== 'undefined') {
      const stage = document.querySelector('#stage');
      if (stage) stage.style.setProperty('--scene-dissolve-seconds', `${val}s`);
    }
  }

  function configure(settings, catalog) {
    if (catalog) {
      configuredCatalog = catalog;
      if (RatioProfiles && typeof RatioProfiles.configureCatalog === 'function') {
        RatioProfiles.configureCatalog(catalog);
      }
    }
    if (settings && typeof settings === 'object') {
      configuredSettings = settings;
      if (settings.type !== undefined) editorState.set('currentType', settings.type);
      if (settings.music !== undefined) editorState.set('selectedMusic', settings.music);
      if (settings.preview_platform !== undefined || settings.previewPlatform !== undefined) {
        editorState.set('currentPreviewPlatform', settings.preview_platform || settings.previewPlatform);
      }
      if (Array.isArray(settings.platforms)) {
        editorState.set('selectedPlatforms', new Set(settings.platforms));
      }
      const rawVolume = settings.volume;
      if (rawVolume !== undefined) {
        editorState.set('currentVolume', Number.isFinite(Number(rawVolume)) ? Math.max(0, Math.min(1, Number(rawVolume))) : 0.5);
      }
      const rawPan = settings.video_pan_x !== undefined ? settings.video_pan_x : settings.videoPanX;
      if (Number.isFinite(Number(rawPan))) {
        const numPan = Number(rawPan);
        const panPercent = numPan <= 1.0 ? numPan * 100 : numPan;
        editorState.set('videoPanX', RatioProfiles ? RatioProfiles.clampVideoPan(panPercent) : Math.max(0, Math.min(100, panPercent)));
      }
      const rawDissolve = settings.scene_dissolve_seconds !== undefined ? settings.scene_dissolve_seconds : settings.sceneDissolveSeconds;
      if (Number.isFinite(Number(rawDissolve))) {
        editorState.set('sceneDissolveSeconds', Math.max(0, Math.min(3, Number(rawDissolve))));
      }
      const rawCaptionSize = settings.caption_size !== undefined ? settings.caption_size : settings.captionSize;
      if (Number.isFinite(Number(rawCaptionSize))) {
        editorState.set('captionSizeLevel', Math.max(-5, Math.min(5, Number(rawCaptionSize))));
      }
      if (settings.narration !== undefined) {
        editorState.set('narrationEnabled', Boolean(settings.narration));
      }
      restoreEditorSettings(settings);
    }
    return { settings: configuredSettings, catalog: configuredCatalog };
  }

  function getEffectiveSettingsPayload() {
    const musicVolume = typeof document !== 'undefined' ? document.querySelector('#musicVolume') : null;
    const vol = musicVolume ? Number(musicVolume.value) : editorState.get('currentVolume');
    return {
      type: editorState.get('currentType'),
      music: editorState.get('selectedMusic'),
      volume: Number.isFinite(vol) ? Math.max(0, Math.min(1, vol)) : 0.5,
      narration: editorState.get('narrationEnabled'),
      preview_platform: editorState.get('currentPreviewPlatform'),
      platforms: Array.from(editorState.get('selectedPlatforms')),
      video_pan_x: editorState.get('videoPanX') / 100,
      scene_dissolve_seconds: editorState.get('sceneDissolveSeconds'),
      caption_size: editorState.get('captionSizeLevel')
    };
  }

  async function persistRenderSettings() {
    saveEditorSettings();
    if (typeof window === 'undefined' || typeof window.api !== 'function') return;
    const overridesPayload = getEffectiveSettingsPayload();
    const body = {
      schema_version: 'render-settings.v1',
      overrides: overridesPayload
    };
    try {
      const res = await window.api('/api/render-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return res;
    } catch (error) {
      console.error('Render settings save failed:', error);
      if (typeof document !== 'undefined') {
        const rs = document.querySelector('#renderStatus');
        if (rs) rs.textContent = '설정 저장 실패 (오프라인/오류)';
      }
    }
  }

  function setSceneCropPositions(positions) {
    if (positions && typeof positions === 'object') {
      editorState.set('sceneCropPositions', positions);
    }
  }

  function getSceneCropPositions() {
    return editorState.get('sceneCropPositions');
  }

  function applyStoredSceneCrop() {
    const scene = scenes[editorState.get('currentScene')];
    const format = currentCropFormat();
    const panX = RatioProfiles ? RatioProfiles.getStoredSceneCropPosition(editorState.get('sceneCropPositions'), scene?.id, format) : 50;
    setVideoPan(panX);
  }

  function storeCurrentSceneCrop() {
    const scene = scenes[editorState.get('currentScene')];
    const format = currentCropFormat();
    if (!scene || !RatioProfiles) return null;
    const activeProjectId = (typeof window !== 'undefined' && window.activeProjectId) ? window.activeProjectId : null;
    const res = RatioProfiles.storeSceneCropPosition(editorState.get('sceneCropPositions'), activeProjectId, scene.id, format, editorState.get('videoPanX'));
    editorState.set('sceneCropPositions', res.updatedPositions);
    return res.payload;
  }

  async function persistCurrentSceneCrop() {
    const position = storeCurrentSceneCrop();
    saveEditorSettings();
    if (!position?.project_id || typeof window === 'undefined' || typeof window.api !== 'function') return;
    try {
      await window.api('/api/project/crop-position', { method: 'POST', body: JSON.stringify(position) });
    } catch (error) {
      console.error('씬 크롭 위치 저장 실패', error);
    }
  }

  function saveEditorSettings() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem('thinkcast-editor-settings-v1', JSON.stringify({
        type: editorState.get('currentType'),
        music: editorState.get('selectedMusic'),
        volume: (typeof document !== 'undefined' && document.querySelector('#musicVolume')?.value) || '0.5',
        videoPanX: editorState.get('videoPanX'),
        captionSize: editorState.get('captionSizeLevel'),
        narration: editorState.get('narrationEnabled'),
        previewPlatform: editorState.get('currentPreviewPlatform'),
        platforms: Array.from(editorState.get('selectedPlatforms'))
      }));
    } catch (e) {}
  }

  function loadEditorSettings() {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem('thinkcast-editor-settings-v1');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function restoreEditorSettings(settingsOverride) {
    const apiSettings = settingsOverride || configuredSettings;
    const localCache = loadEditorSettings() || {};
    const source = apiSettings || localCache;
    if (!source) return;

    const hasDoc = typeof document !== 'undefined';
    const typeButtons = hasDoc ? Array.from(document.querySelectorAll('.type-btn')) : [];
    const musicButtons = hasDoc ? Array.from(document.querySelectorAll('.music-btn[data-music]')) : [];
    const platformButtons = hasDoc ? Array.from(document.querySelectorAll('.distribution-btn')) : [];
    const validTypes = new Set(typeButtons.map(btn => btn.dataset.type));
    const validMusic = new Set(musicButtons.map(btn => btn.dataset.music));
    const validPlatforms = new Set(platformButtons.map(btn => btn.dataset.platform));
    const preferredPlatforms = source.platforms;
    const restoredPlatforms = Array.isArray(preferredPlatforms) ? preferredPlatforms.filter(item => validPlatforms.size === 0 || validPlatforms.has(item)) : null;

    editorState.set('sceneCropPositions', {});
    if (restoredPlatforms) {
      editorState.set('selectedPlatforms', new Set(restoredPlatforms));
    }
    if (hasDoc) {
      const selectedPlatforms = editorState.get('selectedPlatforms');
      platformButtons.forEach(btn => btn.setAttribute('aria-pressed', String(selectedPlatforms.has(btn.dataset.platform))));
    }

    const musicVolume = hasDoc ? document.querySelector('#musicVolume') : null;
    const rawVolume = source.volume;
    if (rawVolume !== undefined) {
      editorState.set('currentVolume', Number.isFinite(Number(rawVolume)) ? Math.max(0, Math.min(1, Number(rawVolume))) : 0.5);
    }
    if (musicVolume) musicVolume.value = String(editorState.get('currentVolume'));

    const rawPan = source.video_pan_x !== undefined ? source.video_pan_x : source.videoPanX;
    let panPercent = 50;
    if (Number.isFinite(Number(rawPan))) {
      const numPan = Number(rawPan);
      panPercent = numPan <= 1.0 ? numPan * 100 : numPan;
    }
    setVideoPan(panPercent);

    const rawCaptionSize = source.caption_size !== undefined ? source.caption_size : source.captionSize;
    setCaptionSize(Number.isFinite(Number(rawCaptionSize)) ? Number(rawCaptionSize) : 0);

    const rawNarration = source.narration;
    setNarration(rawNarration !== false);

    const rawType = source.type;
    setType((validTypes.size === 0 || validTypes.has(rawType)) ? rawType : 'editorial');

    const rawMusic = source.music;
    setMusic((validMusic.size === 0 || validMusic.has(rawMusic)) ? rawMusic : 'satie');

    const rawPlatform = source.preview_platform || source.previewPlatform;
    setPlatformPreview((validPlatforms.size === 0 || validPlatforms.has(rawPlatform)) ? rawPlatform : 'youtube');

    const rawDissolve = source.scene_dissolve_seconds !== undefined ? source.scene_dissolve_seconds : source.sceneDissolveSeconds;
    setSceneDissolveSeconds(Number.isFinite(Number(rawDissolve)) ? Number(rawDissolve) : 0.5);

    saveEditorSettings();
  }

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

  const musicTracks = {
    satie: '/02_media/music/01_Satie_Gymnopedie_No1_CC-BY-3.0.mp3',
    debussy: '/02_media/music/02_Debussy_Clair_de_lune_CC-BY-3.0.mp3',
    bach: '/02_media/music/03_Bach_Air_BWV1068_Public_Domain.mp3'
  };

  function setMusic(track) {
    editorState.set('selectedMusic', track);
    if (typeof document === 'undefined') return;
    const bgm = document.querySelector('#bgm');
    const video = document.querySelector('#video');
    if (bgm && track !== 'none') {
      bgm.src = musicTracks[track] || `/02_media/music/${track}.mp3`;
      bgm.addEventListener('loadedmetadata', () => {
        alignMusic();
        if (video && !video.paused) bgm.play().catch(() => {});
      }, { once: true });
      bgm.load();
    }
    document.querySelectorAll('.music-btn[data-music]').forEach(btn => {
      const selected = btn.dataset.music === track;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });
    saveEditorSettings();
  }

  function setPlatformPreview(platform) {
    if (typeof document === 'undefined') return;
    const config = RatioProfiles ? (RatioProfiles.getPlatformFormat ? RatioProfiles.getPlatformFormat(platform) : RatioProfiles.PLATFORM_PREVIEW_FORMATS[platform]) : null;
    const format = config || { className: 'preview-landscape', label: 'YouTube · 16:9', safe: '' };
    editorState.set('currentPreviewPlatform', platform);
    const stageCard = document.querySelector('#stageCard') || document.querySelector('.stage-card');
    const previewFormatBadge = document.querySelector('#previewFormatBadge');
    const formatSafeZone = document.querySelector('#formatSafeZone');

    if (stageCard) {
      stageCard.classList.remove('preview-landscape', 'preview-portrait', 'preview-feed', 'preview-square');
      stageCard.classList.add(format.className);
    }
    if (previewFormatBadge) previewFormatBadge.textContent = format.label;
    if (formatSafeZone) formatSafeZone.dataset.label = format.safe;

    document.querySelectorAll('.platform-preview-btn').forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.dataset.platform === platform));
    });

    const formatKey = RatioProfiles ? RatioProfiles.calculateCropFormat(format.className) : '16x9';
    document.querySelectorAll('.ratio-btn').forEach(btn => {
      const match = btn.dataset.ratio === formatKey || (RatioProfiles ? RatioProfiles.calculateCropFormat(btn.dataset.ratio) === formatKey : false);
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-pressed', String(match));
    });

    applyStoredSceneCrop();
    updatePanAvailability();
    callShellFeature('updateWatermarkPreview');
    callShellFeature('updateCommonOutroPreview');
    saveEditorSettings();
  }

  function stopNarration() {
    const activeNarration = editorState.get('activeNarration');
    if (activeNarration >= 0 && narrationAudios[activeNarration]) {
      narrationAudios[activeNarration].pause();
    }
    editorState.set('activeNarration', -1);
  }

  function startNarration(index, t) {
    if (!editorState.get('narrationEnabled') || index < 0 || !narrations[index] || !narrationAudios[index]) {
      stopNarration();
      return;
    }
    const target = narrations[index];
    const audio = narrationAudios[index];
    const duration = Math.max(0.001, target.end - target.start);
    const audioDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
    const targetTime = Math.min(Math.max(0, audioDuration - 0.03), Math.max(0, t - target.start) / duration * audioDuration);

    if (editorState.get('activeNarration') !== index) {
      stopNarration();
      editorState.set('activeNarration', index);
      audio.currentTime = targetTime;
      audio.play().catch(() => {});
    } else if (Math.abs(audio.currentTime - targetTime) > 0.25) {
      audio.currentTime = targetTime;
      if (audio.paused) audio.play().catch(() => {});
    }
  }

  function syncNarration(t, force = false) {
    if (typeof document === 'undefined') return;
    const video = document.querySelector('#video');
    if (!editorState.get('narrationEnabled') || !video || video.paused) {
      stopNarration();
      return;
    }
    const idx = narrations.findIndex(item => t >= item.start && t < item.end);
    if (idx >= 0) {
      startNarration(idx, t);
    } else {
      stopNarration();
    }
  }

  function alignMusic() {
    if (typeof document === 'undefined') return;
    const video = document.querySelector('#video');
    const bgm = document.querySelector('#bgm');
    if (!video || !bgm || editorState.get('selectedMusic') === 'none') return;
    if (bgm.readyState >= 1 && Number.isFinite(bgm.duration) && bgm.duration > 0) {
      const targetTime = video.currentTime % bgm.duration;
      if (Math.abs(bgm.currentTime - targetTime) > 0.25) bgm.currentTime = targetTime;
    }
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
    const stage = document.querySelector('#stage');
    const sceneImage = document.querySelector('#sceneImage');
    const progressFill = document.querySelector('#progressFill');
    const clock = document.querySelector('#clock');

    if (!video || !stage) return;
    stage.style.setProperty('--scene-dissolve-seconds', `${editorState.get('sceneDissolveSeconds')}s`);
    const t = video.currentTime || 0;
    const idx = sceneAt(t);

    if (idx !== editorState.get('currentScene')) {
      editorState.set('currentScene', idx);
      if (sceneImage) {
        sceneImage.src = scenes[idx]?.image || '';
        sceneImage.alt = `${scenes[idx]?.name || ''} 장면 이미지`;
      }
      applyStoredSceneCrop();
    }

    const duration = timelineDuration();
    const outroHolder = document.querySelector('#brandOutroPreview');
    const showOutro = SceneNav ? SceneNav.isOutroActive(t, duration, true) : (t >= Math.max(0, duration - 2));

    if (outroHolder) outroHolder.hidden = !showOutro;
    stage.classList.toggle('has-outro-preview', showOutro);

    const titleText = document.querySelector('#titleText');
    const currentScene = editorState.get('currentScene');
    const currentSceneItem = scenes[currentScene];
    const captionText = currentSceneItem ? (currentSceneItem.text || currentSceneItem.script || currentSceneItem.narration || currentSceneItem.line || currentSceneItem.name || '') : '';
    if (titleText) titleText.textContent = captionText;
    stage.classList.toggle('has-title', Boolean(captionText) && !showOutro);

    navigationController.sync({currentScene, showOutro, time: t, duration});

    if (progressFill) progressFill.style.width = `${duration ? Math.min(100, t / duration * 100) : 0}%`;
    if (clock) clock.textContent = `${fmt(t)} / ${fmt(duration)}`;

    syncNarration(t);
    if (!video.paused) requestAnimationFrame(sync);
  }

  function seekScene(index) {
    return navigationController.seekScene(index);
  }

  function seekOutroPreview() {
    return navigationController.seekOutro();
  }

  function togglePlay() {
    if (typeof document === 'undefined') return;
    const video = document.querySelector('#video');
    if (!video) return;
    video.paused ? video.play() : video.pause();
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
    const duration = timelineDuration();
    if (typeof document !== 'undefined') {
      const sceneTimelineSummary = document.querySelector('#sceneTimelineSummary');
      if (sceneTimelineSummary) {
        sceneTimelineSummary.textContent = `타임라인 기준 · 총 ${scenes.length}장면 · ${duration}초`;
      }
      sync();
    }
  }

  function setNarrationTracks(payload) {
    stopNarration();
    narrations = Array.isArray(payload?.narrations) ? payload.narrations.slice() : [];
    narrationAudios = Array.isArray(payload?.narrationAudios) ? payload.narrationAudios.slice() : [];
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
    const result = UIBindings?.bind({
      document,
      root: step4,
      togglePlay,
      alignMusic,
      sync,
      stopNarration,
      syncNarration,
      updatePanAvailability,
      openImageRegeneration,
      closeImageRegeneration,
      requestImageRegeneration,
      setType,
      setMusic,
      setPlatformPreview,
      setCaptionSize,
      setNarration,
      persistRenderSettings,
      getSelectedMusic: () => editorState.get('selectedMusic'),
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
    getConfiguredSettings: () => configuredSettings,
    getConfiguredCatalog: () => configuredCatalog,
    isConfigured: () => Boolean(configuredSettings),
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
