(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Step03StoryboardFlowController = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const required = ['getRoot', 'renderStoryboardGrid', 'showStep', 'updateScriptDiff', 'saveScriptChanges', 'connectStoryboardAssetsToEditor', 'applyStoryboardLook'];

  function create(dependencies) {
    const deps = dependencies || {};
    required.forEach(name => {
      if (typeof deps[name] !== 'function') throw new TypeError(`Step03StoryboardFlowController requires ${name}`);
    });
    let mountedRoot = null;
    let nodes = null;
    let listeners = null;
    let storyboardTask = null;

    function requireNodes(rootNode) {
      if (!rootNode || typeof rootNode.querySelector !== 'function') throw new TypeError('Step03StoryboardFlowController requires a DOM root');
      const found = {};
      for (const [name, selector] of Object.entries({scriptNext: '#scriptNext', scriptMessage: '#scriptMessage', storyboardNext: '#storyboardNext', storyboardMessage: '#storyboardMessage', lookToolbar: '#storyboardLookToolbar'})) {
        found[name] = rootNode.querySelector(selector);
        if (!found[name] || typeof found[name].addEventListener !== 'function' || typeof found[name].removeEventListener !== 'function') {
          throw new Error(`Step03StoryboardFlowController missing ${selector}`);
        }
      }
      return found;
    }

    function advanceScript() {
      const current = nodes || requireNodes(deps.getRoot());
      current.scriptMessage.textContent = '';
      try {
        deps.renderStoryboardGrid();
        deps.showStep('3-1');
      } catch (error) {
        current.scriptMessage.textContent = error.message;
      }
    }

    function advanceStoryboard() {
      if (storyboardTask) return storyboardTask;
      const current = nodes || requireNodes(deps.getRoot());
      current.storyboardMessage.textContent = '';
      current.storyboardNext.disabled = true;
      const task = Promise.resolve().then(async () => {
        try {
          if (deps.updateScriptDiff() > 0) await deps.saveScriptChanges();
          deps.connectStoryboardAssetsToEditor();
          deps.showStep(4);
        } catch (error) {
          current.storyboardMessage.textContent = error.message;
        } finally {
          current.storyboardNext.disabled = false;
          if (storyboardTask === task) storyboardTask = null;
        }
      });
      storyboardTask = task;
      return task;
    }

    function applyLookEvent(event) {
      const target = event && event.target;
      if (!target || typeof target.closest !== 'function') return;
      const button = target.closest('[data-look]');
      if (!button || !button.dataset || !button.dataset.look) return;
      deps.applyStoryboardLook(button.dataset.look);
    }

    function mount(rootNode = deps.getRoot()) {
      if (mountedRoot === rootNode) return true;
      const nextNodes = requireNodes(rootNode);
      if (mountedRoot) unmount();
      const nextListeners = {
        script: () => advanceScript(),
        storyboard: () => advanceStoryboard(),
        look: event => applyLookEvent(event)
      };
      nextNodes.scriptNext.addEventListener('click', nextListeners.script);
      nextNodes.storyboardNext.addEventListener('click', nextListeners.storyboard);
      nextNodes.lookToolbar.addEventListener('click', nextListeners.look);
      mountedRoot = rootNode;
      nodes = nextNodes;
      listeners = nextListeners;
      return true;
    }

    function unmount() {
      if (!mountedRoot) return;
      nodes.scriptNext.removeEventListener('click', listeners.script);
      nodes.storyboardNext.removeEventListener('click', listeners.storyboard);
      nodes.lookToolbar.removeEventListener('click', listeners.look);
      mountedRoot = null;
      nodes = null;
      listeners = null;
    }

    return Object.freeze({mount, unmount, advanceScript, advanceStoryboard, applyLookEvent});
  }

  return Object.freeze({create});
}));
