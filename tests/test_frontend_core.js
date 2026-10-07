const assert = require('node:assert/strict');
const {createApiClient, isTransientStatus} = require('../01_app/assets/core/api-client.js');
const routes = require('../01_app/assets/core/content-route.js');

function response(status, text) {
  return {status, ok: status >= 200 && status < 300, text: async () => text};
}

(async () => {
  const calls = [];
  const api = createApiClient({fetchImpl: async (path, options) => {
    calls.push({path, options});
    return response(200, '{"ok":true}');
  }});
  assert.deepEqual(await api('/api/demo'), {ok: true});
  assert.equal(calls[0].options.credentials, 'same-origin', 'cookie authentication is retained');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  await api('/api/demo', {credentials: 'include', headers: {'X-Trace': 'yes'}});
  assert.equal(calls[1].options.credentials, 'include');
  assert.equal(calls[1].options.headers['X-Trace'], 'yes');

  const cases = [
    [response(200, ''), '서버 응답이 비어 있습니다.', 200, true],
    [response(200, '<html>'), '서버 응답을 읽지 못했습니다.', 200, false],
    [response(401, '{"error":"로그인이 필요합니다."}'), '로그인이 필요합니다.', 401, false],
    [response(429, '{}'), '요청을 처리하지 못했습니다.', 429, true],
    [response(503, '<html>'), '서버가 준비 중입니다.', 503, true]
  ];
  for (const [serverResponse, message, status, transient] of cases) {
    const failing = createApiClient({fetchImpl: async () => serverResponse});
    await assert.rejects(failing('/api/test'), error => {
      assert.match(error.message, new RegExp(message));
      assert.equal(error.status, status);
      assert.equal(error.transient, transient);
      return true;
    });
  }
  const networkError = new Error('offline');
  await assert.rejects(createApiClient({fetchImpl: async () => { throw networkError; }})('/api/test'), error => error.transient === true);
  assert.equal(isTransientStatus(408), true);
  assert.equal(isTransientStatus(400), false);

  assert.deepEqual(routes.readContentRoute('https://tc.test/app.html?project_id=A#step3-1'), {
    step: '3-1', projectId: 'A', explicitProject: true
  });
  assert.deepEqual(routes.readContentRoute('https://tc.test/app.html#step4'), {
    step: '4', projectId: null, explicitProject: false
  }, 'legacy project-less URLs remain readable');
  assert.equal(routes.readContentRoute('https://tc.test/app.html#unknown').step, 'index');
  assert.equal(routes.buildContentRoute('https://tc.test/app.html?keep=1#step2', 'project', 'B').href,
    'https://tc.test/app.html?keep=1&project_id=B#project');
  assert.equal(routes.buildContentRoute('https://tc.test/app.html?project_id=A#step2', 'index', null).href,
    'https://tc.test/app.html#index');

  let href = 'https://tc.test/app.html?project_id=A#step3';
  const writes = [];
  const location = {};
  Object.defineProperty(location, 'href', {get: () => href});
  const history = {
    pushState(_state, _title, next) { writes.push(['push', next]); href = next; },
    replaceState(_state, _title, next) { writes.push(['replace', next]); href = next; }
  };
  assert.equal(routes.writeContentRoute({location, history, step: '4', projectId: 'A'}), true);
  assert.deepEqual(writes[0], ['push', 'https://tc.test/app.html?project_id=A#step4']);
  assert.equal(routes.writeContentRoute({location, history, step: '4', projectId: 'A'}), false, 'same route does not duplicate history');
  routes.writeContentRoute({location, history, step: 'project', projectId: 'B', mode: 'replace'});
  assert.equal(writes[1][0], 'replace');

  const listeners = {};
  const fakeWindow = {
    addEventListener(name, fn) { listeners[name] = fn; },
    removeEventListener(name, fn) { if (listeners[name] === fn) delete listeners[name]; }
  };
  const restored = [];
  const subscription = routes.listenContentRoutes(route => restored.push(route), {window: fakeWindow, location});
  await listeners.popstate();
  await listeners.hashchange();
  assert.equal(restored.length, 1, 'paired browser events restore a URL once');
  href = 'https://tc.test/app.html?project_id=A#step2';
  await listeners.popstate();
  assert.equal(restored[1].step, '2');
  assert.equal(restored[1].projectId, 'A', 'back/forward keeps route identity');
  subscription.dispose();
  assert.deepEqual(listeners, {});

  console.log('Frontend core API and route helper tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
