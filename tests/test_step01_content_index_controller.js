const assert = require('node:assert/strict');
const Controller = require('../01_app/assets/steps/step01/step01-content-index-controller.js');

(async () => {
  function element(extra = {}) {
    const listeners = new Map();
    return Object.assign({
      textContent: '', innerHTML: '', hidden: false, disabled: false, title: '', dataset: {},
      classList: {active: false, toggle(name, enabled) { if (name === 'active') this.active = enabled; }},
      attributes: {}, setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(type, listener) { const list = listeners.get(type) || []; list.push(listener); listeners.set(type, list); },
      removeEventListener(type, listener) { listeners.set(type, (listeners.get(type) || []).filter(item => item !== listener)); },
      fire(type, target) { return Promise.all((listeners.get(type) || []).map(listener => listener({currentTarget: this, target: target || this}))); },
      listeners
    }, extra);
  }

  const filterAll = element({dataset: {indexFilter: 'all'}});
  const filterProgress = element({dataset: {indexFilter: 'progress'}});
  const progressRow = element({dataset: {projectId: 'A', state: 'progress'}});
  const completedRow = element({dataset: {projectId: 'B', state: 'completed'}});
  const action2 = element({dataset: {go: '2'}});
  const action4 = element({dataset: {go: '4'}});
  const nodes = {
    '#contentIndex': element(), '#projectDetailContinue': element(), '#projectDeleteButton': element(), '#createProjectButton': element(),
    '#projectDetailKicker': element(), '#projectDetailTitle': element(), '#projectDetailSummary': element(),
    '#projectDetailStatus': element(), '#projectDetailNote': element(), '#projectDetailSteps': element()
  };
  const root = {
    querySelector: selector => nodes[selector] || null,
    querySelectorAll(selector) {
      if (selector === '[data-index-filter]') return [filterAll, filterProgress];
      if (selector === '.content-index-row[data-project-id]') return [progressRow, completedRow];
      if (selector === '.project-detail-actions [data-go]') return [action2, action4];
      return [];
    }
  };
  const projects = {A: {
    title: '<Alpha>', summary: 'Summary', currentStep: '3', note: 'Note', created_at: '2026-01-02',
    selected_keywords: ['one', '<two>'], steps: [
      {key: '1', label: 'Create'}, {key: '2', label: '<Keywords>'}, {key: '3', label: 'Script'}, {key: '4', label: 'Video'}
    ]
  }};
  let activeProjectId = null;
  let keywords = [{id: 's', seasonal: true}, ...Array.from({length: 10}, (_, index) => ({id: `k${index}`, seasonal: false}))];
  let visibleIds = [];
  let requestHandler = async path => path === '/api/projects' ? {project: {project_id: 'NEW'}} : {};
  let confirmResult = true;
  const calls = [];
  const deps = {
    request: async (...args) => { calls.push(['request', ...args]); return requestHandler(...args); },
    getProjects: () => projects, getActiveProjectId: () => activeProjectId,
    beginNav: () => calls.push(['beginNav']),
    setActiveProjectId: id => { activeProjectId = id; calls.push(['setActive', id]); },
    showStep: (...args) => calls.push(['showStep', ...args]),
    showBrandLibrary: value => calls.push(['showBrand', value]),
    navigateProjectStep: async value => calls.push(['navigate', value]),
    resetProjectScopedState: () => calls.push(['reset']),
    setKeywordStageLocked: value => { calls.push(['locked', value]); calls.push(['renderFromLock']); },
    setVoiceProfile: value => calls.push(['voice', value]), getKeywords: () => keywords,
    setVisibleKeywordIds: ids => { visibleIds = ids; calls.push(['visible', ids]); },
    renderKeywords: () => calls.push(['render']), refreshProjectIndex: async () => calls.push(['refresh']),
    confirm: message => { calls.push(['confirm', message]); return confirmResult; },
    alert: message => calls.push(['alert', message]),
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    projectCreatedDate: value => `DATE:${value}`
  };
  const controller = Controller.create(deps);
  assert.equal(Object.isFrozen(controller), true);
  assert.throws(() => Controller.create(), /requires request/);
  assert.throws(() => controller.mount({}), /mount requires root/);
  assert.equal(controller.mount(root), true);
  assert.equal(controller.mount(root), true);
  assert.equal(nodes['#contentIndex'].listeners.get('click').length, 1);

  calls.length = 0;
  assert.equal(controller.openProject('missing'), undefined);
  assert.deepEqual(calls, []);
  controller.openProject('A', 'replace');
  assert.deepEqual(calls.slice(0, 2), [['beginNav'], ['setActive', 'A']]);
  assert.deepEqual(calls.at(-1), ['showStep', 'project', 'replace']);
  assert.equal(nodes['#projectDetailKicker'].textContent, 'PROJECT · A');
  assert.equal(nodes['#projectDetailTitle'].textContent, '<Alpha>');
  assert.equal(nodes['#projectDetailStatus'].textContent, '2 / 4 제작 항목 완료 · STEP 03 진행 중');
  assert.match(nodes['#projectDetailSteps'].innerHTML, /class="completed"/);
  assert.match(nodes['#projectDetailSteps'].innerHTML, /&lt;Keywords>/);
  assert.match(nodes['#projectDetailSteps'].innerHTML, /&lt;two>/);
  assert.equal(action2.disabled, true, 'completed keyword stage is locked');
  assert.equal(action2.attributes['aria-disabled'], 'true');
  assert.equal(action2.title, '대본이 생성되어 키워드가 확정되었습니다.');
  assert.equal(action4.disabled, true);
  assert.equal(action4.title, '이전 단계를 먼저 완료해 주세요.');
  assert.equal(nodes['#projectDetailContinue'].dataset.targetStep, '3');

  calls.length = 0;
  controller.applyFilter(filterProgress);
  assert.deepEqual(calls[0], ['showBrand', false]);
  assert.equal(filterProgress.classList.active, true);
  assert.equal(filterAll.classList.active, false);
  assert.equal(progressRow.hidden, false);
  assert.equal(completedRow.hidden, true);
  controller.applyFilter(filterAll);
  assert.equal(completedRow.hidden, false);

  nodes['#projectDetailContinue'].dataset.targetStep = '';
  calls.length = 0; await controller.continueProject(nodes['#projectDetailContinue']);
  assert.deepEqual(calls, [['navigate', '2']]);
  deps.navigateProjectStep = async () => { throw new Error('navigate failed'); };
  // Dependencies are referenced live through the original object.
  await controller.continueProject(nodes['#projectDetailContinue']);
  assert.equal(nodes['#projectDetailNote'].textContent, 'navigate failed');
  deps.navigateProjectStep = async value => calls.push(['navigate', value]);

  activeProjectId = null; calls.length = 0;
  await controller.deleteProject(nodes['#projectDeleteButton']);
  assert.deepEqual(calls, []);
  activeProjectId = 'A'; confirmResult = false;
  await controller.deleteProject(nodes['#projectDeleteButton']);
  assert.match(calls[0][1], /“<Alpha>”를 삭제할까요\?\n저장된 제작 데이터도 함께 삭제됩니다\./);
  assert.equal(nodes['#projectDeleteButton'].disabled, false);

  confirmResult = true; calls.length = 0;
  await controller.deleteProject(nodes['#projectDeleteButton']);
  const deleteRequest = calls.find(item => item[0] === 'request');
  assert.equal(deleteRequest[1], '/api/project/delete');
  assert.deepEqual(JSON.parse(deleteRequest[2].body), {project_id: 'A'});
  assert.deepEqual(calls.map(item => item[0]), ['confirm', 'request', 'reset', 'setActive', 'locked', 'renderFromLock', 'refresh', 'showStep']);
  assert.deepEqual(calls.at(-1), ['showStep', 'index']);
  assert.equal(nodes['#projectDeleteButton'].disabled, false);

  activeProjectId = 'A'; calls.length = 0;
  requestHandler = async () => { throw new Error('delete failed'); };
  await controller.deleteProject(nodes['#projectDeleteButton']);
  assert.equal(calls.some(item => item[0] === 'reset'), false);
  assert.equal(nodes['#projectDetailNote'].textContent, 'delete failed');
  assert.equal(nodes['#projectDeleteButton'].disabled, false);

  requestHandler = async path => path === '/api/projects' ? {project: {project_id: 'NEW'}} : {};
  calls.length = 0;
  await controller.createProject(nodes['#createProjectButton']);
  const createRequest = calls.find(item => item[0] === 'request');
  assert.equal(createRequest[1], '/api/projects');
  assert.deepEqual(JSON.parse(createRequest[2].body), {name: '새 콘텐츠'});
  assert.deepEqual(calls.map(item => item[0]), ['request', 'reset', 'setActive', 'locked', 'renderFromLock', 'voice', 'visible', 'render', 'refresh', 'showStep']);
  assert.deepEqual(visibleIds, ['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7']);
  assert.equal(calls.filter(item => item[0] === 'renderFromLock' || item[0] === 'render').length, 2, 'unlock render plus explicit render are preserved');
  assert.deepEqual(calls.at(-1), ['showStep', 2]);
  assert.equal(nodes['#createProjectButton'].disabled, false);

  requestHandler = async () => { throw new Error('create failed'); }; calls.length = 0;
  await controller.createProject(nodes['#createProjectButton']);
  assert.deepEqual(calls.map(item => item[0]), ['request', 'alert']);
  assert.deepEqual(calls.at(-1), ['alert', 'create failed']);
  assert.equal(nodes['#createProjectButton'].disabled, false);

  calls.length = 0;
  await nodes['#contentIndex'].fire('click', {closest: () => ({dataset: {projectId: 'A'}})});
  assert.deepEqual(calls.slice(0, 2), [['beginNav'], ['setActive', 'A']]);
  controller.unmount();
  assert.equal(nodes['#contentIndex'].listeners.get('click').length, 0);
  assert.throws(() => controller.openProject('A'), /not mounted/);
  assert.equal(controller.mount(root), true, 'remount succeeds');
  controller.unmount();
  const missingRoot = {...root, querySelector: selector => selector === '#projectDeleteButton' ? null : nodes[selector] || null};
  assert.throws(() => controller.mount(missingRoot), /missing #projectDeleteButton/);
  assert.equal(controller.mount(root), true, 'failed mount rolls back');
  controller.unmount();

  console.log('Step01 content index controller tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
