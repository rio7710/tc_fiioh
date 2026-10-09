(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ThinkCastAuthUIController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const requiredIds = [
    'loginForm', 'loginActions', 'loginUsername', 'loginPassword', 'loginMessage',
    'registerForm', 'registerActions', 'registerOpen', 'registerBack',
    'registerUsername', 'registerPassword', 'registerPasswordConfirm', 'registerMessage',
    'loggedInPanel', 'loggedInActions', 'loggedInUsername', 'loggedInProject', 'logoutButton'
  ];

  function create(dependencies) {
    const deps = dependencies || {};
    for (const name of [
      'getRoot', 'request', 'setDemoState', 'refreshProjectIndex', 'showStep',
      'setActiveProjectId', 'setKeywordStageLocked'
    ]) if (typeof deps[name] !== 'function') throw new TypeError(`ThinkCastAuthUIController requires ${name}`);

    let loggedIn = false;
    let activeAccount = null;
    let mountedRoot = null;
    let elements = null;

    function resolveRoot(root) {
      const value = root || deps.getRoot();
      if (!value || typeof value.querySelector !== 'function' || !value.body) {
        throw new TypeError('ThinkCastAuthUIController requires a DOM root');
      }
      return value;
    }

    function collect(root) {
      const found = {};
      for (const id of requiredIds) {
        found[id] = root.querySelector(`#${id}`);
        if (!found[id]) throw new Error(`ThinkCastAuthUIController missing #${id}`);
      }
      return found;
    }

    function currentElements() {
      const root = resolveRoot(mountedRoot);
      return mountedRoot ? elements : collect(root);
    }

    function setAccess(enabled, account) {
      const root = resolveRoot(mountedRoot);
      const nodes = mountedRoot ? elements : collect(root);
      loggedIn = enabled;
      activeAccount = enabled ? (account === undefined ? null : account) : null;
      root.body.classList.toggle('is-logged-in', enabled);
      const toolbar = root.querySelector('.global-api-toolbar');
      const nav = root.querySelector('thinkcast-top-nav');
      if (toolbar) toolbar.inert = !enabled;
      if (nav) {
        nav.inert = !enabled;
        nav.setLoggedIn(enabled);
      }
      nodes.loginForm.hidden = enabled;
      nodes.loginActions.hidden = enabled;
      nodes.registerForm.hidden = true;
      nodes.registerActions.hidden = true;
      nodes.loggedInPanel.hidden = !enabled;
      nodes.loggedInActions.hidden = !enabled;
      if (enabled) {
        nodes.loggedInUsername.textContent = account?.user?.username || account?.user?.name || '';
        nodes.loggedInProject.textContent = account?.project?.name ? `연결 프로젝트 · ${account.project.name}` : '연결 프로젝트 준비됨';
      }
    }

    function setMode(mode) {
      if (loggedIn) return;
      const nodes = currentElements();
      const registering = mode === 'register';
      nodes.loginForm.hidden = registering;
      nodes.loginActions.hidden = registering;
      nodes.registerForm.hidden = !registering;
      nodes.registerActions.hidden = !registering;
      (registering ? nodes.registerUsername : nodes.loginUsername).focus();
    }

    async function login() {
      const nodes = currentElements();
      nodes.loginMessage.textContent = '';
      try {
        const result = await deps.request('/api/login', {
          method: 'POST',
          body: JSON.stringify({username: nodes.loginUsername.value, password: nodes.loginPassword.value})
        });
        nodes.loginPassword.value = '';
        deps.setDemoState(result.state);
        setAccess(true, result.state);
        await deps.refreshProjectIndex();
        deps.showStep('index');
      } catch (error) {
        nodes.loginMessage.textContent = error.message;
      }
    }

    async function register() {
      const nodes = currentElements();
      const username = nodes.registerUsername.value.trim();
      const password = nodes.registerPassword.value;
      const passwordConfirm = nodes.registerPasswordConfirm.value;
      nodes.registerMessage.textContent = '';
      if (password !== passwordConfirm) {
        nodes.registerMessage.textContent = '비밀번호 확인이 일치하지 않습니다.';
        return;
      }
      try {
        const result = await deps.request('/api/register', {
          method: 'POST',
          body: JSON.stringify({username, password, password_confirm: passwordConfirm})
        });
        nodes.registerPassword.value = '';
        nodes.registerPasswordConfirm.value = '';
        deps.setDemoState(result.state);
        setAccess(true, result.state);
        await deps.refreshProjectIndex();
        deps.showStep('index');
      } catch (error) {
        nodes.registerMessage.textContent = error.message;
      }
    }

    async function logout() {
      await deps.request('/api/logout', {method: 'POST', body: '{}'});
      deps.setActiveProjectId(null);
      deps.setKeywordStageLocked(false);
      setAccess(false);
      setMode('login');
      deps.showStep(1);
    }

    const listeners = {
      registerOpen: () => setMode('register'),
      registerBack: () => setMode('login'),
      loginForm: event => { event.preventDefault(); return login(); },
      registerForm: event => { event.preventDefault(); return register(); },
      logoutButton: () => logout()
    };

    function mount(root) {
      const nextRoot = resolveRoot(root);
      if (mountedRoot === nextRoot) return true;
      if (mountedRoot) unmount();
      const nextElements = collect(nextRoot);
      nextElements.registerOpen.addEventListener('click', listeners.registerOpen);
      nextElements.registerBack.addEventListener('click', listeners.registerBack);
      nextElements.loginForm.addEventListener('submit', listeners.loginForm);
      nextElements.registerForm.addEventListener('submit', listeners.registerForm);
      nextElements.logoutButton.addEventListener('click', listeners.logoutButton);
      mountedRoot = nextRoot;
      elements = nextElements;
      return true;
    }

    function unmount() {
      if (!mountedRoot) return;
      elements.registerOpen.removeEventListener('click', listeners.registerOpen);
      elements.registerBack.removeEventListener('click', listeners.registerBack);
      elements.loginForm.removeEventListener('submit', listeners.loginForm);
      elements.registerForm.removeEventListener('submit', listeners.registerForm);
      elements.logoutButton.removeEventListener('click', listeners.logoutButton);
      mountedRoot = null;
      elements = null;
    }

    return Object.freeze({
      mount, unmount, setAccess, setMode, login, register, logout,
      isLoggedIn: () => loggedIn,
      getActiveAccount: () => activeAccount
    });
  }

  return Object.freeze({create});
});
