(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Step04NavigationController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(dependencies) {
    const deps = dependencies || {};
    for (const name of ['SceneNav', 'MobileSync', 'getScenes', 'getCurrentScene', 'getCurrentTime', 'setCurrentTime', 'syncPreview', 'formatTime']) {
      if ((name === 'SceneNav' || name === 'MobileSync') ? !deps[name] : typeof deps[name] !== 'function') {
        throw new TypeError(`Step04NavigationController requires ${name}`);
      }
    }

    let rootNode = null;
    let mounted = false;
    let removers = [];
    const one = selector => rootNode?.querySelector(selector) || null;
    const all = selector => Array.from(rootNode?.querySelectorAll(selector) || []);
    const scenes = () => deps.getScenes();
    const duration = () => deps.SceneNav.calculateTimelineDuration(scenes());

    function listen(node, type, handler) {
      if (!node || typeof node.addEventListener !== 'function') return;
      node.addEventListener(type, handler);
      removers.push(() => node.removeEventListener(type, handler));
    }

    function currentState() {
      return deps.SceneNav.createInitialNavigationState(scenes(), {
        initialTime: deps.getCurrentTime() || 0,
        outroEnabled: true
      });
    }

    function navigate(action) {
      if (!scenes().length) return null;
      const nextState = deps.SceneNav.navigateScene(scenes(), currentState(), action, {outroEnabled: true});
      deps.setCurrentTime(nextState.currentTime);
      deps.syncPreview();
      return nextState;
    }

    function seekScene(index) {
      const items = scenes();
      if (!items.length) return null;
      const safe = Math.max(0, Math.min(items.length - 1, Number(index)));
      const scene = items[safe];
      const targetTime = deps.SceneNav.calculateSceneSeekTime(scene);
      deps.setCurrentTime(targetTime);
      deps.syncPreview();
      return targetTime;
    }

    function seekOutro() {
      if (!scenes().length) return null;
      const targetTime = deps.SceneNav.calculateOutroSeekTime(duration());
      deps.setCurrentTime(targetTime);
      deps.syncPreview();
      return targetTime;
    }

    function render() {
      if (!rootNode) return {rendered: false, reason: 'not-mounted'};
      const items = scenes();
      const sceneList = one('#sceneList');
      if (sceneList) {
        sceneList.innerHTML = items.map((scene, index) => `
          <button class="scene-btn ${index === deps.getCurrentScene() ? 'active' : ''}" type="button" data-index="${index}">
            <span class="scene-no">${String(index + 1).padStart(2, '0')}</span>
            <span class="scene-name">${scene.name || `장면 ${index + 1}`}</span>
            <span class="scene-time">${deps.formatTime(scene.start)}~${deps.formatTime(scene.end)}</span>
          </button>
        `).join('') + `
          <button class="scene-btn scene-outro-btn" type="button" data-outro="true">
            <span class="scene-no">OUT</span>
            <span class="scene-name">엔딩 카피 &amp; 브랜딩</span>
            <span class="scene-time">END · ${deps.formatTime(duration())}</span>
          </button>
        `;
      }
      const mobileSelect = one('#mobileSceneSelect');
      if (mobileSelect) {
        const mobileState = deps.MobileSync.computeMobileSyncState(items, deps.getCurrentScene(), false, 0, duration());
        mobileSelect.innerHTML = mobileState.options.map(option => `<option value="${option.value}">${option.label}</option>`).join('');
      }
      return {rendered: Boolean(sceneList || mobileSelect), sceneCount: items.length};
    }

    function sync(view) {
      if (!rootNode) return null;
      const items = scenes();
      const state = deps.MobileSync.computeMobileSyncState(items, view.currentScene, view.showOutro, view.time, view.duration);
      const mobileSelect = one('#mobileSceneSelect');
      if (mobileSelect) mobileSelect.value = state.selectedValue;
      for (const selector of ['#mobilePrevScene', '#prevBtn']) {
        const button = one(selector);
        if (button) button.disabled = state.prevDisabled;
      }
      for (const selector of ['#mobileNextScene', '#nextBtn']) {
        const button = one(selector);
        if (button) button.disabled = state.nextDisabled;
      }
      all('.scene-btn').forEach((element, index) => {
        const selected = element.dataset.outro === 'true' ? view.showOutro : (!view.showOutro && index === view.currentScene);
        element.classList.toggle('active', selected);
        element.setAttribute('aria-current', selected ? 'true' : 'false');
      });
      one('.scene-btn.active')?.scrollIntoView({block: 'nearest'});
      return state;
    }

    function mount(nextRoot) {
      if (mounted) return {mounted: false, reason: 'already-mounted'};
      if (!nextRoot || typeof nextRoot.querySelector !== 'function') throw new TypeError('Navigation mount root must support querySelector');
      rootNode = nextRoot;
      listen(one('#prevBtn'), 'click', () => navigate('PREV_SCENE'));
      listen(one('#nextBtn'), 'click', () => navigate('NEXT_SCENE'));
      listen(one('#mobilePrevScene'), 'click', () => navigate('PREV_SCENE'));
      listen(one('#mobileNextScene'), 'click', () => navigate('NEXT_SCENE'));
      listen(one('#mobileSceneSelect'), 'change', event => navigate(deps.MobileSync.resolveMobileSelectChange(event.currentTarget.value, scenes(), true)));
      listen(one('#sceneList'), 'click', event => {
        const button = event.target.closest('.scene-btn');
        if (!button) return;
        if (button.dataset.outro === 'true') seekOutro();
        else seekScene(Number(button.dataset.index));
      });
      mounted = true;
      render();
      return {mounted: true};
    }

    function unmount() {
      removers.splice(0).forEach(remove => remove());
      const wasMounted = mounted;
      mounted = false;
      rootNode = null;
      return {unmounted: wasMounted};
    }

    return Object.freeze({mount, unmount, render, sync, currentState, navigate, seekScene, seekOutro});
  }

  return Object.freeze({create});
});
