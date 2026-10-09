(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ThinkCastShellNavigationController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(dependencies) {
    const deps = dependencies || {};
    for (const name of [
      'getLocation', 'getHistory', 'getWindow', 'isLoggedIn', 'getActiveProjectId',
      'setActiveProjectId', 'getProjects', 'refreshProjectIndex', 'loadProjectState',
      'loadProjectContent', 'openIndexProject', 'updateContentUuidLabels', 'getPreviewVideo',
      'scrollTo', 'renderStoryboardGrid', 'connectStoryboardAssetsToEditor', 'setContentIndexError', 'onError'
    ]) if (typeof deps[name] !== 'function') throw new TypeError(`ThinkCastShellNavigationController requires ${name}`);
    if (!deps.contentRoute || !['readContentRoute', 'writeContentRoute', 'listenContentRoutes'].every(name => typeof deps.contentRoute[name] === 'function')) {
      throw new TypeError('ThinkCastShellNavigationController requires contentRoute');
    }

    let rootNode = null;
    let routeSubscription = null;
    let listeners = [];
    let navToken = 0;
    let restoredRouteUrl = '';

    function requireRoot() {
      if (!rootNode || typeof rootNode.querySelector !== 'function') throw new Error('ThinkCastShellNavigationController is not mounted');
      return rootNode;
    }
    const readRoute = () => deps.contentRoute.readContentRoute(deps.getLocation());
    const writeRoute = (step, mode = 'push') => deps.contentRoute.writeContentRoute({
      location: deps.getLocation(), history: deps.getHistory(), mode, step, projectId: deps.getActiveProjectId()
    });
    const begin = () => ++navToken;
    const isStale = token => token !== navToken;

    function selectRouteProject(route) {
      if (!route.explicitProject) return true;
      const project = deps.getProjects()[route.projectId];
      deps.setActiveProjectId(project ? route.projectId : null);
      if (!project) deps.setContentIndexError('content', '요청한 콘텐츠를 찾을 수 없습니다. 목록에서 다시 선택해 주세요.');
      return Boolean(project);
    }

    function showStep(step, historyMode = 'push') {
      step = String(step);
      if (!deps.isLoggedIn() && step !== '1') step = '1';
      deps.updateContentUuidLabels();
      const video = deps.getPreviewVideo();
      if (video && typeof video.pause === 'function') {
        try { video.pause(); } catch (error) { deps.onError('video-pause', error); }
      }
      const viewId = step === 'index' ? 'stepIndex' : step === 'project' ? 'stepProject' : step === '3-1' ? 'step31' : `step${step}`;
      const root = requireRoot();
      root.querySelectorAll('.step-view').forEach(view => { view.hidden = view.id !== viewId; });
      root.querySelector('thinkcast-top-nav')?.setActive(step === 'project' ? 'index' : step === '3-1' ? '3' : step);
      deps.scrollTo({top: 0, behavior: 'smooth'});
      writeRoute(step, historyMode);
      restoredRouteUrl = deps.getLocation().href;
    }

    function prepareStep(target) {
      const step = String(target);
      if (step === '3-1') deps.renderStoryboardGrid();
      if (step === '4') deps.connectStoryboardAssetsToEditor();
    }

    async function navigate(requestedTarget, {historyMode = 'push'} = {}) {
      const token = begin();
      let target = String(requestedTarget);
      if (target === 'project') {
        if (!deps.getActiveProjectId()) { showStep('index', historyMode); return 'index'; }
        if (!deps.getProjects()[deps.getActiveProjectId()]) {
          try { await deps.refreshProjectIndex(); }
          catch (error) { if (!isStale(token)) throw error; return; }
        }
        if (isStale(token)) return;
        deps.openIndexProject(deps.getActiveProjectId(), historyMode);
        return 'project';
      }
      const numericTarget = target === '3-1' ? 3 : Number(target);
      let loadedContent = false;
      if (deps.isLoggedIn() && Number.isFinite(numericTarget) && numericTarget >= 2) {
        if (!deps.getActiveProjectId()) { showStep('index', historyMode); return 'index'; }
        let restored;
        try { restored = await deps.loadProjectState(deps.getActiveProjectId(), token); }
        catch (error) { if (!isStale(token)) throw error; return; }
        if (isStale(token)) return;
        if (numericTarget >= 3 && !restored.content) {
          target = '2';
          requireRoot().querySelector('#keywordMessage').textContent = '저장된 키워드를 확인한 뒤 대본 구성을 시작해 주세요.';
        } else if (numericTarget >= 3) {
          try { await deps.loadProjectContent(deps.getActiveProjectId(), token); }
          catch (error) { if (!isStale(token)) throw error; return; }
          if (isStale(token)) return;
        }
        loadedContent = true;
      }
      showStep(target, historyMode);
      try { prepareStep(target); }
      catch (error) {
        if (target === '3-1') requireRoot().querySelector('#storyboardMessage').textContent = `콘티를 불러오지 못했습니다: ${error.message}`;
        throw error;
      }
      if (loadedContent) deps.setContentIndexError('content', '');
      return target;
    }

    async function restoreRoute() {
      const location = deps.getLocation();
      if (restoredRouteUrl === location.href) return;
      restoredRouteUrl = location.href;
      if (!deps.isLoggedIn()) return;
      const route = readRoute();
      const valid = selectRouteProject(route);
      try { await navigate(valid ? route.step : 'index', {historyMode: 'replace'}); }
      catch (error) {
        deps.setContentIndexError('content', '콘텐츠를 불러오지 못했습니다. 목록에서 다시 시도해 주세요.');
        showStep('index', 'replace');
      }
    }

    function unmount() {
      listeners.forEach(({node, type, listener}) => node.removeEventListener(type, listener));
      listeners = [];
      if (routeSubscription) routeSubscription.dispose();
      routeSubscription = null;
      rootNode = null;
    }

    function mount(root) {
      if (rootNode) return true;
      if (!root || typeof root.querySelector !== 'function' || typeof root.addEventListener !== 'function') throw new TypeError('ThinkCastShellNavigationController mount requires root');
      rootNode = root;
      try {
        const topNav = root.querySelector('thinkcast-top-nav');
        if (!topNav) throw new Error('ThinkCastShellNavigationController missing thinkcast-top-nav');
        const onDataGo = async event => {
          const button = event.target.closest('[data-go]');
          if (!button) return;
          try { await navigate(button.dataset.go); }
          catch (error) {
            const note = root.querySelector('#projectDetailNote') || root.querySelector('#contentIndexMessage');
            if (note) note.textContent = error.message;
          }
        };
        const onTopNav = async event => {
          try { await navigate(event.detail.step); }
          catch (error) {
            root.querySelector('#projectDetailNote').textContent = error.message;
            showStep('index');
          }
        };
        root.addEventListener('click', onDataGo);
        listeners.push({node: root, type: 'click', listener: onDataGo});
        topNav.addEventListener('thinkcast-step-change', onTopNav);
        listeners.push({node: topNav, type: 'thinkcast-step-change', listener: onTopNav});
        routeSubscription = deps.contentRoute.listenContentRoutes(() => restoreRoute(), {window: deps.getWindow(), location: deps.getLocation()});
        return true;
      } catch (error) {
        unmount();
        throw error;
      }
    }

    return Object.freeze({readRoute, writeRoute, begin, isStale, selectRouteProject, showStep, prepareStep, navigate, restoreRoute, mount, unmount});
  }

  return Object.freeze({create});
});
