(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.VideoEditorRatioProfiles = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RATIO_PROFILES = {
    '16x9': {
      key: '16x9',
      label: '16:9 Landscape',
      aspectRatio: 16 / 9,
      width: 1920,
      height: 1080,
      defaultWidth: 1280,
      defaultHeight: 720,
      className: 'preview-landscape',
      safeZoneLabel: '',
      platforms: ['youtube', 'naver', 'kakaotalk', 'x']
    },
    '9x16': {
      key: '9x16',
      label: '9:16 Vertical / Short-form',
      aspectRatio: 9 / 16,
      width: 1080,
      height: 1920,
      defaultWidth: 720,
      defaultHeight: 1280,
      className: 'preview-portrait',
      safeZoneLabel: 'REELS SAFE AREA',
      platforms: ['instagram', 'tiktok', 'threads']
    },
    '4x5': {
      key: '4x5',
      label: '4:5 Feed Portrait',
      aspectRatio: 4 / 5,
      width: 1080,
      height: 1350,
      defaultWidth: 720,
      defaultHeight: 900,
      className: 'preview-feed',
      safeZoneLabel: 'FEED SAFE AREA',
      platforms: ['facebook', 'linkedin']
    },
    '1x1': {
      key: '1x1',
      label: '1:1 Square',
      aspectRatio: 1 / 1,
      width: 1080,
      height: 1080,
      defaultWidth: 720,
      defaultHeight: 720,
      className: 'preview-square',
      safeZoneLabel: 'SQUARE SAFE AREA',
      platforms: ['square']
    }
  };

  const PLATFORM_PREVIEW_FORMATS = {
    youtube: { formatKey: '16x9', className: 'preview-landscape', label: 'YouTube · 16:9', safe: '' },
    instagram: { formatKey: '9x16', className: 'preview-portrait', label: 'Instagram Reels · 9:16', safe: 'REELS SAFE AREA' },
    facebook: { formatKey: '4x5', className: 'preview-feed', label: 'Facebook Feed · 4:5', safe: 'FEED SAFE AREA' },
    tiktok: { formatKey: '9x16', className: 'preview-portrait', label: 'TikTok · 9:16', safe: 'SHORT-FORM SAFE AREA' },
    naver: { formatKey: '16x9', className: 'preview-landscape', label: '네이버 블로그 · 16:9', safe: '' },
    kakaotalk: { formatKey: '16x9', className: 'preview-landscape', label: '카카오톡 채널 · 16:9', safe: '' },
    threads: { formatKey: '9x16', className: 'preview-portrait', label: 'Threads · 9:16 · 720×1280', safe: 'VERTICAL SAFE AREA' },
    x: { formatKey: '16x9', className: 'preview-landscape', label: 'X · 16:9 · 1280×720', safe: '' },
    linkedin: { formatKey: '4x5', className: 'preview-feed', label: 'LinkedIn · 4:5 · 720×900', safe: 'FEED SAFE AREA' },
    square: { formatKey: '1x1', className: 'preview-square', label: 'Square Feed · 1:1 · 1080×1080', safe: 'SQUARE SAFE AREA' }
  };

  let activeRatioProfiles = { ...RATIO_PROFILES };
  let activePlatformFormats = { ...PLATFORM_PREVIEW_FORMATS };

  function configureCatalog(catalog) {
    if (!catalog) return;
    if (catalog.ratio_profiles && typeof catalog.ratio_profiles === 'object') {
      Object.assign(activeRatioProfiles, catalog.ratio_profiles);
    }
    if (catalog.platform_preview_formats && typeof catalog.platform_preview_formats === 'object') {
      Object.assign(activePlatformFormats, catalog.platform_preview_formats);
    }
  }

  function getProfileByKey(key) {
    if (!key) return activeRatioProfiles['16x9'] || RATIO_PROFILES['16x9'];
    const normalized = String(key).toLowerCase().trim();
    const aliases = {
      landscape: '16x9', 'preview-landscape': '16x9',
      portrait: '9x16', 'preview-portrait': '9x16',
      feed: '4x5', 'preview-feed': '4x5',
      square: '1x1', 'preview-square': '1x1'
    };
    const resolveToken = token => {
      const profileKey = aliases[token] || token;
      if (activeRatioProfiles[profileKey] || RATIO_PROFILES[profileKey]) {
        return activeRatioProfiles[profileKey] || RATIO_PROFILES[profileKey];
      }
      return Object.values(activeRatioProfiles).find(profile => String(profile?.className || '').toLowerCase() === token)
        || Object.values(RATIO_PROFILES).find(profile => String(profile?.className || '').toLowerCase() === token);
    };
    return resolveToken(normalized)
      || normalized.split(/\s+/).map(resolveToken).find(Boolean)
      || activeRatioProfiles['16x9'] || RATIO_PROFILES['16x9'];
  }

  function getProfileByPlatform(platform) {
    const p = String(platform || '').toLowerCase().trim();
    const config = activePlatformFormats[p] || PLATFORM_PREVIEW_FORMATS[p];
    if (config) {
      return getProfileByKey(config.formatKey);
    }
    return activeRatioProfiles['16x9'] || RATIO_PROFILES['16x9'];
  }

  function calculateCropFormat(keyOrClassName) {
    const profile = getProfileByKey(keyOrClassName);
    return profile.key;
  }

  function calculatePanAvailability(formatKeyOrClassName, sourceMediaWidth, sourceMediaHeight) {
    const cropFormat = calculateCropFormat(formatKeyOrClassName);
    const isNonLandscapeTarget = cropFormat === '9x16' || cropFormat === '4x5' || cropFormat === '1x1';
    const width = Number(sourceMediaWidth) || 0;
    const height = Number(sourceMediaHeight) || 0;
    const isLandscapeSource = width > height;
    return isNonLandscapeTarget && isLandscapeSource;
  }

  function clampVideoPan(panX) {
    const val = Number.isFinite(Number(panX)) ? Number(panX) : 50;
    return Math.max(0, Math.min(100, val));
  }

  function getStoredSceneCropPosition(sceneCropPositions, sceneId, formatKey) {
    const format = calculateCropFormat(formatKey);
    if (format === '16x9') return 50;
    if (!sceneCropPositions || !sceneId) return 50;
    const stored = sceneCropPositions?.[sceneId]?.[format];
    return clampVideoPan(stored ?? 50);
  }

  function storeSceneCropPosition(sceneCropPositions, projectId, sceneId, formatKey, panX) {
    const format = calculateCropFormat(formatKey);
    const clampedPan = clampVideoPan(panX);
    if (!sceneId || format === '16x9') {
      return { updatedPositions: sceneCropPositions || {}, payload: null };
    }
    const currentStore = sceneCropPositions || {};
    const updatedPositions = {
      ...currentStore,
      [sceneId]: {
        ...(currentStore[sceneId] || {}),
        [format]: clampedPan
      }
    };
    const payload = projectId ? {
      project_id: projectId,
      scene_id: sceneId,
      format: format,
      pan_x: clampedPan
    } : null;

    return { updatedPositions: updatedPositions, payload: payload };
  }

  function getPlatformFormat(platform) {
    const p = String(platform || '').toLowerCase().trim();
    return activePlatformFormats[p] || PLATFORM_PREVIEW_FORMATS[p] || null;
  }

  return {
    RATIO_PROFILES: RATIO_PROFILES,
    PLATFORM_PREVIEW_FORMATS: PLATFORM_PREVIEW_FORMATS,
    configureCatalog: configureCatalog,
    getPlatformFormat: getPlatformFormat,
    getProfileByKey: getProfileByKey,
    getProfileByPlatform: getProfileByPlatform,
    calculateCropFormat: calculateCropFormat,
    calculatePanAvailability: calculatePanAvailability,
    clampVideoPan: clampVideoPan,
    getStoredSceneCropPosition: getStoredSceneCropPosition,
    storeSceneCropPosition: storeSceneCropPosition
  };
}));
