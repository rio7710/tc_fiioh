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
    for (const name of [
      'getRoot', 'getCalendarEntries', 'calendarContentVersions', 'getRememberedProjectId',
      'getActiveProjectId', 'setActiveProjectId', 'request', 'refreshBrandLibrary', 'escapeHtml',
      'projectDate', 'automationStageLabel', 'setInterval', 'clearInterval', 'onPollError'
    ]) if (typeof deps[name] !== 'function') throw new TypeError(`Step01ProjectIndexController requires ${name}`);
    if (!deps.projectsIndex || typeof deps.projectsIndex !== 'object' || Array.isArray(deps.projectsIndex)) {
      throw new TypeError('Step01ProjectIndexController requires projectsIndex');
    }
    const intervalMs = Number.isFinite(Number(deps.intervalMs)) ? Number(deps.intervalMs) : 5000;
    let timerId = null;
    let pollBusy = false;

    function requireRoot() {
      const rootNode = deps.getRoot();
      if (!rootNode || typeof rootNode.querySelector !== 'function') throw new Error('Step01ProjectIndexController requires DOM root');
      return rootNode;
    }
    function requireNode(selector) {
      const node = requireRoot().querySelector(selector);
      if (!node) throw new Error(`Step01ProjectIndexController missing ${selector}`);
      return node;
    }
    function hasFinalVideo(project, entries) {
      return entries.some(entry => {
        const props = entry.extendedProps || {};
        return Boolean(props.contentUrl || deps.calendarContentVersions(entry).length) &&
          (props.projectId === project.project_id || (!props.projectId && entry.title === project.name));
      });
    }

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
      const entries = deps.getCalendarEntries();
      const completed = list.filter(project => hasFinalVideo(project, entries));
      const scheduledProjects = new Set(entries.filter(entry => entry.extendedProps?.status === 'scheduled')
        .map(entry => entry.extendedProps?.projectId || entry.title));
      const counts = {
        all: list.length, progress: list.length - completed.length, completed: completed.length,
        scheduled: list.filter(project => scheduledProjects.has(project.project_id) || scheduledProjects.has(project.name)).length
      };
      const rootNode = requireRoot();
      Object.entries(counts).forEach(([key, value]) => {
        const target = rootNode.querySelector(`[data-index-count="${key}"]`);
        if (target) target.textContent = String(value).padStart(2, '0');
      });
      const holder = requireNode('#contentIndex');
      holder.querySelectorAll('[data-project-id],.content-index-empty').forEach(item => item.remove());
      if (!list.length) {
        holder.insertAdjacentHTML('beforeend', '<p class="content-index-empty">아직 제작한 콘텐츠가 없습니다. 아래 버튼으로 첫 콘텐츠를 만들어 보세요.</p>');
        return;
      }
      list.forEach((project, index) => {
        const automationStatus = project.automation_status || '';
        const automationActive = ['queued', 'running'].includes(automationStatus);
        const automationFailed = automationStatus === 'failed';
        const automationStopped = automationStatus === 'cancelled';
        const statusClass = {queued: 'automation-queued', running: 'automation-running', failed: 'automation-failed', cancelled: 'automation-cancelled', succeeded: 'automation-succeeded'}[automationStatus] || '';
        const statusText = {queued: '자동 대기', running: '자동 진행 중', failed: '자동 오류', cancelled: '자동 중지', succeeded: '자동 완료'}[automationStatus] || `STEP ${String(project.current_stage || 2).padStart(2, '0')}`;
        const detail = (automationActive || automationFailed || automationStopped)
          ? `<span class="content-index-automation-detail ${automationFailed ? 'failed' : automationActive ? 'running' : ''}"${automationFailed && project.automation_error_message ? ` title="${deps.escapeHtml(project.automation_error_message)}"` : ''}>${automationFailed ? '오류 정지 위치' : automationStopped ? '중지 위치' : automationActive ? '진행 단계' : ''} · ${deps.escapeHtml(deps.automationStageLabel(project.automation_stage))}</span>` : '';
        holder.insertAdjacentHTML('beforeend', `<article class="content-index-row" data-project-id="${deps.escapeHtml(project.project_id)}" data-state="${hasFinalVideo(project, entries) ? 'completed' : 'progress'}"><span class="content-index-no">${String(index + 1).padStart(3, '0')}</span><div class="content-index-title"><strong>${deps.escapeHtml(project.name)}${project.is_automated ? '<span class="content-index-auto-badge" aria-label="자동 생성 콘텐츠">자동</span>' : ''}</strong><small>${deps.escapeHtml(project.project_id)}</small></div><span class="content-index-status ${hasFinalVideo(project, entries) ? 'done' : ''} ${statusClass}">${deps.escapeHtml(statusText)}</span><span class="content-index-meta"><span>${deps.projectDate(project.updated_at)}</span>${detail}</span><button class="content-index-open" type="button">상세 보기</button></article>`);
      });
      list.forEach(project => {
        const stage = project.automation_stage || '';
        if (!project.is_automated || !['3-1', '4', '5'].includes(project.automation_endpoint) || !(stage === 'voice_prepare' || stage.startsWith('image_') || stage.startsWith('video_') || stage.startsWith('crop_') || stage === 'final_export_calendar')) return;
        const row = [...holder.querySelectorAll('.content-index-row[data-project-id]')].find(item => item.dataset.projectId === project.project_id);
        const meta = row?.querySelector('.content-index-meta');
        if (!meta) return;
        const voiceTotal = Number(project.automation_voice_total) || 0;
        const voiceDone = Math.min(Number(project.automation_voice_done) || 0, voiceTotal);
        const imageTotal = Number(project.automation_images_total) || 0;
        const imageDone = Math.min(Number(project.automation_images_done) || 0, imageTotal);
        if (stage === 'voice_prepare' && voiceTotal) meta.insertAdjacentHTML('beforeend', `<span class="content-index-automation-progress">음성 ${voiceDone}/${voiceTotal}</span>`);
        if (stage !== 'voice_prepare') {
          if (voiceTotal) meta.insertAdjacentHTML('beforeend', `<span class="content-index-automation-progress">음성 ${voiceDone}/${voiceTotal}</span>`);
          if (imageTotal) meta.insertAdjacentHTML('beforeend', `<span class="content-index-automation-progress">장면 이미지 ${imageDone}/${imageTotal}</span>`);
        }
      });
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
      let holder;
      try { holder = requireRoot().querySelector('#contentIndex'); }
      catch (error) { deps.onPollError(error); return; }
      if (!holder || holder.offsetParent === null || pollBusy) return;
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
