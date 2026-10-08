/* Step 04 editor settings controller. */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Step04SettingsController = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function create(d) {
    d = d || {};
    let configuredSettings = null;
    let configuredCatalog = null;
    const root = () => d.getRoot?.() || d.root || null;
    const query = selector => root()?.querySelector?.(selector) || null;
    const all = selector => Array.from(root()?.querySelectorAll?.(selector) || []);
    const get = key => d.getState?.(key);
    const set = (key, value) => d.setState?.(key, value);
    const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;

    function saveEditorSettings() {
      if (!d.storage) return;
      try {
        d.storage.setItem(d.storageKey, JSON.stringify({
          type: get('currentType'), music: get('selectedMusic'),
          volume: query('#musicVolume')?.value || '0.5', videoPanX: get('videoPanX'),
          captionSize: get('captionSizeLevel'), narration: get('narrationEnabled'),
          previewPlatform: get('currentPreviewPlatform'), platforms: Array.from(get('selectedPlatforms') || [])
        }));
      } catch (error) { d.onError?.('settings-save', error); }
    }
    function loadEditorSettings() {
      if (!d.storage) return null;
      try { const raw = d.storage.getItem(d.storageKey); return raw ? JSON.parse(raw) : null; }
      catch (error) { d.onError?.('settings-load', error); return null; }
    }
    function getEffectiveSettingsPayload() {
      const volume = query('#musicVolume');
      const vol = volume ? Number(volume.value) : get('currentVolume');
      return {
        type: get('currentType'), music: get('selectedMusic'), volume: clamp(vol, 0, 1, .5),
        narration: get('narrationEnabled'), preview_platform: get('currentPreviewPlatform'),
        platforms: Array.from(get('selectedPlatforms') || []), video_pan_x: get('videoPanX') / 100,
        scene_dissolve_seconds: get('sceneDissolveSeconds'), caption_size: get('captionSizeLevel')
      };
    }
    async function persistRenderSettings() {
      saveEditorSettings();
      if (typeof d.api !== 'function') return undefined;
      try {
        return await d.api('/api/render-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schema_version: 'render-settings.v1', overrides: getEffectiveSettingsPayload() }) });
      } catch (error) {
        d.onError?.('render-settings-save', error);
        const status = query('#renderStatus'); if (status) status.textContent = '설정 저장 실패 (오프라인/오류)';
        return undefined;
      }
    }
    function restoreEditorSettings(settingsOverride) {
      const apiSettings = settingsOverride || configuredSettings;
      const localCache = loadEditorSettings() || {};
      const source = apiSettings || localCache;
      if (!source) return;
      const typeButtons = all('.type-btn');
      const musicButtons = all('.music-btn[data-music]');
      const platformButtons = all('.distribution-btn');
      const validTypes = new Set(typeButtons.map(button => button.dataset.type));
      const validMusic = new Set(musicButtons.map(button => button.dataset.music));
      const validPlatforms = new Set(platformButtons.map(button => button.dataset.platform));
      const preferred = source.platforms;
      const restored = Array.isArray(preferred) ? preferred.filter(item => validPlatforms.size === 0 || validPlatforms.has(item)) : null;
      set('sceneCropPositions', {});
      if (restored) set('selectedPlatforms', new Set(restored));
      const selected = get('selectedPlatforms') || new Set();
      platformButtons.forEach(button => button.setAttribute('aria-pressed', String(selected.has(button.dataset.platform))));
      if (source.volume !== undefined) set('currentVolume', clamp(source.volume, 0, 1, .5));
      const volume = query('#musicVolume'); if (volume) volume.value = String(get('currentVolume'));
      const rawPan = source.video_pan_x !== undefined ? source.video_pan_x : source.videoPanX;
      let pan = 50;
      if (Number.isFinite(Number(rawPan))) { const num = Number(rawPan); pan = num <= 1 ? num * 100 : num; }
      d.setVideoPan(pan);
      const caption = source.caption_size !== undefined ? source.caption_size : source.captionSize;
      d.setCaptionSize(Number.isFinite(Number(caption)) ? Number(caption) : 0);
      d.setNarration(source.narration !== false);
      d.setType(validTypes.size === 0 || validTypes.has(source.type) ? source.type : 'editorial');
      d.setMusic(validMusic.size === 0 || validMusic.has(source.music) ? source.music : 'satie');
      const platform = source.preview_platform || source.previewPlatform;
      d.setPlatformPreview(validPlatforms.size === 0 || validPlatforms.has(platform) ? platform : 'youtube');
      const dissolve = source.scene_dissolve_seconds !== undefined ? source.scene_dissolve_seconds : source.sceneDissolveSeconds;
      d.setSceneDissolveSeconds(Number.isFinite(Number(dissolve)) ? Number(dissolve) : .5);
      saveEditorSettings();
    }
    function configure(settings, catalog) {
      if (catalog) { configuredCatalog = catalog; d.configureRatioCatalog?.(catalog); }
      if (settings && typeof settings === 'object') {
        configuredSettings = settings;
        if (settings.type !== undefined) set('currentType', settings.type);
        if (settings.music !== undefined) set('selectedMusic', settings.music);
        if (settings.preview_platform !== undefined || settings.previewPlatform !== undefined) set('currentPreviewPlatform', settings.preview_platform || settings.previewPlatform);
        if (Array.isArray(settings.platforms)) set('selectedPlatforms', new Set(settings.platforms));
        if (settings.volume !== undefined) set('currentVolume', clamp(settings.volume, 0, 1, .5));
        const rawPan = settings.video_pan_x !== undefined ? settings.video_pan_x : settings.videoPanX;
        if (Number.isFinite(Number(rawPan))) { const num = Number(rawPan); set('videoPanX', d.clampVideoPan ? d.clampVideoPan(num <= 1 ? num * 100 : num) : clamp(num <= 1 ? num * 100 : num, 0, 100, 50)); }
        const dissolve = settings.scene_dissolve_seconds !== undefined ? settings.scene_dissolve_seconds : settings.sceneDissolveSeconds;
        if (Number.isFinite(Number(dissolve))) set('sceneDissolveSeconds', clamp(dissolve, 0, 3, .5));
        const caption = settings.caption_size !== undefined ? settings.caption_size : settings.captionSize;
        if (Number.isFinite(Number(caption))) set('captionSizeLevel', clamp(caption, -5, 5, 0));
        if (settings.narration !== undefined) set('narrationEnabled', Boolean(settings.narration));
        restoreEditorSettings(settings);
      }
      return { settings: configuredSettings, catalog: configuredCatalog };
    }
    return { configure, getConfiguredSettings:()=>configuredSettings, getConfiguredCatalog:()=>configuredCatalog, isConfigured:()=>Boolean(configuredSettings), getEffectiveSettingsPayload, persistRenderSettings, saveEditorSettings, loadEditorSettings, restoreEditorSettings };
  }
  return { create };
}));
