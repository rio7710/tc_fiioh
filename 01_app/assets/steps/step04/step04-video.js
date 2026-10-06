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
  let currentScene = 0;
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

  const sceneDissolveSeconds = 0.5;

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

  function restoreEditorSettings() {
    if (typeof document === 'undefined') return;
    const saved = loadEditorSettings() || {};
    const typeButtons = Array.from(document.querySelectorAll('.type-btn'));
    const musicButtons = Array.from(document.querySelectorAll('.music-btn[data-music]'));
    const platformButtons = Array.from(document.querySelectorAll('.distribution-btn'));
    const validTypes = new Set(typeButtons.map(btn => btn.dataset.type));
    const validMusic = new Set(musicButtons.map(btn => btn.dataset.music));
    const validPlatforms = new Set(platformButtons.map(btn => btn.dataset.platform));
    const restoredPlatforms = Array.isArray(saved.platforms) ? saved.platforms.filter(item => validPlatforms.has(item)) : null;

    sceneCropPositions = {};
    if (restoredPlatforms) {
      selectedPlatforms.clear();
      restoredPlatforms.forEach(item => selectedPlatforms.add(item));
    }
    platformButtons.forEach(btn => btn.setAttribute('aria-pressed', String(selectedPlatforms.has(btn.dataset.platform))));
    const musicVolume = document.querySelector('#musicVolume');
    if (musicVolume) musicVolume.value = String(Math.max(0, Math.min(1, Number.isFinite(Number(saved.volume)) ? Number(saved.volume) : 0.5)));
    setVideoPan(Number.isFinite(Number(saved.videoPanX)) ? Number(saved.videoPanX) : 50);
    setCaptionSize(Number.isFinite(Number(saved.captionSize)) ? Number(saved.captionSize) : 0);
    setNarration(saved.narration !== false);
    setType(validTypes.has(saved.type) ? saved.type : 'editorial');
    setMusic(validMusic.has(saved.music) ? saved.music : 'satie');
    setPlatformPreview(validPlatforms.has(saved.previewPlatform) ? saved.previewPlatform : 'youtube');
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

  function setMusic(track) {
    selectedMusic = track;
    if (typeof document === 'undefined') return;
    const bgm = document.querySelector('#bgm');
    const video = document.querySelector('#video');
    if (bgm && track !== 'none') {
      bgm.src = `/02_media/music/${track}.mp3`;
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
    const config = RatioProfiles ? RatioProfiles.PLATFORM_PREVIEW_FORMATS[platform] : null;
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

    applyStoredSceneCrop();
    updatePanAvailability();
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
    `).join('');
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

      if (MobileSync) {
        const mState = MobileSync.computeMobileSyncState(scenes, idx, false, t, timelineDuration());
        if (mobileSceneSelect) mobileSceneSelect.value = mState.selectedValue;
        if (mobilePrevScene) mobilePrevScene.disabled = mState.prevDisabled;
        if (mobileNextScene) mobileNextScene.disabled = mState.nextDisabled;
      }
      if (prevBtn) prevBtn.disabled = idx === 0;
      if (nextBtn) nextBtn.disabled = idx === scenes.length - 1;

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
    }

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
    scenes = source.map(scene => ({ ...scene }));
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

  // Initialization after partial HTML insertion into DOM
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
    const imageRegenerateBtn = document.querySelector('#imageRegenerateBtn');
    const imageRegenerationCancel = document.querySelector('#imageRegenerationCancel');
    const imageRegenerationCreate = document.querySelector('#imageRegenerationCreate');

    if (playBtn) playBtn.addEventListener('click', togglePlay);
    if (prevBtn) prevBtn.addEventListener('click', () => seekScene(currentScene - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => seekScene(currentScene + 1));

    if (mobileSceneSelect) {
      mobileSceneSelect.addEventListener('change', () => {
        if (mobileSceneSelect.value === 'outro') seekOutroPreview();
        else seekScene(Number(mobileSceneSelect.value));
      });
    }
    if (mobilePrevScene) mobilePrevScene.addEventListener('click', () => seekScene(currentScene - 1));
    if (mobileNextScene) mobileNextScene.addEventListener('click', () => seekScene(currentScene + 1));

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

    if (imageRegenerateBtn) imageRegenerateBtn.addEventListener('click', openImageRegeneration);
    if (imageRegenerationCancel) imageRegenerationCancel.addEventListener('click', closeImageRegeneration);
    if (imageRegenerationCreate) imageRegenerationCreate.addEventListener('click', requestImageRegeneration);

    document.querySelectorAll('.type-btn').forEach(btn => {
      btn.addEventListener('click', () => setType(btn.dataset.type));
    });
    document.querySelectorAll('.music-btn[data-music]').forEach(btn => {
      btn.addEventListener('click', () => setMusic(btn.dataset.music));
    });
    document.querySelectorAll('.platform-preview-btn').forEach(btn => {
      btn.addEventListener('click', () => setPlatformPreview(btn.dataset.platform));
    });

    isStep4Initialized = true;
    return true;
  }

  return {
    initStep4UI: initStep4UI,
    isInitialized: () => isStep4Initialized,
    applyTimeline: applyTimeline,
    sync: sync,
    seekScene: seekScene,
    seekOutroPreview: seekOutroPreview,
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
