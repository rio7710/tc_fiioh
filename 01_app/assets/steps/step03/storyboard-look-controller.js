(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Step03StoryboardLookController = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const allowed = Object.freeze(['original', 'warm', 'cool', 'realistic']);
  const defaultLook = 'original';

  function create(dependencies) {
    const deps = dependencies || {};
    for (const name of ['getRoot', 'storage', 'getActiveProjectId', 'setCurrentLook']) {
      if (name === 'storage') {
        if (!deps.storage || typeof deps.storage.getItem !== 'function' || typeof deps.storage.setItem !== 'function') {
          throw new TypeError('Step03StoryboardLookController requires storage');
        }
      } else if (typeof deps[name] !== 'function') throw new TypeError(`Step03StoryboardLookController requires ${name}`);
    }

    function normalize(look) {
      return allowed.includes(look) ? look : defaultLook;
    }

    function updateDom(look) {
      const rootNode = deps.getRoot();
      if (!rootNode || typeof rootNode.querySelector !== 'function' || typeof rootNode.querySelectorAll !== 'function') {
        throw new TypeError('Step03StoryboardLookController requires a DOM root');
      }
      const grid = rootNode.querySelector('#storyboardGrid');
      if (!grid || !grid.dataset) throw new Error('Step03StoryboardLookController missing #storyboardGrid');
      const buttons = rootNode.querySelectorAll('.storyboard-look-btn');
      if (!buttons || typeof buttons.forEach !== 'function') throw new Error('Step03StoryboardLookController missing .storyboard-look-btn collection');
      grid.dataset.look = look;
      buttons.forEach(button => {
        if (!button || typeof button.setAttribute !== 'function' || !button.dataset) throw new Error('Step03StoryboardLookController invalid .storyboard-look-btn');
        button.setAttribute('aria-pressed', String(button.dataset.look === look));
      });
      deps.setCurrentLook(look);
      return look;
    }

    function apply(look) {
      const normalized = updateDom(normalize(look));
      const projectId = deps.getActiveProjectId();
      if (projectId !== null && projectId !== undefined && projectId !== '') {
        deps.storage.setItem(`thinkcast-storyboard-look-${projectId}`, normalized);
      }
      return normalized;
    }

    function restore() {
      const projectId = deps.getActiveProjectId();
      if (projectId === null || projectId === undefined || projectId === '') return updateDom(defaultLook);
      const saved = deps.storage.getItem(`thinkcast-storyboard-look-${projectId}`);
      return updateDom(normalize(saved));
    }

    return Object.freeze({apply, restore, normalize});
  }

  return Object.freeze({create, allowed, defaultLook});
}));
