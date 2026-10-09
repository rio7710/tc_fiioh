const assert = require('node:assert/strict');
const Controller = require('../01_app/assets/steps/step01/step01-project-index-controller.js');
const View = require('../01_app/assets/steps/step01/step01-project-index-view.js');

(async () => {
  const counts = Object.fromEntries(['all', 'progress', 'completed', 'scheduled'].map(key => [key, {textContent: ''}]));
  const rows = [];
  let emptyMarkup = '';
  const holder = {
    offsetParent: {},
    querySelectorAll(selector) {
      if (selector === '[data-project-id],.content-index-empty') return [...rows, {remove() { emptyMarkup = ''; }}];
      if (selector === '.content-index-row[data-project-id]') return rows;
      return [];
    },
    insertAdjacentHTML(position, html) {
      if (html.includes('content-index-empty')) { emptyMarkup = html; return; }
      const projectId = html.match(/data-project-id="([^"]+)"/)?.[1].replaceAll('&lt;', '<').replaceAll('&amp;', '&');
      const meta = {html: '', insertAdjacentHTML(where, markup) { this.html += markup; }};
      rows.push({dataset: {projectId}, html, remove() { const index = rows.indexOf(this); if (index >= 0) rows.splice(index, 1); }, querySelector(selector) { return selector === '.content-index-meta' ? meta : null; }, meta});
    }
  };
  const root = {querySelector(selector) {
    const count = selector.match(/^\[data-index-count="(.+)"\]$/)?.[1];
    if (count) return counts[count] || null;
    return selector === '#contentIndex' ? holder : null;
  }};
  const projectsIndex = {stale: {}};
  const identity = projectsIndex;
  let calendarEntries = [];
  let remembered = null;
  let active = null;
  let requestHandler = async () => ({projects: []});
  let brandHandler = async () => {};
  const calls = [];
  const errors = [];
  const timers = new Map();
  let nextTimer = 1;
  const viewDeps = {getRoot: () => root, getCalendarEntries: () => calendarEntries,
    calendarContentVersions: entry => entry.extendedProps?.contentVersions?.filter(item => item?.url) || [],
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    projectDate: value => `DATE:${value || 'none'}`, automationStageLabel: value => `STAGE:${value || 'none'}`};
  const view = View.create(viewDeps);
  const deps = {
    projectsIndex, view,
    getRememberedProjectId: () => remembered, getActiveProjectId: () => active,
    setActiveProjectId: id => { active = id; calls.push(['active', id]); },
    request: async (...args) => { calls.push(['request', ...args]); return requestHandler(...args); },
    refreshBrandLibrary: async () => { calls.push(['brand']); return brandHandler(); },
    setInterval: (callback, delay) => { const id = nextTimer++; timers.set(id, {callback, delay}); return id; },
    clearInterval: id => { calls.push(['clear', id]); timers.delete(id); }, onPollError: error => errors.push(error)
  };
  const controller = Controller.create(deps);
  assert.equal(Object.isFrozen(controller), true);
  assert.throws(() => Controller.create(), /requires getRememberedProjectId/);
  assert.throws(() => Controller.create({...deps, view: null}), /requires view/);
  assert.throws(() => Controller.create({...deps, projectsIndex: null}), /requires projectsIndex/);

  const raw = [
    {project_id: 'A<&', name: 'Alpha<&', current_stage: 3, updated_at: '2026', selected_keywords: [], automation_status: 'failed', automation_stage: 'video_complete_scene-02', automation_error_message: 'bad<&', is_automated: true, automation_endpoint: '4', automation_voice_total: 2, automation_voice_done: 9, automation_images_total: 3, automation_images_done: 1, automation_videos_total: 4, automation_videos_done: 2},
    {project_id: 'B', name: 'Beta', current_stage: 0, automation_status: 'running', automation_stage: 'image_generate', is_automated: true, automation_endpoint: '5', automation_voice_total: 1, automation_voice_done: 1, automation_images_total: 2, automation_images_done: 9},
    {project_id: 'C', name: 'Legacy', automation_status: 'cancelled', automation_stage: 'video_complete'},
    {project_id: 'D', name: 'Versioned', automation_status: 'succeeded'}
  ];
  calendarEntries = [
    {title: 'Alpha', extendedProps: {projectId: 'A<&', contentUrl: '/a.mp4', status: 'scheduled'}},
    {title: 'Legacy', extendedProps: {contentUrl: '/legacy.mp4', status: 'scheduled'}},
    {title: 'Versioned', extendedProps: {projectId: 'D', contentVersions: [{url: '/v.mp4'}]}},
    {title: 'Beta', extendedProps: {projectId: 'B', status: 'scheduled'}}
  ];
  remembered = 'B'; calls.length = 0;
  controller.render(raw);
  assert.equal(projectsIndex, identity, 'projects index identity is stable');
  assert.equal('stale' in projectsIndex, false);
  assert.equal(projectsIndex.A, undefined);
  assert.equal(projectsIndex['A<&'].title, 'Alpha<&');
  assert.equal(projectsIndex['A<&'].summary, '콘텐츠 ID · A<&');
  assert.equal(projectsIndex.B.currentStep, '2', 'falsy current stage defaults to 2');
  assert.deepEqual(projectsIndex.B.steps.map(item => item.key), ['1', '2', '3', '3-1', '4', '5']);
  assert.deepEqual(Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, value.textContent])), {all: '04', progress: '01', completed: '03', scheduled: '03'});
  assert.equal(rows.length, 4);
  assert.match(rows[0].html, /data-project-id="A&lt;&amp;"/);
  assert.match(rows[0].html, /Alpha&lt;&amp;/);
  assert.match(rows[0].html, /automation-failed/);
  assert.match(rows[0].html, /title="bad&lt;&amp;"/);
  assert.match(rows[0].html, /오류 정지 위치 · STAGE:video_complete_scene-02/);
  assert.match(rows[1].html, /automation-running/);
  assert.match(rows[2].html, /자동 중지/);
  assert.match(rows[3].html, /자동 완료/);
  assert.match(rows[0].meta.html, /음성 2\/2/);
  assert.match(rows[0].meta.html, /장면 이미지 1\/3/);
  assert.match(rows[0].meta.html, /Kling 영상 2\/4/);
  assert.match(rows[1].meta.html, /장면 이미지 2\/2/);
  assert.deepEqual(calls.at(-1), ['active', 'B']);

  calendarEntries = [];
  const voice = [{project_id: 'V', name: 'Voice', is_automated: true, automation_endpoint: '3-1', automation_stage: 'voice_prepare', automation_voice_total: 2, automation_voice_done: 1, automation_images_total: 2, automation_images_done: 1}];
  remembered = null; active = null; calls.length = 0;
  controller.render(voice);
  assert.match(rows[0].meta.html, /음성 1\/2/);
  assert.doesNotMatch(rows[0].meta.html, /장면 이미지/);
  assert.deepEqual(calls.at(-1), ['active', 'V'], 'one project is selected when nothing is remembered');

  remembered = 'missing'; active = 'V'; calls.length = 0;
  controller.render(voice);
  assert.deepEqual(calls.at(-1), ['active', null]);
  remembered = null; active = 'missing'; calls.length = 0;
  controller.render([{...voice[0]}, {project_id: 'W', name: 'Other'}]);
  assert.deepEqual(calls.at(-1), ['active', null]);

  remembered = 'stale'; active = 'stale'; calls.length = 0;
  controller.render([]);
  assert.match(emptyMarkup, /아직 제작한 콘텐츠가 없습니다/);
  assert.equal(calls.some(item => item[0] === 'active'), false, 'empty early return preserves stale active identity');

  let releaseProjects;
  let releaseBrand;
  const projectsPromise = new Promise(resolve => { releaseProjects = resolve; });
  const brandPromise = new Promise(resolve => { releaseBrand = resolve; });
  requestHandler = () => projectsPromise;
  brandHandler = () => brandPromise;
  calls.length = 0;
  const refreshing = controller.refresh();
  assert.deepEqual(calls.map(item => item[0]), ['request', 'brand'], 'refresh starts projects and brand concurrently');
  releaseProjects({projects: voice});
  await Promise.resolve();
  assert.equal(projectsIndex.V, undefined, 'render waits for brand refresh too');
  releaseBrand();
  await refreshing;
  assert.ok(projectsIndex.V);

  requestHandler = async () => { throw new Error('api failed'); };
  await assert.rejects(() => controller.refresh(), /api failed/);
  brandHandler = async () => { throw new Error('brand failed'); };
  requestHandler = async () => ({projects: voice});
  await assert.rejects(() => controller.refresh(), /brand failed/);
  brandHandler = async () => {};

  holder.offsetParent = null; calls.length = 0;
  await controller.pollOnce();
  assert.equal(calls.length, 0, 'hidden index skips poll');
  holder.offsetParent = {}; requestHandler = async () => ({projects: voice}); calls.length = 0;
  await controller.pollOnce();
  assert.deepEqual(calls.filter(item => item[0] === 'request').map(item => item[1]), ['/api/projects']);
  assert.equal(calls.some(item => item[0] === 'brand'), false, 'poll never refreshes brand library');

  let releasePoll;
  requestHandler = () => new Promise(resolve => { releasePoll = resolve; });
  calls.length = 0;
  const firstPoll = controller.pollOnce();
  await controller.pollOnce();
  assert.equal(calls.filter(item => item[0] === 'request').length, 1, 'busy poll does not overlap');
  releasePoll({projects: voice});
  await firstPoll;
  requestHandler = async () => { throw new Error('poll failed'); };
  await controller.pollOnce();
  assert.match(errors.at(-1).message, /poll failed/);
  const originalCalendarGetter = viewDeps.getCalendarEntries;
  viewDeps.getCalendarEntries = () => { throw new Error('render failed'); };
  requestHandler = async () => ({projects: voice});
  await controller.pollOnce();
  assert.match(errors.at(-1).message, /render failed/);
  viewDeps.getCalendarEntries = originalCalendarGetter;
  requestHandler = async () => ({projects: voice});
  await controller.pollOnce();
  assert.equal(calls.filter(item => item[0] === 'request').length, 4, 'poll recovers after request and render failures');

  assert.equal(controller.isPolling(), false);
  assert.equal(controller.startPolling(), true);
  assert.equal(controller.startPolling(), false);
  assert.equal(controller.isPolling(), true);
  assert.equal(timers.size, 1);
  const timer = [...timers.values()][0];
  assert.equal(timer.delay, 5000);
  let releaseStoppedPoll;
  requestHandler = () => new Promise(resolve => { releaseStoppedPoll = resolve; });
  const stoppedInFlight = timer.callback();
  assert.equal(controller.stopPolling(), true);
  releaseStoppedPoll({projects: voice});
  await stoppedInFlight;
  assert.ok(projectsIndex.V, 'stopping does not invalidate an already in-flight poll');
  assert.equal(controller.stopPolling(), false);
  assert.equal(controller.isPolling(), false);
  assert.equal(controller.startPolling(), true, 'polling restarts after stop');
  controller.stopPolling();

  console.log('Step01 project index controller tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
