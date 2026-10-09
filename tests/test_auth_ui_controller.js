const assert = require('node:assert/strict');
const AuthUI = require('../01_app/assets/core/auth-ui-controller.js');

(async () => {
  const ids = [
    'loginForm', 'loginActions', 'loginUsername', 'loginPassword', 'loginMessage',
    'registerForm', 'registerActions', 'registerOpen', 'registerBack',
    'registerUsername', 'registerPassword', 'registerPasswordConfirm', 'registerMessage',
    'loggedInPanel', 'loggedInActions', 'loggedInUsername', 'loggedInProject', 'logoutButton'
  ];

  function element() {
    const listeners = new Map();
    return {
      hidden: false, inert: false, value: '', textContent: '', focused: 0,
      addEventListener(type, listener) { const list = listeners.get(type) || []; list.push(listener); listeners.set(type, list); },
      removeEventListener(type, listener) { listeners.set(type, (listeners.get(type) || []).filter(item => item !== listener)); },
      dispatch(type) { const event = {prevented: false, preventDefault() { this.prevented = true; }}; const results = (listeners.get(type) || []).map(listener => listener(event)); return {event, results}; },
      listenerCount(type) { return (listeners.get(type) || []).length; },
      focus() { this.focused += 1; }
    };
  }

  function harness(overrides = {}) {
    const nodes = Object.fromEntries(ids.map(id => [id, element()]));
    const toolbar = element();
    const nav = {...element(), loginStates: [], setLoggedIn(value) { this.loginStates.push(value); }};
    const classes = new Set();
    const root = {
      body: {classList: {toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }}},
      querySelector(selector) {
        if (selector === '.global-api-toolbar') return overrides.noToolbar ? null : toolbar;
        if (selector === 'thinkcast-top-nav') return overrides.noNav ? null : nav;
        return nodes[selector.slice(1)] || null;
      }
    };
    const calls = [];
    const responses = overrides.responses || {};
    const deps = {
      getRoot: () => root,
      request: async (...args) => { calls.push(['request', ...args]); const response = responses[args[0]]; if (response instanceof Error) throw response; return response || {state: {user: {name: 'tester'}}}; },
      setDemoState: state => calls.push(['state', state]),
      refreshProjectIndex: async () => { calls.push(['refresh']); if (overrides.refreshError) throw overrides.refreshError; },
      showStep: step => calls.push(['show', step]),
      setActiveProjectId: id => calls.push(['project', id]),
      setKeywordStageLocked: value => calls.push(['locked', value])
    };
    return {controller: AuthUI.create(deps), root, nodes, toolbar, nav, classes, calls};
  }

  assert.throws(() => AuthUI.create(), /requires getRoot/);
  assert.throws(() => AuthUI.create({getRoot() {}}), /requires request/);
  let h = harness();
  assert.equal(Object.isFrozen(h.controller), true);
  assert.equal(h.controller.isLoggedIn(), false);
  assert.equal(h.controller.getActiveAccount(), null);

  h.controller.mount(h.root);
  assert.equal(h.controller.mount(h.root), true);
  for (const [id, type] of [['registerOpen','click'],['registerBack','click'],['loginForm','submit'],['registerForm','submit'],['logoutButton','click']]) {
    assert.equal(h.nodes[id].listenerCount(type), 1, `${id} binds once`);
  }

  const account = {user: {username: 'alpha'}, project: {name: '봄 콘텐츠'}};
  assert.equal(h.controller.setAccess(true, account), undefined);
  assert.equal(h.controller.isLoggedIn(), true);
  assert.equal(h.controller.getActiveAccount(), account);
  assert.equal(h.classes.has('is-logged-in'), true);
  assert.equal(h.toolbar.inert, false);
  assert.deepEqual(h.nav.loginStates, [true]);
  assert.deepEqual([h.nodes.loginForm.hidden, h.nodes.loginActions.hidden, h.nodes.registerForm.hidden, h.nodes.registerActions.hidden], [true, true, true, true]);
  assert.deepEqual([h.nodes.loggedInPanel.hidden, h.nodes.loggedInActions.hidden], [false, false]);
  assert.equal(h.nodes.loggedInUsername.textContent, 'alpha');
  assert.equal(h.nodes.loggedInProject.textContent, '연결 프로젝트 · 봄 콘텐츠');
  assert.equal(h.controller.setMode('register'), undefined);
  assert.equal(h.nodes.registerUsername.focused, 0, 'logged-in mode change is ignored');

  h.controller.setAccess(false);
  assert.equal(h.controller.getActiveAccount(), null);
  assert.equal(h.toolbar.inert, true);
  assert.equal(h.nodes.loginForm.hidden, false);
  h.nodes.loginMessage.textContent = 'keep'; h.nodes.loginPassword.value = 'keep-password';
  h.controller.setMode('register');
  assert.deepEqual([h.nodes.loginForm.hidden, h.nodes.loginActions.hidden, h.nodes.registerForm.hidden, h.nodes.registerActions.hidden], [true, true, false, false]);
  assert.equal(h.nodes.registerUsername.focused, 1);
  assert.equal(h.nodes.loginMessage.textContent, 'keep');
  assert.equal(h.nodes.loginPassword.value, 'keep-password');
  h.controller.setMode('anything');
  assert.equal(h.nodes.loginUsername.focused, 1);

  h = harness({responses: {'/api/login': {state: {user: {name: 'login-user'}}}}});
  h.controller.mount(h.root);
  h.nodes.loginUsername.value = ' raw-user ';
  h.nodes.loginPassword.value = 'secret';
  h.nodes.loginMessage.textContent = 'old';
  assert.equal(await h.controller.login(), undefined);
  assert.deepEqual(h.calls.map(call => call[0]), ['request','state','refresh','show']);
  assert.deepEqual(h.calls[0], ['request','/api/login',{method:'POST',body:JSON.stringify({username:' raw-user ',password:'secret'})}]);
  assert.equal(h.nodes.loginPassword.value, '');
  assert.equal(h.nodes.loginMessage.textContent, '');
  assert.equal(h.controller.isLoggedIn(), true);

  h = harness({responses: {'/api/login': new Error('bad login')}});
  h.nodes.loginPassword.value = 'secret';
  await h.controller.login();
  assert.equal(h.nodes.loginMessage.textContent, 'bad login');
  assert.equal(h.nodes.loginPassword.value, 'secret');
  assert.equal(h.calls.some(call => call[0] === 'state'), false);

  h = harness({responses: {'/api/login': {state: {user: {name: 'partial'}}}}, refreshError: new Error('refresh failed')});
  h.nodes.loginPassword.value = 'secret';
  await h.controller.login();
  assert.equal(h.controller.isLoggedIn(), true);
  assert.equal(h.nodes.loginPassword.value, '');
  assert.equal(h.nodes.loginMessage.textContent, 'refresh failed');
  assert.equal(h.calls.some(call => call[0] === 'show'), false);

  h = harness();
  h.nodes.registerUsername.value = '  new-user  ';
  h.nodes.registerPassword.value = 'one'; h.nodes.registerPasswordConfirm.value = 'two';
  await h.controller.register();
  assert.equal(h.nodes.registerMessage.textContent, '비밀번호 확인이 일치하지 않습니다.');
  assert.equal(h.calls.length, 0);
  assert.equal(h.nodes.registerPassword.value, 'one');

  h = harness({responses: {'/api/register': {state: {user: {name: 'new-user'}}}}});
  h.nodes.registerUsername.value = '  new-user  ';
  h.nodes.registerPassword.value = 'password'; h.nodes.registerPasswordConfirm.value = 'password';
  assert.equal(await h.controller.register(), undefined);
  assert.deepEqual(h.calls[0], ['request','/api/register',{method:'POST',body:JSON.stringify({username:'new-user',password:'password',password_confirm:'password'})}]);
  assert.deepEqual(h.calls.map(call => call[0]), ['request','state','refresh','show']);
  assert.equal(h.nodes.registerPassword.value, '');
  assert.equal(h.nodes.registerPasswordConfirm.value, '');

  h = harness({responses: {'/api/register': {state: {user: {name: 'partial-register'}}}}, refreshError: new Error('register refresh failed')});
  h.nodes.registerPassword.value = 'password'; h.nodes.registerPasswordConfirm.value = 'password';
  await h.controller.register();
  assert.equal(h.controller.isLoggedIn(), true);
  assert.equal(h.nodes.registerPassword.value, '');
  assert.equal(h.nodes.registerPasswordConfirm.value, '');
  assert.equal(h.nodes.registerMessage.textContent, 'register refresh failed');
  assert.equal(h.calls.some(call => call[0] === 'show'), false);

  h = harness({responses: {'/api/register': new Error('register failed')}});
  h.nodes.registerPassword.value = 'password'; h.nodes.registerPasswordConfirm.value = 'password';
  await h.controller.register();
  assert.equal(h.nodes.registerMessage.textContent, 'register failed');
  assert.equal(h.nodes.registerPassword.value, 'password');

  h = harness({responses: {'/api/logout': {ok: true}}});
  h.controller.setAccess(true, {user: {name: 'user'}});
  assert.equal(await h.controller.logout(), undefined);
  assert.deepEqual(h.calls, [
    ['request','/api/logout',{method:'POST',body:'{}'}], ['project',null], ['locked',false], ['show',1]
  ]);
  assert.equal(h.controller.isLoggedIn(), false);
  assert.equal(h.nodes.loginUsername.focused, 1);

  h = harness({responses: {'/api/logout': new Error('logout failed')}});
  h.controller.setAccess(true, {user: {name: 'user'}});
  await assert.rejects(h.controller.logout(), /logout failed/);
  assert.equal(h.controller.isLoggedIn(), true);
  assert.equal(h.calls.length, 1, 'failed logout does not mutate project or UI state');

  h = harness();
  h.controller.mount(h.root);
  h.controller.unmount();
  for (const [id, type] of [['registerOpen','click'],['registerBack','click'],['loginForm','submit'],['registerForm','submit'],['logoutButton','click']]) assert.equal(h.nodes[id].listenerCount(type), 0);
  assert.equal(h.controller.unmount(), undefined);
  h.controller.mount(h.root);
  assert.equal(h.nodes.registerOpen.listenerCount('click'), 1);
  const dispatched = h.nodes.registerOpen.dispatch('click');
  assert.equal(h.nodes.registerUsername.focused, 1);
  const submitted = h.nodes.loginForm.dispatch('submit');
  assert.equal(submitted.event.prevented, true);
  await Promise.all(submitted.results);

  const broken = harness();
  delete broken.nodes.loginForm;
  assert.throws(() => broken.controller.mount(broken.root), /missing #loginForm/);
  broken.nodes.loginForm = element();
  assert.equal(broken.controller.mount(broken.root), true, 'failed mount can retry');

  console.log('Auth UI controller tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
