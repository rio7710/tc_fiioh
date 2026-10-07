(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ThinkCastContentRoute = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ROUTE_HASH = /^(?:#)?step(3-1|[1-5])$/;

  function normalizeStep(value) {
    const step = String(value || '').replace(/^#/, '');
    if (step === 'index' || step === 'project') return step;
    const match = step.match(/^step(3-1|[1-5])$/) || step.match(/^(3-1|[1-5])$/);
    return match ? match[1] : 'index';
  }

  function hashForStep(step) {
    const normalized = normalizeStep(step);
    return normalized === 'index' || normalized === 'project' ? `#${normalized}` : `#step${normalized}`;
  }

  function readContentRoute(locationOrUrl) {
    const href = typeof locationOrUrl === 'string' ? locationOrUrl : locationOrUrl.href;
    const url = new URL(href);
    const hash = url.hash;
    const match = hash.match(ROUTE_HASH);
    const step = hash === '#index' ? 'index' : hash === '#project' ? 'project' : match ? match[1] : 'index';
    return {
      step,
      projectId: url.searchParams.get('project_id'),
      explicitProject: url.searchParams.has('project_id')
    };
  }

  function buildContentRoute(locationOrUrl, step, projectId) {
    const href = typeof locationOrUrl === 'string' ? locationOrUrl : locationOrUrl.href;
    const url = new URL(href);
    url.hash = hashForStep(step);
    if (projectId) url.searchParams.set('project_id', projectId);
    else url.searchParams.delete('project_id');
    return url;
  }

  function writeContentRoute(options) {
    const settings = options || {};
    const locationObject = settings.location || globalThis.location;
    const historyObject = settings.history || globalThis.history;
    const mode = settings.mode === 'replace' ? 'replace' : 'push';
    const next = buildContentRoute(locationObject, settings.step, settings.projectId);
    if (next.href !== locationObject.href) {
      historyObject[mode === 'replace' ? 'replaceState' : 'pushState'](null, '', next.href);
      return true;
    }
    return false;
  }

  function listenContentRoutes(callback, options) {
    const settings = options || {};
    const windowObject = settings.window || globalThis.window;
    const locationObject = settings.location || globalThis.location;
    let lastHref = settings.initialHref || '';
    const restore = function () {
      if (lastHref === locationObject.href) return;
      lastHref = locationObject.href;
      return callback(readContentRoute(locationObject));
    };
    windowObject.addEventListener('popstate', restore);
    windowObject.addEventListener('hashchange', restore);
    return {
      restore,
      dispose() {
        windowObject.removeEventListener('popstate', restore);
        windowObject.removeEventListener('hashchange', restore);
      },
      reset(href) { lastHref = href || ''; }
    };
  }

  return {buildContentRoute, hashForStep, listenContentRoutes, normalizeStep, readContentRoute, writeContentRoute};
});
