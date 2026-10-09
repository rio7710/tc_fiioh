(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ThinkCastSessionBootstrapController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(dependencies) {
    const deps = dependencies || {};
    for (const name of [
      'request', 'setLoginAccess', 'refreshProjectIndex', 'hydrateCalendarEntries',
      'getActiveProjectId', 'openIndexProject', 'loadProjectState', 'loadProjectContent',
      'setContentIndexError'
    ]) if (typeof deps[name] !== 'function') throw new TypeError(`ThinkCastSessionBootstrapController requires ${name}`);
    if (!deps.navigation || !['begin', 'isStale', 'readRoute', 'selectRouteProject', 'showStep', 'prepareStep'].every(name => typeof deps.navigation[name] === 'function')) {
      throw new TypeError('ThinkCastSessionBootstrapController requires navigation');
    }

    async function restore() {
      deps.setLoginAccess(false);
      const bootToken = deps.navigation.begin();
      const route = deps.navigation.readRoute();
      let session;
      try {
        session = await deps.request('/api/session');
      } catch (error) {
        if (!deps.navigation.isStale(bootToken)) {
          deps.setLoginAccess(false);
          deps.navigation.showStep(1, 'replace');
        }
        return;
      }
      if (deps.navigation.isStale(bootToken)) return;
      deps.setLoginAccess(Boolean(session.authenticated), session);
      if (!session.authenticated) {
        deps.navigation.showStep(1, 'replace');
        return;
      }
      try {
        await deps.refreshProjectIndex();
        if (!deps.navigation.isStale(bootToken)) deps.setContentIndexError('index', '');
      } catch (error) {
        if (!deps.navigation.isStale(bootToken)) deps.setContentIndexError('index', `콘텐츠 목록을 불러오지 못했습니다: ${error.message}`);
      }
      try {
        await deps.hydrateCalendarEntries();
        if (!deps.navigation.isStale(bootToken)) deps.setContentIndexError('calendar', '');
      } catch (error) {
        if (!deps.navigation.isStale(bootToken)) deps.setContentIndexError('calendar', `배포 캘린더를 불러오지 못했습니다: ${error.message}`);
      }
      if (deps.navigation.isStale(bootToken)) return;
      const validRouteProject = deps.navigation.selectRouteProject(route);
      let requestedStep = validRouteProject ? route.step : 'index';
      if (requestedStep === 'project' && deps.getActiveProjectId()) {
        deps.openIndexProject(deps.getActiveProjectId(), 'replace');
        return;
      }
      let loadedContent = false;
      try {
        if (deps.getActiveProjectId()) {
          let restored;
          try {
            restored = await deps.loadProjectState(deps.getActiveProjectId(), bootToken);
          } catch (error) {
            if (!deps.navigation.isStale(bootToken)) throw error;
            return;
          }
          if (deps.navigation.isStale(bootToken)) return;
          const requestedContentStep = requestedStep === '3-1' || Number(requestedStep) >= 3;
          if (requestedContentStep && !restored.content) requestedStep = '2';
          else if (requestedContentStep) {
            try {
              await deps.loadProjectContent(deps.getActiveProjectId(), bootToken);
            } catch (error) {
              if (!deps.navigation.isStale(bootToken)) throw error;
              return;
            }
            if (deps.navigation.isStale(bootToken)) return;
          }
          loadedContent = true;
        } else if (requestedStep && requestedStep !== 'index') {
          requestedStep = 'index';
          deps.setContentIndexError('content', '이전에 보던 콘텐츠를 찾을 수 없어 목록으로 이동했습니다. 아래에서 다시 선택해 주세요.');
        }
        if (deps.navigation.isStale(bootToken)) return;
        deps.navigation.showStep(requestedStep || 'index', 'replace');
        deps.navigation.prepareStep(requestedStep || 'index');
        if (loadedContent) deps.setContentIndexError('content', '');
      } catch (error) {
        if (deps.navigation.isStale(bootToken)) return;
        deps.navigation.showStep('index', 'replace');
        deps.setContentIndexError('content', `콘텐츠를 불러오지 못했습니다: ${error.message}`);
      }
    }

    return Object.freeze({restore});
  }

  return Object.freeze({create});
});
