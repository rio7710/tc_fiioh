(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ThinkCastProviderSettingsController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const requiredIds = [
    'globalApiSettings', 'apiSettingsModal', 'apiSettingsForm', 'apiSettingsClose',
    'apiSettingsTitle', 'apiSettingsDescription', 'apiSettingsProviders',
    'apiSettingsMessage', 'apiSettingsSave'
  ];
  const stepCopy = Object.freeze({
    0: Object.freeze(['전역 API 연결', '공급자 인증을 한 곳에서 관리합니다. 각 STEP은 여기서 연결된 API를 필요한 작업에 가져갑니다.']),
    1: Object.freeze(['로그인 및 프로젝트', '외부 API 호출 없이 프로젝트 담당자 정보를 확인합니다.']),
    2: Object.freeze(['키워드 · 스토리보드', 'OpenAI 또는 Anthropic 중 하나의 텍스트 API 연결이 필요합니다.']),
    3: Object.freeze(['대본 · 이미지 제작', 'Gemini(Nano Banana) 또는 OpenAI 이미지 연결이 필요합니다.']),
    4: Object.freeze(['영상 디자인 · 출력', 'BytePlus Seedance 또는 Kling 중 하나의 영상 API 연결이 필요합니다.']),
    5: Object.freeze(['콘텐츠 캘린더', '플랫폼 게시 연결은 OAuth 워커 도입 시 이 화면에서 관리합니다. 현재 캘린더·ICS에는 키가 필요하지 않습니다.'])
  });

  function create(dependencies) {
    const deps = dependencies || {};
    for (const name of ['getRoot', 'request', 'escapeHtml', 'setTimeout']) {
      if (typeof deps[name] !== 'function') throw new TypeError(`ThinkCastProviderSettingsController requires ${name}`);
    }

    let config = null;
    let activeStep = 1;
    let mountedRoot = null;
    let elements = null;

    function resolveRoot(root) {
      const value = root || mountedRoot || deps.getRoot();
      if (!value || typeof value.querySelector !== 'function' || !value.body) {
        throw new TypeError('ThinkCastProviderSettingsController requires a DOM root');
      }
      return value;
    }

    function collect(root) {
      const found = {};
      for (const id of requiredIds) {
        found[id] = root.querySelector(`#${id}`);
        if (!found[id]) throw new Error(`ThinkCastProviderSettingsController missing #${id}`);
      }
      return found;
    }

    function currentElements() {
      const root = resolveRoot();
      return {root, nodes: mountedRoot ? elements : collect(root)};
    }

    async function refresh() {
      const next = await deps.request('/api/provider-settings');
      config = next;
      const {nodes} = currentElements();
      const providerIds = Object.keys(config.providers);
      const connected = providerIds.filter(id => config.statuses[id]?.configured).length;
      const ready = ['2', '3', '4'].every(step =>
        (config.steps[step] || []).some(id => config.statuses[id]?.configured)
      );
      nodes.globalApiSettings.classList.toggle('ready', ready);
      nodes.globalApiSettings.classList.toggle('needs-config', !ready);
      nodes.globalApiSettings.textContent = `API 연결 설정 · ${connected}/${providerIds.length}`;
      nodes.globalApiSettings.title = `전역 공급자 ${providerIds.length}개 중 ${connected}개 연결됨`;
      return config;
    }

    function close() {
      const {root, nodes} = currentElements();
      nodes.apiSettingsModal.hidden = true;
      root.body.classList.remove('modal-open');
      nodes.apiSettingsForm.reset();
    }

    async function open(step) {
      activeStep = Number(step) || 1;
      const {root, nodes} = currentElements();
      const message = nodes.apiSettingsMessage;
      message.textContent = '';
      message.classList.remove('success');
      try {
        await refresh();
      } catch (error) {
        message.textContent = error.message;
        config = null;
      }
      const copy = stepCopy[activeStep];
      nodes.apiSettingsTitle.textContent = `STEP ${String(activeStep).padStart(2, '0')} · ${copy[0]}`;
      nodes.apiSettingsDescription.textContent = copy[1];
      const providerIds = config ? Object.keys(config.providers) : [];
      const requiredIds = new Set(config?.steps[String(activeStep)] || []);
      if (!providerIds.length) {
        nodes.apiSettingsProviders.innerHTML = `<div class="api-provider"><div class="api-provider-head"><strong>별도 API 키 없음</strong><span class="api-provider-status connected">준비됨</span></div><p class="api-provider-guide">${deps.escapeHtml(copy[1])}</p></div>`;
      } else {
        nodes.apiSettingsProviders.innerHTML = providerIds.map(id => {
          const provider = config.providers[id];
          const status = config.statuses[id];
          const fields = provider.fields.map(field => `<label class="api-provider-field">${deps.escapeHtml(field.label)} · <code>${deps.escapeHtml(field.env)}</code><input type="${field.secret ? 'password' : 'text'}" autocomplete="new-password" data-provider="${id}" data-field="${field.id}" placeholder="${status.configured ? '연결됨 · 변경할 때만 새 값 입력' : '서버로만 전송됩니다'}" ${config.hosted ? 'disabled' : ''}></label>`).join('');
          const usedBy = Object.entries(config.steps).filter(([, ids]) => ids.includes(id)).map(([usedStep]) => `STEP ${String(usedStep).padStart(2, '0')}`).join(' · ');
          return `<section class="api-provider${activeStep && requiredIds.has(id) ? ' required-now' : ''}" data-provider-card="${id}"><div class="api-provider-head"><strong>${deps.escapeHtml(provider.label)}</strong><span class="api-provider-status ${status.configured ? 'connected' : ''}">${status.configured ? `연결됨 · ${status.source === 'environment' ? '환경변수' : '현재 세션'}` : '연결 필요'}</span></div><p class="api-provider-guide">사용 단계 · ${deps.escapeHtml(usedBy || '선택 연결')}</p><div class="api-provider-fields">${fields}</div><p class="api-provider-guide"><a href="${provider.docs}" target="_blank" rel="noopener">공식 API 키·인증 가이드 열기 ↗</a></p></section>`;
        }).join('');
      }
      nodes.apiSettingsSave.hidden = !providerIds.length || Boolean(config?.hosted);
      if (config?.hosted) message.textContent = '공개 사이트에서는 키 노출 방지를 위해 입력이 잠겨 있습니다. Render Dashboard → Environment에 표시된 환경변수 이름으로 등록한 뒤 재배포하세요.';
      nodes.apiSettingsModal.hidden = false;
      root.body.classList.add('modal-open');
    }

    async function ensureStepReady(step) {
      const current = await refresh();
      const providers = current.steps[String(step)] || [];
      if (!providers.length || providers.some(provider => current.statuses[provider]?.configured)) return true;
      await open(step);
      return false;
    }

    async function save() {
      const {root, nodes} = currentElements();
      const message = nodes.apiSettingsMessage;
      const saveButton = nodes.apiSettingsSave;
      message.textContent = '';
      message.classList.remove('success');
      saveButton.disabled = true;
      try {
        const cards = [...root.querySelectorAll('[data-provider-card]')];
        let attempted = 0;
        let latest = '';
        for (const card of cards) {
          const provider = card.dataset.providerCard;
          const inputs = [...card.querySelectorAll('[data-field]')];
          if (!inputs.some(input => input.value.trim())) continue;
          if (inputs.some(input => !input.value.trim())) throw new Error(`${card.querySelector('strong').textContent}: 필수 인증값을 모두 입력해 주세요.`);
          const credentials = Object.fromEntries(inputs.map(input => [input.dataset.field, input.value.trim()]));
          const result = await deps.request('/api/provider-settings', {method: 'POST', body: JSON.stringify({provider, credentials})});
          inputs.forEach(input => { input.value = ''; });
          attempted += 1;
          latest = result.message;
        }
        if (!attempted) throw new Error('연결할 공급자의 인증값을 입력해 주세요. 이미 연결됐다면 닫기를 눌러 진행하세요.');
        await refresh();
        message.textContent = latest;
        message.classList.add('success');
        deps.setTimeout(() => open(activeStep), 700);
      } catch (error) {
        message.textContent = error.message;
      } finally {
        saveButton.disabled = false;
      }
    }

    const listeners = {
      globalApiSettings: () => open(0),
      apiSettingsClose: () => close(),
      apiSettingsModal: event => { if (event.target === event.currentTarget) close(); },
      apiSettingsForm: event => { event.preventDefault(); return save(); }
    };

    function mount(root) {
      const value = resolveRoot(root);
      if (mountedRoot) return true;
      const found = collect(value);
      found.globalApiSettings.addEventListener('click', listeners.globalApiSettings);
      found.apiSettingsClose.addEventListener('click', listeners.apiSettingsClose);
      found.apiSettingsModal.addEventListener('pointerdown', listeners.apiSettingsModal);
      found.apiSettingsForm.addEventListener('submit', listeners.apiSettingsForm);
      mountedRoot = value;
      elements = found;
      return true;
    }

    function unmount() {
      if (!mountedRoot) return;
      elements.globalApiSettings.removeEventListener('click', listeners.globalApiSettings);
      elements.apiSettingsClose.removeEventListener('click', listeners.apiSettingsClose);
      elements.apiSettingsModal.removeEventListener('pointerdown', listeners.apiSettingsModal);
      elements.apiSettingsForm.removeEventListener('submit', listeners.apiSettingsForm);
      mountedRoot = null;
      elements = null;
    }

    return Object.freeze({mount, unmount, refresh, open, close, ensureStepReady, save, getConfig: () => config, getActiveStep: () => activeStep});
  }

  return Object.freeze({create});
});
