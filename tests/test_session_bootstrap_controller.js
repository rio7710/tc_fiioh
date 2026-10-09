const assert = require('node:assert/strict');
const Bootstrap = require('../01_app/assets/core/session-bootstrap-controller.js');

(async () => {
  function harness(overrides = {}) {
    const calls = [];
    let active = Object.prototype.hasOwnProperty.call(overrides, 'active') ? overrides.active : 'A';
    let stale = false;
    let token = 0;
    const route = overrides.route || {step: '4', projectId: 'A', explicitProject: true};
    const navigation = {
      begin() { calls.push(['begin']); return ++token; }, isStale() { return stale; }, readRoute() { calls.push(['readRoute']); return route; },
      selectRouteProject(value) { calls.push(['select', value]); if (overrides.validRoute === false) { active = null; return false; } return true; },
      showStep(...args) { calls.push(['show', ...args]); if (overrides.showError) throw overrides.showError; },
      prepareStep(...args) { calls.push(['prepare', ...args]); if (overrides.prepareError) throw overrides.prepareError; }
    };
    const deps = {
      request: async path => { calls.push(['request', path]); if (overrides.request) return overrides.request(path); if (overrides.sessionError) throw overrides.sessionError; return overrides.session || {authenticated: true, user: {name: 'user'}}; },
      navigation,
      setLoginAccess: (...args) => calls.push(['login', ...args]),
      refreshProjectIndex: async () => { calls.push(['refresh']); if (overrides.refreshError) throw overrides.refreshError; if (overrides.staleAfterRefresh) stale = true; },
      hydrateCalendarEntries: async () => { calls.push(['calendar']); if (overrides.calendarError) throw overrides.calendarError; if (overrides.staleAfterCalendar) stale = true; },
      getActiveProjectId: () => active,
      openIndexProject: (...args) => calls.push(['open', ...args]),
      loadProjectState: async (...args) => { calls.push(['state', ...args]); if (overrides.stateError) throw overrides.stateError; if (overrides.staleAfterState) stale = true; return overrides.restored || {content: true}; },
      loadProjectContent: async (...args) => { calls.push(['content', ...args]); if (overrides.contentError) throw overrides.contentError; if (overrides.staleAfterContent) stale = true; return {}; },
      setContentIndexError: (...args) => calls.push(['error', ...args])
    };
    return {controller: Bootstrap.create(deps), calls, setStale: value => { stale = value; }};
  }

  assert.throws(() => Bootstrap.create(), /requires request/);
  const missingNavigation = {request() {}, setLoginAccess() {}, refreshProjectIndex() {}, hydrateCalendarEntries() {}, getActiveProjectId() {}, openIndexProject() {}, loadProjectState() {}, loadProjectContent() {}, setContentIndexError() {}};
  assert.throws(() => Bootstrap.create(missingNavigation), /requires navigation/);
  assert.equal(Object.isFrozen(harness().controller), true);

  let h = harness({session: {authenticated: false}});
  assert.equal(await h.controller.restore(), undefined);
  assert.deepEqual(h.calls.slice(0, 4).map(item => item[0]), ['login', 'begin', 'readRoute', 'request']);
  assert.deepEqual(h.calls.at(-2), ['login', false, {authenticated: false}]);
  assert.deepEqual(h.calls.at(-1), ['show', 1, 'replace']);
  assert.equal(h.calls.some(item => item[0] === 'refresh'), false);

  h = harness({sessionError: new Error('session failed')});
  await h.controller.restore();
  assert.deepEqual(h.calls.slice(-2), [['login', false], ['show', 1, 'replace']]);

  let releaseSession;
  h = harness({request: () => new Promise(resolve => { releaseSession = resolve; })});
  const staleSession = h.controller.restore(); h.setStale(true); releaseSession({authenticated: true}); await staleSession;
  assert.equal(h.calls.filter(item => item[0] === 'login').length, 1, 'stale session success does not apply account state');
  let rejectSession;
  h = harness({request: () => new Promise((_resolve, reject) => { rejectSession = reject; })});
  const staleSessionError = h.controller.restore(); h.setStale(true); rejectSession(new Error('late failure')); await staleSessionError;
  assert.equal(h.calls.some(item => item[0] === 'show'), false, 'stale session failure does not replace the newer view');

  h = harness();
  await h.controller.restore();
  assert.deepEqual(h.calls.map(item => item[0]), ['login','begin','readRoute','request','login','refresh','error','calendar','error','select','state','content','show','prepare','error']);
  assert.deepEqual(h.calls.filter(item => item[0] === 'error'), [['error','index',''],['error','calendar',''],['error','content','']]);
  assert.deepEqual(h.calls.find(item => item[0] === 'show'), ['show','4','replace']);

  h = harness({refreshError: new Error('projects offline'), calendarError: new Error('calendar offline')});
  await h.controller.restore();
  assert.ok(h.calls.some(item => item[0] === 'error' && item[1] === 'index' && item[2] === '콘텐츠 목록을 불러오지 못했습니다: projects offline'));
  assert.ok(h.calls.some(item => item[0] === 'error' && item[1] === 'calendar' && item[2] === '배포 캘린더를 불러오지 못했습니다: calendar offline'));
  assert.ok(h.calls.some(item => item[0] === 'state'), 'hydration failures do not stop route restoration');

  h = harness({staleAfterRefresh: true});
  await h.controller.restore();
  assert.ok(h.calls.some(item => item[0] === 'calendar'), 'calendar still hydrates after refresh becomes stale');
  assert.equal(h.calls.some(item => item[0] === 'select'), false, 'final stale check stops route restoration');

  h = harness({route: {step: 'project', projectId: 'A', explicitProject: true}});
  await h.controller.restore();
  assert.deepEqual(h.calls.at(-1), ['open','A','replace']);
  assert.equal(h.calls.some(item => item[0] === 'state'), false);

  h = harness({active: null, route: {step: '4', projectId: 'missing', explicitProject: true}, validRoute: false});
  await h.controller.restore();
  assert.ok(h.calls.some(item => item[0] === 'show' && item[1] === 'index' && item[2] === 'replace'));
  assert.equal(h.calls.some(item => item[0] === 'state'), false);

  h = harness({active: null, route: {step: '3', projectId: null, explicitProject: false}});
  await h.controller.restore();
  assert.ok(h.calls.some(item => item[0] === 'error' && item[1] === 'content' && item[2] === '이전에 보던 콘텐츠를 찾을 수 없어 목록으로 이동했습니다. 아래에서 다시 선택해 주세요.'));
  assert.ok(h.calls.some(item => item[0] === 'show' && item[1] === 'index'));

  h = harness({route: {step: 'index', projectId: null, explicitProject: false}});
  await h.controller.restore();
  assert.ok(h.calls.some(item => item[0] === 'state'), 'active project state loads even for index route');
  assert.equal(h.calls.some(item => item[0] === 'content'), false);

  h = harness({restored: {content: false}, route: {step: '3-1', projectId: 'A', explicitProject: true}});
  await h.controller.restore();
  assert.equal(h.calls.some(item => item[0] === 'content'), false);
  assert.ok(h.calls.some(item => item[0] === 'show' && item[1] === '2'));
  assert.ok(h.calls.some(item => item[0] === 'prepare' && item[1] === '2'));

  for (const [options, stoppedAfter] of [
    [{staleAfterState: true}, 'state'], [{staleAfterContent: true}, 'content']
  ]) {
    h = harness(options); await h.controller.restore();
    const index = h.calls.findIndex(item => item[0] === stoppedAfter);
    assert.equal(h.calls.slice(index + 1).some(item => ['show','prepare'].includes(item[0])), false, `stale after ${stoppedAfter} does not update view`);
  }

  for (const [key, error] of [['stateError', new Error('state failed')], ['contentError', new Error('content failed')], ['prepareError', new Error('prepare failed')]]) {
    h = harness({[key]: error}); await h.controller.restore();
    assert.ok(h.calls.some(item => item[0] === 'show' && item[1] === 'index' && item[2] === 'replace'));
    assert.ok(h.calls.some(item => item[0] === 'error' && item[1] === 'content' && item[2] === `콘텐츠를 불러오지 못했습니다: ${error.message}`));
  }

  console.log('Session bootstrap controller tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
