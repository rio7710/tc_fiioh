(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Step01ContentIndexController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(dependencies) {
    const deps = dependencies || {};
    for (const name of [
      'request', 'getProjects', 'getActiveProjectId', 'beginNav', 'setActiveProjectId',
      'showStep', 'showBrandLibrary', 'navigateProjectStep', 'resetProjectScopedState',
      'setKeywordStageLocked', 'setVoiceProfile', 'getKeywords', 'setVisibleKeywordIds',
      'renderKeywords', 'refreshProjectIndex', 'confirm', 'alert', 'escapeHtml', 'projectCreatedDate'
    ]) {
      if (typeof deps[name] !== 'function') throw new TypeError(`Step01ContentIndexController requires ${name}`);
    }

    let mountedRoot = null;
    let listeners = [];

    function requireRoot() {
      if (!mountedRoot || typeof mountedRoot.querySelector !== 'function') throw new Error('Step01ContentIndexController is not mounted');
      return mountedRoot;
    }
    function requireNode(selector) {
      const node = requireRoot().querySelector(selector);
      if (!node) throw new Error(`Step01ContentIndexController missing ${selector}`);
      return node;
    }

    function openProject(projectId, historyMode = 'push') {
      const project = deps.getProjects()[projectId];
      if (!project) return;
      deps.beginNav();
      deps.setActiveProjectId(projectId);
      requireNode('#projectDetailKicker').textContent = `PROJECT · ${projectId}`;
      requireNode('#projectDetailTitle').textContent = project.title;
      requireNode('#projectDetailSummary').textContent = project.summary;
      const currentKey = project.currentStep || '2';
      const currentIndex = Math.max(0, project.steps.findIndex(item => item.key === currentKey));
      const completedCount = currentIndex;
      requireNode('#projectDetailStatus').textContent = `${completedCount} / ${project.steps.length} 제작 항목 완료 · STEP ${currentKey.padStart(2, '0')} 진행 중`;
      requireNode('#projectDetailNote').textContent = project.note;
      requireNode('#projectDetailSteps').innerHTML = project.steps.map((item, index) => {
        const state = index < currentIndex ? 'completed' : index === currentIndex ? 'current' : 'locked';
        const stateLabel = state === 'completed' ? '✓ 완료' : state === 'current' ? '진행 중' : '미완료';
        const detailText = item.key === '1' ? deps.projectCreatedDate(project.created_at) : item.key === '2' ? (project.selected_keywords || []).join(', ') : '';
        const detail = detailText ? ` <span class="project-step-keywords">· ${deps.escapeHtml(detailText)}</span>` : '';
        return `<li class="${state}"><b>${item.key.padStart(2, '0')}</b><span class="project-step-label" title="${deps.escapeHtml(detailText)}">${deps.escapeHtml(item.label)}${detail}</span><span class="project-step-state">${stateLabel}</span></li>`;
      }).join('');
      requireRoot().querySelectorAll('.project-detail-actions [data-go]').forEach(button => {
        const targetIndex = project.steps.findIndex(item => item.key === button.dataset.go);
        const completedKeyword = button.dataset.go === '2' && currentIndex >= 2;
        const locked = targetIndex > currentIndex || completedKeyword;
        button.disabled = locked;
        button.setAttribute('aria-disabled', String(locked));
        button.title = completedKeyword ? '대본이 생성되어 키워드가 확정되었습니다.' : locked ? '이전 단계를 먼저 완료해 주세요.' : '';
      });
      requireNode('#projectDetailContinue').dataset.targetStep = currentKey;
      deps.showStep('project', historyMode);
    }

    function applyFilter(button) {
      deps.showBrandLibrary(false);
      const filter = button.dataset.indexFilter;
      requireRoot().querySelectorAll('[data-index-filter]').forEach(item => item.classList.toggle('active', item === button));
      requireRoot().querySelectorAll('.content-index-row[data-project-id]').forEach(row => {
        row.hidden = filter !== 'all' && row.dataset.state !== filter;
      });
    }

    async function continueProject(button) {
      try {
        await deps.navigateProjectStep(button.dataset.targetStep || '2');
      } catch (error) {
        requireNode('#projectDetailNote').textContent = error.message;
      }
    }

    async function deleteProject(button) {
      const activeProjectId = deps.getActiveProjectId();
      if (!activeProjectId) return;
      const project = deps.getProjects()[activeProjectId];
      if (!deps.confirm(`“${project?.title || '이 콘텐츠'}”를 삭제할까요?\n저장된 제작 데이터도 함께 삭제됩니다.`)) return;
      button.disabled = true;
      try {
        await deps.request('/api/project/delete', {method: 'POST', body: JSON.stringify({project_id: activeProjectId})});
        deps.resetProjectScopedState();
        deps.setActiveProjectId(null);
        deps.setKeywordStageLocked(false);
        await deps.refreshProjectIndex();
        deps.showStep('index');
      } catch (error) {
        requireNode('#projectDetailNote').textContent = error.message;
      } finally {
        button.disabled = false;
      }
    }

    async function createProject(button) {
      button.disabled = true;
      try {
        const result = await deps.request('/api/projects', {method: 'POST', body: JSON.stringify({name: '새 콘텐츠'})});
        deps.resetProjectScopedState();
        deps.setActiveProjectId(result.project.project_id);
        deps.setKeywordStageLocked(false);
        deps.setVoiceProfile('warm_female');
        deps.setVisibleKeywordIds(deps.getKeywords().filter(item => !item.seasonal).slice(0, 8).map(item => item.id));
        deps.renderKeywords();
        await deps.refreshProjectIndex();
        deps.showStep(2);
      } catch (error) {
        deps.alert(error.message);
      } finally {
        button.disabled = false;
      }
    }

    function unmount() {
      listeners.forEach(({node, type, listener}) => node.removeEventListener(type, listener));
      listeners = [];
      mountedRoot = null;
    }

    function mount(rootNode) {
      if (mountedRoot) return true;
      if (!rootNode || typeof rootNode.querySelector !== 'function') throw new TypeError('Step01ContentIndexController mount requires root');
      mountedRoot = rootNode;
      try {
        const contentIndex = requireNode('#contentIndex');
        const filters = [...requireRoot().querySelectorAll('[data-index-filter]')];
        const continueButton = requireNode('#projectDetailContinue');
        const deleteButton = requireNode('#projectDeleteButton');
        const createButton = requireNode('#createProjectButton');
        const bindings = [
          [contentIndex, 'click', event => { const row = event.target.closest('[data-project-id]'); if (row) openProject(row.dataset.projectId); }],
          ...filters.map(button => [button, 'click', () => applyFilter(button)]),
          [continueButton, 'click', event => continueProject(event.currentTarget)],
          [deleteButton, 'click', event => deleteProject(event.currentTarget)],
          [createButton, 'click', event => createProject(event.currentTarget)]
        ];
        bindings.forEach(([node, type, listener]) => {
          node.addEventListener(type, listener);
          listeners.push({node, type, listener});
        });
        return true;
      } catch (error) {
        unmount();
        throw error;
      }
    }

    return Object.freeze({mount, unmount, openProject, applyFilter, continueProject, deleteProject, createProject});
  }

  return Object.freeze({create});
});
