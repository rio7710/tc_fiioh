(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Step01ProjectIndexController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STEPS = Object.freeze([
    Object.freeze({key: '1', label: '프로젝트 생성'}), Object.freeze({key: '2', label: '키워드·AI 논의'}),
    Object.freeze({key: '3', label: '대본·타임라인'}), Object.freeze({key: '3-1', label: '콘티'}),
    Object.freeze({key: '4', label: '영상 디자인'}), Object.freeze({key: '5', label: '배포 캘린더'})
  ]);

  function create(dependencies) {
    const deps = dependencies || {};
    for (const name of ['getRememberedProjectId','getActiveProjectId','setActiveProjectId','request','refreshBrandLibrary','setInterval','clearInterval','onPollError']) if (typeof deps[name] !== 'function') throw new TypeError(`Step01ProjectIndexController requires ${name}`);
    if (!deps.view || typeof deps.view.render !== 'function' || typeof deps.view.isVisible !== 'function') throw new TypeError('Step01ProjectIndexController requires view');
    if (!deps.projectsIndex || typeof deps.projectsIndex !== 'object' || Array.isArray(deps.projectsIndex)) {
      throw new TypeError('Step01ProjectIndexController requires projectsIndex');
    }
    const intervalMs = Number.isFinite(Number(deps.intervalMs)) ? Number(deps.intervalMs) : 5000;
    let timerId = null;
    let pollBusy = false;

    function render(projects) {
      const list = Array.isArray(projects) ? projects : [];
      Object.keys(deps.projectsIndex).forEach(key => delete deps.projectsIndex[key]);
      list.forEach(project => {
        deps.projectsIndex[project.project_id] = {
          ...project, title: project.name, summary: `콘텐츠 ID · ${project.project_id}`,
          currentStep: String(project.current_stage || 2), note: '이 프로젝트에 저장된 단계부터 계속 제작할 수 있습니다.',
          steps: STEPS.map(item => ({...item}))
        };
      });
      deps.view.render(list);
      if (!list.length) return;
      const remembered = deps.getRememberedProjectId();
      if (remembered && deps.projectsIndex[remembered]) deps.setActiveProjectId(remembered);
      else if (!remembered && list.length === 1) deps.setActiveProjectId(list[0].project_id);
      else if (remembered && !deps.projectsIndex[remembered]) deps.setActiveProjectId(null);
      else if (deps.getActiveProjectId() && !deps.projectsIndex[deps.getActiveProjectId()]) deps.setActiveProjectId(null);
    }

    async function refresh() {
      const [result] = await Promise.all([deps.request('/api/projects'), deps.refreshBrandLibrary()]);
      render(result.projects || []);
    }

    async function pollOnce() {
      let visible;
      try { visible = deps.view.isVisible(); }
      catch (error) { deps.onPollError(error); return; }
      if (!visible || pollBusy) return;
      pollBusy = true;
      try {
        const result = await deps.request('/api/projects');
        render(result.projects || []);
      } catch (error) {
        deps.onPollError(error);
      } finally {
        pollBusy = false;
      }
    }

    function startPolling() {
      if (timerId !== null) return false;
      timerId = deps.setInterval(() => pollOnce(), intervalMs);
      return true;
    }
    function stopPolling() {
      if (timerId === null) return false;
      deps.clearInterval(timerId);
      timerId = null;
      return true;
    }
    const isPolling = () => timerId !== null;

    return Object.freeze({render, refresh, pollOnce, startPolling, stopPolling, isPolling});
  }

  return Object.freeze({create, STEPS});
});
