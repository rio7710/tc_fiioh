(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.VideoEditorBrandSelection = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BRAND_ROLES = ['intro', 'outro', 'watermark'];

  function isOutroRatioCompanion(item) {
    return Boolean(item?.role === 'outro' && /^greenhill_outro_v4_(9x16|4x5|1x1)\.png$/.test(item?.uri || ''));
  }

  function ensureOutroRatioAssets(item) {
    if (!item || item.uri !== 'greenhill_outro_v4_16x9.png') {
      return item ? [item] : [];
    }
    const formats = ['16x9', '9x16', '4x5', '1x1'];
    return formats.map(fmt => ({
      ...item,
      format: fmt,
      uri: `greenhill_outro_v4_${fmt}.png`,
      companion: fmt !== '16x9'
    }));
  }

  function calculateActiveWatermarkProfile(watermarkProfiles, formatKey) {
    const profiles = watermarkProfiles || {};
    const fmt = formatKey || '16x9';
    return profiles[fmt] || profiles['16x9'] || {
      position: 'top-right',
      width_ratio: 0.15
    };
  }

  function calculateActiveOutroProfile(outroProfiles, formatKey) {
    const profiles = outroProfiles || {};
    const fmt = formatKey || '16x9';
    return profiles[fmt] || profiles['16x9'] || {
      position: 'center-center',
      width_ratio: 1.0,
      background: 'none',
      background_opacity: 0.8
    };
  }

  function calculateOutroBackgroundColor(profile) {
    if (!profile) return 'transparent';
    const bg = String(profile.background || 'none').toLowerCase().trim();
    if (bg === 'none') return 'transparent';
    const alpha = Math.max(0, Math.min(1, Number(profile.background_opacity ?? 0.8)));
    if (bg === 'black' || bg === 'dark') {
      return `rgba(0, 0, 0, ${alpha})`;
    }
    if (bg === 'white' || bg === 'light') {
      return `rgba(255, 255, 255, ${alpha})`;
    }
    return `rgba(0, 0, 0, ${alpha})`;
  }

  function createBrandSelectionSnapshot(brandAssets, userSelections, options = {}) {
    const assetsList = Array.isArray(brandAssets) ? brandAssets : [];
    const selectionsInput = Array.isArray(userSelections) ? userSelections : [];

    const roleMap = {};
    BRAND_ROLES.forEach(role => {
      const selection = selectionsInput.find(s => s.role === role) || {};
      const assetItem = assetsList.find(a => a.version_id === selection.version_id) || null;
      roleMap[role] = {
        role: role,
        enabled: selection.enabled !== false,
        version_id: selection.version_id || null,
        asset: assetItem,
        position: selection.position || (role === 'watermark' ? 'top-right' : 'center-center'),
        widthRatio: Math.max(0.06, Math.min(1, Number(selection.widthRatio || selection.width_ratio || (role === 'watermark' ? 0.15 : 1.0)))),
        background: selection.background || 'none',
        backgroundOpacity: Math.max(0, Math.min(1, Number(selection.backgroundOpacity ?? selection.background_opacity ?? 0.8)))
      };
    });

    const watermarkProfiles = options.watermarkProfiles || {};
    const outroProfiles = options.outroProfiles || {};

    return {
      schema_version: '1.0.0',
      timestamp: options.timestamp || new Date().toISOString(),
      roles: roleMap,
      watermarkProfiles: {
        '16x9': calculateActiveWatermarkProfile(watermarkProfiles, '16x9'),
        '9x16': calculateActiveWatermarkProfile(watermarkProfiles, '9x16'),
        '4x5': calculateActiveWatermarkProfile(watermarkProfiles, '4x5'),
        '1x1': calculateActiveWatermarkProfile(watermarkProfiles, '1x1')
      },
      outroProfiles: {
        '16x9': calculateActiveOutroProfile(outroProfiles, '16x9'),
        '9x16': calculateActiveOutroProfile(outroProfiles, '9x16'),
        '4x5': calculateActiveOutroProfile(outroProfiles, '4x5'),
        '1x1': calculateActiveOutroProfile(outroProfiles, '1x1')
      }
    };
  }

  function validateBrandSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      return { valid: false, reason: 'Snapshot must be a non-null object' };
    }
    if (snapshot.schema_version !== '1.0.0') {
      return { valid: false, reason: 'Unsupported schema_version' };
    }
    if (!snapshot.roles || typeof snapshot.roles !== 'object') {
      return { valid: false, reason: 'Missing roles object' };
    }
    for (const role of BRAND_ROLES) {
      if (!snapshot.roles[role]) {
        return { valid: false, reason: `Missing role entry for ${role}` };
      }
    }
    return { valid: true, reason: 'Valid brand selection snapshot' };
  }

  return {
    BRAND_ROLES: BRAND_ROLES,
    isOutroRatioCompanion: isOutroRatioCompanion,
    ensureOutroRatioAssets: ensureOutroRatioAssets,
    calculateActiveWatermarkProfile: calculateActiveWatermarkProfile,
    calculateActiveOutroProfile: calculateActiveOutroProfile,
    calculateOutroBackgroundColor: calculateOutroBackgroundColor,
    createBrandSelectionSnapshot: createBrandSelectionSnapshot,
    validateBrandSnapshot: validateBrandSnapshot
  };
}));
