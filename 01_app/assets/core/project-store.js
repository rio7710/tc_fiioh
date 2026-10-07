(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ThinkCastProjectStore = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PROJECT_DEFAULTS = Object.freeze({
    scenes: Object.freeze([]),
    sceneCropPositions: Object.freeze({}),
    storyboardImages: Object.freeze({}),
    storyboardImageCandidates: Object.freeze({}),
    storyboardVoiceClips: Object.freeze({}),
    storyboardVideos: Object.freeze({}),
    storyboardVideoCandidates: Object.freeze({}),
    selectedKeywords: Object.freeze([])
  });

  const USER_DEFAULTS = Object.freeze({
    renderSettings: Object.freeze({}),
    brandSettings: Object.freeze({})
  });

  function isPlainObject(value) {
    if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function cloneJson(value, path) {
    if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.map((item, index) => cloneJson(item, `${path}[${index}]`));
    if (isPlainObject(value)) {
      const copy = {};
      Object.keys(value).sort().forEach(key => { copy[key] = cloneJson(value[key], `${path}.${key}`); });
      return copy;
    }
    throw new TypeError(`${path} must contain JSON-safe values`);
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(key => deepFreeze(value[key]));
    return Object.freeze(value);
  }

  function normalizeProjectId(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') throw new TypeError('activeProjectId must be a string or null');
    return value;
  }

  function mergeSection(current, change, label) {
    const patch = typeof change === 'function' ? change(deepFreeze(cloneJson(current, label))) : change;
    if (!isPlainObject(patch)) throw new TypeError(`${label} update must be a plain object or updater`);
    return { ...current, ...cloneJson(patch, label) };
  }

  function createProjectStore(initialState) {
    const initial = isPlainObject(initialState) ? initialState : {};
    let state = {
      activeProjectId: normalizeProjectId(initial.activeProjectId),
      project: mergeSection(cloneJson(PROJECT_DEFAULTS, 'project'), initial.project || {}, 'project'),
      user: mergeSection(cloneJson(USER_DEFAULTS, 'user'), initial.user || {}, 'user')
    };
    let version = 0;
    let snapshot = null;
    const subscribers = new Set();

    function makeSnapshot() {
      if (!snapshot) snapshot = deepFreeze({
        version,
        activeProjectId: state.activeProjectId,
        project: cloneJson(state.project, 'project'),
        user: cloneJson(state.user, 'user')
      });
      return snapshot;
    }

    function commit(nextState) {
      const before = JSON.stringify(state);
      const after = JSON.stringify(nextState);
      if (before === after) return makeSnapshot();
      state = nextState;
      version += 1;
      snapshot = null;
      const current = makeSnapshot();
      [...subscribers].forEach(listener => listener(current));
      return current;
    }

    function getSnapshot() {
      return makeSnapshot();
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('subscriber must be a function');
      subscribers.add(listener);
      return function unsubscribe() { subscribers.delete(listener); };
    }

    function setActiveProject(projectId) {
      const normalized = normalizeProjectId(projectId);
      if (normalized === state.activeProjectId) return makeSnapshot();
      return commit({
        ...state,
        activeProjectId: normalized,
        project: cloneJson(PROJECT_DEFAULTS, 'project')
      });
    }

    function updateProject(change) {
      return commit({ ...state, project: mergeSection(state.project, change, 'project') });
    }

    function resetProjectState() {
      return commit({ ...state, project: cloneJson(PROJECT_DEFAULTS, 'project') });
    }

    function updateUser(change) {
      return commit({ ...state, user: mergeSection(state.user, change, 'user') });
    }

    function updateRenderSettings(change) {
      return updateUser({ renderSettings: mergeSection(state.user.renderSettings, change, 'renderSettings') });
    }

    function updateBrandSettings(change) {
      return updateUser({ brandSettings: mergeSection(state.user.brandSettings, change, 'brandSettings') });
    }

    return Object.freeze({
      getSnapshot,
      subscribe,
      setActiveProject,
      updateProject,
      resetProjectState,
      updateUser,
      updateRenderSettings,
      updateBrandSettings
    });
  }

  return Object.freeze({ createProjectStore, PROJECT_DEFAULTS, USER_DEFAULTS });
}));
