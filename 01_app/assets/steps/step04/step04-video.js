/* Step 04 Video Editor Isolated JS Controller */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['/01_app/assets/video-editor/index.js'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../../video-editor/index.js'));
  } else {
    root.Step04VideoEditor = factory(root.VideoEditor);
  }
}(typeof self !== 'undefined' ? self : this, function (VideoEditor) {
  'use strict';

  const { SceneNav, RatioProfiles, BrandSelection, MobileSync } = VideoEditor || {};

  // Step 4 State (Single Source of Truth)
  let scenes = [];
  let currentScene = -1;
  let currentType = 'editorial';
  let selectedMusic = 'satie';
  let currentPreviewPlatform = 'youtube';
  let selectedPlatforms = new Set(['youtube', 'instagram', 'naver']);
  let sceneCropPositions = {};
  let videoPanX = 50;
  let captionSizeLevel = 0;
  let narrationEnabled = true;
  let activeNarration = -1;
  let pendingDissolveOverlay = null;
  let isStep4Initialized = false;
  let configuredSettings = null;
  let configuredCatalog = null;
  let sceneDissolveSeconds = 0.5;
  let currentVolume = 0.5;

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
    videoPanX = RatioProfiles ? RatioProfiles.clampVideoPan(value) : Math.max(0, Math.min(100, Number(value) || 50));
    if (typeof document === 'undefined') return;
    const stage = document.querySelector('#stage');
    if (stage) stage.style.setProperty('--video-pan-x', `${videoPanX}%`);
  }

  function setSceneDissolveSeconds(seconds) {
    const val = Number.isFinite(Number(seconds)) ? Math.max(0, Math.min(3, Number(seconds))) : 0.5;
    sceneDissolveSeconds = val;
    if (typeof document !== 'undefined') {
      const stage = document.querySelector('#stage');
      if (stage) stage.style.setProperty('--scene-dissolve-seconds', `${sceneDissolveSeconds}s`);
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
      if (settings.type !== undefined) currentType = settings.type;
      if (settings.music !== undefined) selectedMusic = settings.music;
      if (settings.preview_platform !== undefined || settings.previewPlatform !== undefined) {
        currentPreviewPlatform = settings.preview_platform || settings.previewPlatform;
      }
      if (Array.isArray(settings.platforms)) {
        selectedPlatforms.clear();
        settings.platforms.forEach(p => selectedPlatforms.add(p));
      }
      const rawVolume = settings.volume;
      if (rawVolume !== undefined) {
        currentVolume = Number.isFinite(Number(rawVolume)) ? Math.max(0, Math.min(1, Number(rawVolume))) : 0.5;
      }
      const rawPan = settings.video_pan_x !== undefined ? settings.video_pan_x : settings.videoPanX;
      if (Number.isFinite(Number(rawPan))) {
        const numPan = Number(rawPan);
        const panPercent = numPan <= 1.0 ? numPan * 100 : numPan;
        videoPanX = RatioProfiles ? RatioProfiles.clampVideoPan(panPercent) : Math.max(0, Math.min(100, panPercent));
      }
      const rawDissolve = settings.scene_dissolve_seconds !== undefined ? settings.scene_dissolve_seconds : settings.sceneDissolveSeconds;
      if (Number.isFinite(Number(rawDissolve))) {
        sceneDissolveSeconds = Math.max(0, Math.min(3, Number(rawDissolve)));
      }
      const rawCaptionSize = settings.caption_size !== undefined ? settings.caption_size : settings.captionSize;
      if (Number.isFinite(Number(rawCaptionSize))) {
        captionSizeLevel = Math.max(-5, Math.min(5, Number(rawCaptionSize)));
      }
      if (settings.narration !== undefined) {
        narrationEnabled = Boolean(settings.narration);
      }
      restoreEditorSettings(settings);
    }
    return { settings: configuredSettings, catalog: configuredCatalog };
  }

  function getEffectiveSettingsPayload() {
    const musicVolume = typeof document !== 'undefined' ? document.querySelector('#musicVolume') : null;
    const vol = musicVolume ? Number(musicVolume.value) : currentVolume;
    return {
      type: currentType,
      music: selectedMusic,
      volume: Number.isFinite(vol) ? Math.max(0, Math.min(1, vol)) : 0.5,
      narration: narrationEnabled,
      preview_platform: currentPreviewPlatform,
      platforms: Array.from(selectedPlatforms),
      video_pan_x: videoPanX / 100,
      scene_dissolve_seconds: sceneDissolveSeconds,
      caption_size: captionSizeLevel
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
      sceneCropPositions = JSON.parse(JSON.stringify(positions));
    }
  }

  function getSceneCropPositions() {
    return JSON.parse(JSON.stringify(sceneCropPositions || {}));
  }

  function applyStoredSceneCrop() {
    const scene = scenes[currentScene];
    const format = currentCropFormat();
    const panX = RatioProfiles ? RatioProfiles.getStoredSceneCropPosition(sceneCropPositions, scene?.id, format) : 50;
    setVideoPan(panX);
  }

  function storeCurrentSceneCrop() {
    const scene = scenes[currentScene];
    const format = currentCropFormat();
    if (!scene || !RatioProfiles) return null;
    const activeProjectId = (typeof window !== 'undefined' && window.activeProjectId) ? window.activeProjectId : null;
    const res = RatioProfiles.storeSceneCropPosition(sceneCropPositions, activeProjectId, scene.id, format, videoPanX);
    sceneCropPositions = res.updatedPositions;
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
        type: currentType,
        music: selectedMusic,
        volume: (typeof document !== 'undefined' && document.querySelector('#musicVolume')?.value) || '0.5',
        videoPanX: videoPanX,
        captionSize: captionSizeLevel,
        narration: narrationEnabled,
        previewPlatform: currentPreviewPlatform,
        platforms: Array.from(selectedPlatforms)
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

    sceneCropPositions = {};
    if (restoredPlatforms) {
      selectedPlatforms.clear();
      restoredPlatforms.forEach(item => selectedPlatforms.add(item));
    }
    if (hasDoc) {
      platformButtons.forEach(btn => btn.setAttribute('aria-pressed', String(selectedPlatforms.has(btn.dataset.platform))));
    }

    const musicVolume = hasDoc ? document.querySelector('#musicVolume') : null;
    const rawVolume = source.volume;
    if (rawVolume !== undefined) {
      currentVolume = Number.isFinite(Number(rawVolume)) ? Math.max(0, Math.min(1, Number(rawVolume))) : 0.5;
    }
    if (musicVolume) musicVolume.value = String(currentVolume);

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
    captionSizeLevel = Math.max(-5, Math.min(5, level));
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
    narrationEnabled = Boolean(enabled);
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
    currentType = type;
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
    selectedMusic = track;
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
    currentPreviewPlatform = platform;
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
    if (typeof window.updateWatermarkPreview === 'function') window.updateWatermarkPreview();
    if (typeof window.updateCommonOutroPreview === 'function') window.updateCommonOutroPreview();
    saveEditorSettings();
  }

  function stopNarration() {
    if (typeof window !== 'undefined' && activeNarration >= 0 && window.narrationAudios?.[activeNarration]) {
      window.narrationAudios[activeNarration].pause();
    }
    activeNarration = -1;
  }

  function startNarration(index, t) {
    if (typeof window === 'undefined') return;
    const narrations = window.narrations || [];
    const narrationAudios = window.narrationAudios || [];
    if (!narrationEnabled || index < 0 || !narrations[index] || !narrationAudios[index]) {
      stopNarration();
      return;
    }
    const target = narrations[index];
    const audio = narrationAudios[index];
    const duration = Math.max(0.001, target.end - target.start);
    const audioDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
    const targetTime = Math.min(Math.max(0, audioDuration - 0.03), Math.max(0, t - target.start) / duration * audioDuration);

    if (activeNarration !== index) {
      stopNarration();
      activeNarration = index;
      audio.currentTime = targetTime;
      audio.play().catch(() => {});
    } else if (Math.abs(audio.currentTime - targetTime) > 0.25) {
      audio.currentTime = targetTime;
      if (audio.paused) audio.play().catch(() => {});
    }
  }

  function syncNarration(t, force = false) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const narrations = window.narrations || [];
    const video = document.querySelector('#video');
    if (!narrationEnabled || !video || video.paused) {
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
    if (!video || !bgm || selectedMusic === 'none') return;
    if (bgm.readyState >= 1 && Number.isFinite(bgm.duration) && bgm.duration > 0) {
      const targetTime = video.currentTime % bgm.duration;
      if (Math.abs(bgm.currentTime - targetTime) > 0.25) bgm.currentTime = targetTime;
    }
  }

  function renderSceneList() {
    if (typeof document === 'undefined') return;
    const sceneList = document.querySelector('#sceneList');
    if (!sceneList) return;
    sceneList.innerHTML = scenes.map((scene, i) => `
      <button class="scene-btn ${i === currentScene ? 'active' : ''}" type="button" data-index="${i}">
        <span class="scene-no">${String(i + 1).padStart(2, '0')}</span>
        <span class="scene-name">${scene.name || `장면 ${i + 1}`}</span>
        <span class="scene-time">${fmt(scene.start)}~${fmt(scene.end)}</span>
      </button>
    `).join('') + `
      <button class="scene-btn scene-outro-btn" type="button" data-outro="true">
        <span class="scene-no">OUT</span>
        <span class="scene-name">엔딩 카피 &amp; 브랜딩</span>
        <span class="scene-time">END · ${fmt(timelineDuration())}</span>
      </button>
    `;

    const mobileSceneSelect = document.querySelector('#mobileSceneSelect');
    if (mobileSceneSelect && MobileSync) {
      const mobileState = MobileSync.computeMobileSyncState(
        scenes,
        currentScene,
        false,
        0,
        timelineDuration()
      );
      mobileSceneSelect.innerHTML = mobileState.options.map(option =>
        `<option value="${option.value}">${option.label}</option>`
      ).join('');
    }
  }

  function currentNavigationState() {
    const video = typeof document !== 'undefined' ? document.querySelector('#video') : null;
    const time = video ? video.currentTime || 0 : 0;
    return SceneNav
      ? SceneNav.createInitialNavigationState(scenes, { initialTime: time, outroEnabled: true })
      : null;
  }

  function navigatePreview(action) {
    if (!scenes.length || !SceneNav) return null;
    const nextState = SceneNav.navigateScene(scenes, currentNavigationState(), action, { outroEnabled: true });
    if (typeof document !== 'undefined') {
      const video = document.querySelector('#video');
      if (video) {
        video.currentTime = nextState.currentTime;
        sync();
      }
    }
    return nextState;
  }

  function sync() {
    if (!scenes.length || typeof document === 'undefined') return;
    const video = document.querySelector('#video');
    const stage = document.querySelector('#stage');
    const sceneImage = document.querySelector('#sceneImage');
    const mobileSceneSelect = document.querySelector('#mobileSceneSelect');
    const mobilePrevScene = document.querySelector('#mobilePrevScene');
    const mobileNextScene = document.querySelector('#mobileNextScene');
    const prevBtn = document.querySelector('#prevBtn');
    const nextBtn = document.querySelector('#nextBtn');
    const progressFill = document.querySelector('#progressFill');
    const clock = document.querySelector('#clock');

    if (!video || !stage) return;
    stage.style.setProperty('--scene-dissolve-seconds', `${sceneDissolveSeconds}s`);
    const t = video.currentTime || 0;
    const idx = sceneAt(t);

    if (idx !== currentScene) {
      currentScene = idx;
      if (sceneImage) {
        sceneImage.src = scenes[idx]?.image || '';
        sceneImage.alt = `${scenes[idx]?.name || ''} 장면 이미지`;
      }
      document.querySelectorAll('.scene-btn').forEach((el, i) => el.classList.toggle('active', i === idx));
      document.querySelector('.scene-btn.active')?.scrollIntoView({ block: 'nearest' });

      applyStoredSceneCrop();
    }

    const duration = timelineDuration();
    const outroHolder = document.querySelector('#brandOutroPreview');
    const showOutro = SceneNav ? SceneNav.isOutroActive(t, duration, true) : (t >= Math.max(0, duration - 2));

    if (outroHolder) outroHolder.hidden = !showOutro;
    stage.classList.toggle('has-outro-preview', showOutro);

    if (MobileSync) {
      const mState = MobileSync.computeMobileSyncState(scenes, currentScene, showOutro, t, duration);
      if (mobileSceneSelect) mobileSceneSelect.value = mState.selectedValue;
      if (mobilePrevScene) mobilePrevScene.disabled = mState.prevDisabled;
      if (mobileNextScene) mobileNextScene.disabled = mState.nextDisabled;
      if (prevBtn) prevBtn.disabled = mState.prevDisabled;
      if (nextBtn) nextBtn.disabled = mState.nextDisabled;
    }
    document.querySelectorAll('.scene-btn').forEach((el, i) => {
      const selected = el.dataset.outro === 'true' ? showOutro : (!showOutro && i === currentScene);
      el.classList.toggle('active', selected);
      el.setAttribute('aria-current', selected ? 'true' : 'false');
    });
    document.querySelector('.scene-btn.active')?.scrollIntoView({ block: 'nearest' });

    if (progressFill) progressFill.style.width = `${duration ? Math.min(100, t / duration * 100) : 0}%`;
    if (clock) clock.textContent = `${fmt(t)} / ${fmt(duration)}`;

    syncNarration(t);
    if (!video.paused) requestAnimationFrame(sync);
  }

  function seekScene(index) {
    if (!scenes.length) return;
    const safe = Math.max(0, Math.min(scenes.length - 1, index));
    const scene = scenes[safe];
    const targetTime = SceneNav ? SceneNav.calculateSceneSeekTime(scene) : (scene.text ? scene.cueStart + 0.05 : scene.start + 0.05);
    if (typeof document !== 'undefined') {
      const video = document.querySelector('#video');
      if (video) {
        video.currentTime = targetTime;
        sync();
      }
    }
  }

  function seekOutroPreview() {
    const duration = timelineDuration();
    const targetTime = SceneNav ? SceneNav.calculateOutroSeekTime(duration) : Math.max(0, duration - 0.05);
    if (typeof document !== 'undefined') {
      const video = document.querySelector('#video');
      if (video) {
        video.currentTime = targetTime;
        sync();
      }
    }
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
      image: scene.image || scene.preview_uri || '',
      cueStart: scene.cueStart != null ? Number(scene.cueStart) : (scene.cue_start != null ? Number(scene.cue_start) : Number(scene.start || 0)),
      cueEnd: scene.cueEnd != null ? Number(scene.cueEnd) : (scene.cue_end != null ? Number(scene.cue_end) : Number(scene.end || 0))
    }));
    currentScene = -1;
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

    const video = document.querySelector('#video');
    const playBtn = document.querySelector('#playBtn');
    const prevBtn = document.querySelector('#prevBtn');
    const nextBtn = document.querySelector('#nextBtn');
    const mobileSceneSelect = document.querySelector('#mobileSceneSelect');
    const mobilePrevScene = document.querySelector('#mobilePrevScene');
    const mobileNextScene = document.querySelector('#mobileNextScene');
    const sceneList = document.querySelector('#sceneList');
    const renderBtn = document.querySelector('#renderBtn');
    const imageRegenerateBtn = document.querySelector('#imageRegenerateBtn');
    const imageRegenerationCancel = document.querySelector('#imageRegenerationCancel');
    const imageRegenerationCreate = document.querySelector('#imageRegenerationCreate');
    const imageRegenerationModal = document.querySelector('#imageRegenerationModal');

    if (playBtn) playBtn.addEventListener('click', togglePlay);
    if (prevBtn) prevBtn.addEventListener('click', () => navigatePreview('PREV_SCENE'));
    if (nextBtn) nextBtn.addEventListener('click', () => navigatePreview('NEXT_SCENE'));

    if (mobileSceneSelect) {
      mobileSceneSelect.addEventListener('change', () => {
        const action = MobileSync
          ? MobileSync.resolveMobileSelectChange(mobileSceneSelect.value, scenes, true)
          : (mobileSceneSelect.value === 'outro'
              ? { type: 'SEEK_OUTRO' }
              : { type: 'SEEK_SCENE', index: Number(mobileSceneSelect.value) });
        navigatePreview(action);
      });
    }
    if (mobilePrevScene) mobilePrevScene.addEventListener('click', () => navigatePreview('PREV_SCENE'));
    if (mobileNextScene) mobileNextScene.addEventListener('click', () => navigatePreview('NEXT_SCENE'));

    if (sceneList) {
      sceneList.addEventListener('click', e => {
        const btn = e.target.closest('.scene-btn');
        if (!btn) return;
        if (btn.dataset.outro === 'true') seekOutroPreview();
        else seekScene(Number(btn.dataset.index));
      });
    }

    if (video) {
      video.addEventListener('play', () => {
        if (playBtn) { playBtn.textContent = '일시정지'; playBtn.setAttribute('aria-label', '일시정지'); }
        const bgm = document.querySelector('#bgm');
        if (selectedMusic !== 'none' && bgm) { alignMusic(); bgm.play().catch(() => {}); }
        sync();
      });
      video.addEventListener('pause', () => {
        if (playBtn) { playBtn.textContent = '재생'; playBtn.setAttribute('aria-label', '재생'); }
        const sceneVideoEl = document.querySelector('#sceneVideo');
        const bgmEl = document.querySelector('#bgm');
        if (sceneVideoEl) sceneVideoEl.pause();
        if (bgmEl) bgmEl.pause();
        stopNarration();
        sync();
      });
      video.addEventListener('seeked', () => {
        alignMusic();
        syncNarration(video.currentTime, true);
        sync();
      });
      video.addEventListener('loadedmetadata', () => {
        updatePanAvailability();
        sync();
      });
      video.addEventListener('ended', () => {
        const bgmEl = document.querySelector('#bgm');
        if (bgmEl) bgmEl.pause();
        sync();
      });
    }

    if (renderBtn) {
      renderBtn.addEventListener('click', async () => {
        if (typeof window.startRenderWorkflow === 'function') {
          await window.startRenderWorkflow();
        }
      });
    }

    if (imageRegenerateBtn) imageRegenerateBtn.addEventListener('click', openImageRegeneration);
    if (imageRegenerationCancel) imageRegenerationCancel.addEventListener('click', closeImageRegeneration);
    if (imageRegenerationCreate) imageRegenerationCreate.addEventListener('click', requestImageRegeneration);

    if (imageRegenerationModal) {
      imageRegenerationModal.addEventListener('pointerdown', event => {
        if (event.target === imageRegenerationModal) closeImageRegeneration();
      });
    }

    const distributionHelp = document.querySelector('#distributionHelp');
    if (distributionHelp) {
      distributionHelp.addEventListener('click', () => {
        const platformGuideModal = document.querySelector('#platformGuideModal');
        if (platformGuideModal) {
          platformGuideModal.hidden = false;
          document.body.classList.add('modal-open');
        }
      });
    }

    document.querySelectorAll('#brandIntroEnabled,#brandIntroVersion,#brandOutroEnabled,#brandOutroVersion,#brandWatermarkEnabled,#brandWatermarkVersion,#brandWatermarkOpacity').forEach(control => {
      control.addEventListener('change', event => {
        if (typeof window.ensureOutroRatioAssets === 'function' && event.target.id === 'brandOutroVersion') {
          const brandAssets = window.brandAssets || [];
          window.ensureOutroRatioAssets(brandAssets.find(item => item.version_id === event.target.value));
        }
        if (typeof window.updateWatermarkPreview === 'function') window.updateWatermarkPreview();
        if (typeof window.updateCommonOutroPreview === 'function') window.updateCommonOutroPreview();
        if (typeof window.saveBrandSelections === 'function') {
          window.saveBrandSelections().catch(error => {
            const rs = document.querySelector('#renderStatus');
            if (rs) rs.textContent = error.message;
          });
        }
      });
    });

    document.querySelectorAll('.type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        setType(btn.dataset.type);
        persistRenderSettings();
      });
    });
    document.querySelectorAll('.music-btn[data-music]').forEach(btn => {
      btn.addEventListener('click', () => {
        setMusic(btn.dataset.music);
        persistRenderSettings();
      });
    });
    document.querySelectorAll('.platform-preview-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        setPlatformPreview(btn.dataset.platform);
        persistRenderSettings();
      });
    });
    document.querySelectorAll('.ratio-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const platform = btn.dataset.platform || (btn.dataset.ratio === '9x16' ? 'instagram' : btn.dataset.ratio === '4x5' ? 'facebook' : btn.dataset.ratio === '1x1' ? 'square' : 'youtube');
        setPlatformPreview(platform);
        persistRenderSettings();
      });
    });

    const captionSizeDown = document.querySelector('#captionSizeDown');
    const captionSizeUp = document.querySelector('#captionSizeUp');
    if (captionSizeDown) {
      captionSizeDown.addEventListener('click', () => {
        setCaptionSize(captionSizeLevel - 1);
        persistRenderSettings();
      });
    }
    if (captionSizeUp) {
      captionSizeUp.addEventListener('click', () => {
        setCaptionSize(captionSizeLevel + 1);
        persistRenderSettings();
      });
    }

    const narrationBtn = document.querySelector('#narrationBtn');
    if (narrationBtn) {
      narrationBtn.addEventListener('click', () => {
        setNarration(!narrationEnabled);
        persistRenderSettings();
      });
    }

    const musicVolume = document.querySelector('#musicVolume');
    if (musicVolume) {
      musicVolume.addEventListener('input', () => {
        currentVolume = Number(musicVolume.value);
        saveEditorSettings();
        persistRenderSettings();
      });
    }

    document.querySelectorAll('.distribution-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const platform = btn.dataset.platform;
        if (!platform) return;
        if (selectedPlatforms.has(platform)) {
          selectedPlatforms.delete(platform);
        } else {
          selectedPlatforms.add(platform);
        }
        btn.setAttribute('aria-pressed', String(selectedPlatforms.has(platform)));
        saveEditorSettings();
        persistRenderSettings();
      });
    });

    restoreEditorSettings();
    isStep4Initialized = true;
    return true;
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('click', event => {
      const ratioBtn = event.target.closest('.ratio-btn');
      if (ratioBtn) {
        const platform = ratioBtn.dataset.platform || (ratioBtn.dataset.ratio === '9x16' ? 'instagram' : ratioBtn.dataset.ratio === '4x5' ? 'facebook' : ratioBtn.dataset.ratio === '1x1' ? 'square' : 'youtube');
        setPlatformPreview(platform);
        persistRenderSettings();
        return;
      }
      const platformBtn = event.target.closest('.platform-preview-btn');
      if (platformBtn) {
        setPlatformPreview(platformBtn.dataset.platform);
        persistRenderSettings();
        return;
      }
    });
  }

  return {
    configure: configure,
    getConfiguredSettings: () => configuredSettings,
    getConfiguredCatalog: () => configuredCatalog,
    isConfigured: () => Boolean(configuredSettings),
    persistRenderSettings: persistRenderSettings,
    setSceneDissolveSeconds: setSceneDissolveSeconds,
    getSceneDissolveSeconds: () => sceneDissolveSeconds,
    getEffectiveSettingsPayload: getEffectiveSettingsPayload,
    getSceneCropPositions: getSceneCropPositions,
    setSceneCropPositions: setSceneCropPositions,
    initStep4UI: initStep4UI,
    isInitialized: () => isStep4Initialized,
    applyTimeline: applyTimeline,
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
    requestImageRegeneration: requestImageRegeneration
  };
}));
