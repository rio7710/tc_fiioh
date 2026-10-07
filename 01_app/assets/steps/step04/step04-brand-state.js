(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Step04BrandState = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RATIOS = Object.freeze(['16x9', '9x16', '4x5', '1x1']);
  const POSITIONS = new Set(['top-left', 'top-center', 'top-right', 'center-left', 'center-center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right']);
  const BACKGROUNDS = new Set(['none', 'white', 'black']);
  const DEFAULTS = Object.freeze({
    watermarkPosition: 'top-right',
    watermarkWidthRatio: 0.15,
    watermarkProfiles: {},
    outroPosition: 'center-center',
    outroWidthRatio: 1,
    outroBackground: 'none',
    outroBackgroundOpacity: 0.8,
    outroProfiles: {}
  });

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
  }

  function clamp(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
  }

  function position(value, fallback) {
    return POSITIONS.has(value) ? value : fallback;
  }

  function background(value, fallback) {
    return BACKGROUNDS.has(value) ? value : fallback;
  }

  function assertRatio(ratio) {
    if (!RATIOS.includes(ratio)) throw new TypeError(`Unsupported Step 4 ratio: ${ratio}`);
  }

  function normalizeWatermarkProfile(profile, fallback) {
    const source = profile && typeof profile === 'object' ? profile : {};
    const normalized = {
      position: position(source.position, fallback.position),
      width_ratio: clamp(source.width_ratio, 0.06, 1, fallback.width_ratio)
    };
    if (source.version_id !== undefined) normalized.version_id = source.version_id;
    return normalized;
  }

  function normalizeOutroProfile(profile, fallback) {
    const source = profile && typeof profile === 'object' ? profile : {};
    const normalized = {
      position: position(source.position, fallback.position),
      width_ratio: clamp(source.width_ratio, 0.06, 1, fallback.width_ratio),
      background: background(source.background, fallback.background),
      background_opacity: clamp(source.background_opacity, 0, 1, fallback.background_opacity)
    };
    if (source.version_id !== undefined) normalized.version_id = source.version_id;
    return normalized;
  }

  function selectionSettings(source, role) {
    const selections = Array.isArray(source) ? source : Array.isArray(source?.selections) ? source.selections : null;
    if (selections) return selections.find(item => item?.role === role)?.settings || {};
    const candidate = source?.[role];
    return candidate?.settings || candidate || {};
  }

  function create(initial) {
    let state;

    function hydrate(source) {
      const direct = source && Object.prototype.hasOwnProperty.call(source, 'watermarkPosition');
      const watermark = direct ? {
        position: source.watermarkPosition,
        width_ratio: source.watermarkWidthRatio,
        profiles: source.watermarkProfiles
      } : selectionSettings(source, 'watermark');
      const outro = direct ? {
        position: source.outroPosition,
        width_ratio: source.outroWidthRatio,
        background: source.outroBackground,
        background_opacity: source.outroBackgroundOpacity,
        profiles: source.outroProfiles
      } : selectionSettings(source, 'outro');
      const watermarkFallback = {
        position: position(watermark.position, DEFAULTS.watermarkPosition),
        width_ratio: clamp(watermark.width_ratio, 0.06, 1, DEFAULTS.watermarkWidthRatio)
      };
      const outroFallback = {
        position: position(outro.position, DEFAULTS.outroPosition),
        width_ratio: clamp(outro.width_ratio, 0.06, 1, DEFAULTS.outroWidthRatio),
        background: background(outro.background, DEFAULTS.outroBackground),
        background_opacity: clamp(outro.background_opacity, 0, 1, DEFAULTS.outroBackgroundOpacity)
      };
      const watermarkProfiles = {};
      const outroProfiles = {};
      RATIOS.forEach(ratio => {
        watermarkProfiles[ratio] = normalizeWatermarkProfile(watermark.profiles?.[ratio], watermarkFallback);
        if (outro.profiles?.[ratio]) outroProfiles[ratio] = normalizeOutroProfile(outro.profiles[ratio], outroFallback);
      });
      state = {
        watermarkPosition: watermarkFallback.position,
        watermarkWidthRatio: watermarkFallback.width_ratio,
        watermarkProfiles,
        outroPosition: outroFallback.position,
        outroWidthRatio: outroFallback.width_ratio,
        outroBackground: outroFallback.background,
        outroBackgroundOpacity: outroFallback.background_opacity,
        outroProfiles
      };
      return snapshot();
    }

    function snapshot() {
      return clone(state);
    }

    function activeWatermarkProfile(ratio) {
      assertRatio(ratio);
      return clone(state.watermarkProfiles[ratio] || {
        position: state.watermarkPosition,
        width_ratio: state.watermarkWidthRatio
      });
    }

    function updateWatermarkProfile(ratio, patch) {
      assertRatio(ratio);
      const next = normalizeWatermarkProfile(Object.assign({}, activeWatermarkProfile(ratio), patch || {}), {
        position: state.watermarkPosition,
        width_ratio: state.watermarkWidthRatio
      });
      state.watermarkPosition = next.position;
      state.watermarkWidthRatio = next.width_ratio;
      state.watermarkProfiles[ratio] = next;
      return clone(next);
    }

    function activeOutroProfile(ratio) {
      assertRatio(ratio);
      return clone(state.outroProfiles[ratio] || {
        position: state.outroPosition,
        width_ratio: state.outroWidthRatio,
        background: state.outroBackground,
        background_opacity: state.outroBackgroundOpacity
      });
    }

    function updateOutroProfile(ratio, patch) {
      assertRatio(ratio);
      const next = normalizeOutroProfile(Object.assign({}, activeOutroProfile(ratio), patch || {}), {
        position: state.outroPosition,
        width_ratio: state.outroWidthRatio,
        background: state.outroBackground,
        background_opacity: state.outroBackgroundOpacity
      });
      state.outroPosition = next.position;
      state.outroWidthRatio = next.width_ratio;
      state.outroBackground = next.background;
      state.outroBackgroundOpacity = next.background_opacity;
      state.outroProfiles[ratio] = next;
      return clone(next);
    }

    function serializeSettings(role) {
      if (role === 'watermark') return {
        position: state.watermarkPosition,
        width_ratio: state.watermarkWidthRatio,
        profiles: clone(state.watermarkProfiles)
      };
      if (role === 'outro') return {
        position: state.outroPosition,
        width_ratio: state.outroWidthRatio,
        background: state.outroBackground,
        background_opacity: state.outroBackgroundOpacity,
        profiles: clone(state.outroProfiles)
      };
      throw new TypeError(`Unsupported Step 4 brand role: ${role}`);
    }

    hydrate(initial || {});
    return Object.freeze({snapshot, hydrate, activeWatermarkProfile, updateWatermarkProfile, activeOutroProfile, updateOutroProfile, serializeSettings});
  }

  return Object.freeze({create, RATIOS});
});
