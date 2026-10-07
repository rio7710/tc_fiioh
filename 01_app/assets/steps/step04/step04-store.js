(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Step04Store = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = Object.freeze({
    currentScene: -1,
    currentType: 'editorial',
    selectedMusic: 'satie',
    currentPreviewPlatform: 'youtube',
    selectedPlatforms: new Set(['youtube', 'instagram', 'naver']),
    sceneCropPositions: {},
    videoPanX: 50,
    captionSizeLevel: 0,
    narrationEnabled: true,
    activeNarration: -1,
    sceneDissolveSeconds: 0.5,
    currentVolume: 0.5
  });
  const KEYS = new Set(Object.keys(DEFAULTS));

  function clone(value) {
    if (value instanceof Set) return new Set(Array.from(value, clone));
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    }
    return value;
  }

  function normalize(values) {
    const source = values && typeof values === 'object' ? values : {};
    const next = clone(DEFAULTS);
    Object.keys(source).forEach(key => {
      if (!KEYS.has(key)) throw new TypeError(`Unknown Step04Store key: ${key}`);
      next[key] = clone(source[key]);
    });
    return next;
  }

  function create(initial) {
    let state = normalize(initial);
    const listeners = new Set();

    function snapshot() {
      return clone(state);
    }

    function notify(changedKeys) {
      const current = snapshot();
      listeners.forEach(listener => listener(current, changedKeys.slice()));
    }

    return Object.freeze({
      get(key) {
        if (!KEYS.has(key)) throw new TypeError(`Unknown Step04Store key: ${key}`);
        return clone(state[key]);
      },
      set(key, value) {
        if (!KEYS.has(key)) throw new TypeError(`Unknown Step04Store key: ${key}`);
        state[key] = clone(value);
        notify([key]);
        return clone(state[key]);
      },
      patch(values) {
        if (!values || typeof values !== 'object') return snapshot();
        const changedKeys = Object.keys(values);
        changedKeys.forEach(key => {
          if (!KEYS.has(key)) throw new TypeError(`Unknown Step04Store key: ${key}`);
        });
        changedKeys.forEach(key => { state[key] = clone(values[key]); });
        if (changedKeys.length) notify(changedKeys);
        return snapshot();
      },
      snapshot,
      subscribe(listener) {
        if (typeof listener !== 'function') throw new TypeError('Step04Store listener must be a function');
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      reset(values) {
        state = normalize(values);
        notify(Object.keys(DEFAULTS));
        return snapshot();
      }
    });
  }

  return Object.freeze({ create });
});
