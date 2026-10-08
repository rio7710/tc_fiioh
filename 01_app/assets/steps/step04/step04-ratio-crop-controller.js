/* Step 04 ratio preview and per-scene crop controller. */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Step04RatioCropController = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  function create(dependencies) {
    const deps = dependencies || {};
    const currentRoot = () => deps.getRoot?.() || deps.root || null;
    const query = selector => currentRoot()?.querySelector?.(selector) || null;
    const queryAll = selector => Array.from(currentRoot()?.querySelectorAll?.(selector) || []);

    function currentCropFormat() {
      const card = query('#stageCard') || query('.stage-card');
      return card && deps.RatioProfiles ? deps.RatioProfiles.calculateCropFormat(card.className) : '16x9';
    }

    function updatePanAvailability() {
      const stage = query('#stage');
      const card = query('#stageCard') || query('.stage-card');
      const video = query('#sceneVideo');
      const image = query('#sceneImage');
      if (!stage || !card || !video || !image) return false;
      const useVideo = stage.classList.contains('has-scene-video');
      const canPan = deps.RatioProfiles
        ? deps.RatioProfiles.calculatePanAvailability(card.className, useVideo ? video.videoWidth : image.naturalWidth, useVideo ? video.videoHeight : image.naturalHeight)
        : false;
      stage.classList.toggle('can-pan', canPan);
      return canPan;
    }

    function setVideoPan(value) {
      const pan = deps.RatioProfiles ? deps.RatioProfiles.clampVideoPan(value) : Math.max(0, Math.min(100, Number(value) || 50));
      deps.setVideoPanX?.(pan);
      query('#stage')?.style?.setProperty?.('--video-pan-x', `${pan}%`);
      return pan;
    }

    function setSceneCropPositions(positions) {
      if (positions && typeof positions === 'object') deps.setCropPositions?.(clone(positions));
    }

    function getSceneCropPositions() {
      return clone(deps.getCropPositions?.() || {});
    }

    function applyStoredSceneCrop() {
      const scene = (deps.getScenes?.() || [])[deps.getCurrentScene?.()];
      const pan = deps.RatioProfiles
        ? deps.RatioProfiles.getStoredSceneCropPosition(deps.getCropPositions?.() || {}, scene?.id, currentCropFormat())
        : 50;
      return setVideoPan(pan);
    }

    function storeCurrentSceneCrop() {
      const scene = (deps.getScenes?.() || [])[deps.getCurrentScene?.()];
      if (!scene || !deps.RatioProfiles) return null;
      const result = deps.RatioProfiles.storeSceneCropPosition(
        deps.getCropPositions?.() || {}, deps.getActiveProjectId?.() || null,
        scene.id, currentCropFormat(), deps.getVideoPanX?.()
      );
      deps.setCropPositions?.(clone(result.updatedPositions));
      return clone(result.payload);
    }

    async function persistCurrentSceneCrop() {
      const position = storeCurrentSceneCrop();
      deps.saveEditorSettings?.();
      if (!position?.project_id || typeof deps.api !== 'function') return undefined;
      try {
        return await deps.api('/api/project/crop-position', { method: 'POST', body: JSON.stringify(position) });
      } catch (error) {
        deps.onError?.('씬 크롭 위치 저장 실패', error);
        return undefined;
      }
    }

    function safeCallback(name) {
      try { deps[name]?.(); }
      catch (error) { deps.onError?.(name, error); }
    }

    function setPlatformPreview(platform) {
      if (!currentRoot()) return undefined;
      const config = deps.RatioProfiles?.getPlatformFormat
        ? deps.RatioProfiles.getPlatformFormat(platform)
        : deps.RatioProfiles?.PLATFORM_PREVIEW_FORMATS?.[platform];
      const format = config || { className: 'preview-landscape', label: 'YouTube · 16:9', safe: '' };
      deps.setCurrentPreviewPlatform?.(platform);
      const card = query('#stageCard') || query('.stage-card');
      if (card) {
        card.classList.remove('preview-landscape', 'preview-portrait', 'preview-feed', 'preview-square');
        card.classList.add(format.className);
      }
      const badge = query('#previewFormatBadge');
      if (badge) badge.textContent = format.label;
      const safe = query('#formatSafeZone');
      if (safe) safe.dataset.label = format.safe;
      queryAll('.platform-preview-btn').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.platform === platform)));
      const formatKey = deps.RatioProfiles ? deps.RatioProfiles.calculateCropFormat(format.className) : '16x9';
      queryAll('.ratio-btn').forEach(button => {
        const match = button.dataset.ratio === formatKey || (deps.RatioProfiles && deps.RatioProfiles.calculateCropFormat(button.dataset.ratio) === formatKey);
        button.classList.toggle('active', Boolean(match));
        button.setAttribute('aria-pressed', String(Boolean(match)));
      });
      applyStoredSceneCrop();
      updatePanAvailability();
      safeCallback('updateWatermarkPreview');
      safeCallback('updateCommonOutroPreview');
      deps.saveEditorSettings?.();
      return { ...format, formatKey };
    }

    return { currentCropFormat, updatePanAvailability, setVideoPan, setSceneCropPositions, getSceneCropPositions, applyStoredSceneCrop, storeCurrentSceneCrop, persistCurrentSceneCrop, setPlatformPreview };
  }

  return { create };
}));
