(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ThinkCastPromptLabController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ids = ['promptLabModal', 'promptLabForm', 'promptLabKey', 'promptLabStreaming', 'promptLabInput',
    'promptLabOutput', 'promptLabMeta', 'promptLabImage', 'promptLabOpen', 'promptLabClose', 'promptLabRun'];

  function create(dependencies) {
    const deps = dependencies || {};
    for (const name of ['getRoot', 'request', 'fetch', 'createTextDecoder', 'createEmptyBytes']) {
      if (typeof deps[name] !== 'function') throw new TypeError(`ThinkCastPromptLabController requires ${name}`);
    }
    let mountedRoot = null;
    let elements = null;
    let modeInputs = null;

    function resolveRoot(root) {
      const value = root || deps.getRoot();
      if (!value || typeof value.querySelector !== 'function' || !value.body || typeof value.createElement !== 'function') {
        throw new TypeError('ThinkCastPromptLabController requires a DOM root');
      }
      return value;
    }

    function collect(root) {
      const found = {};
      for (const id of ids) {
        found[id] = root.querySelector(`#${id}`);
        if (!found[id]) throw new Error(`ThinkCastPromptLabController missing #${id}`);
      }
      const inputs = found.promptLabForm.elements?.promptLabMode;
      if (!inputs || typeof inputs.forEach !== 'function') throw new Error('ThinkCastPromptLabController missing promptLabMode inputs');
      return {found, inputs};
    }

    function current() {
      if (elements) return {root: mountedRoot, elements};
      const root = resolveRoot();
      return {root, elements: collect(root).found};
    }

    function mode() {
      return current().elements.promptLabForm.elements.promptLabMode.value;
    }

    function syncMode() {
      const {elements: el} = current();
      const imageMode = mode() === 'image';
      el.promptLabStreaming.closest('label').hidden = imageMode;
      el.promptLabOutput.hidden = imageMode;
      el.promptLabImage.hidden = !imageMode;
      el.promptLabInput.placeholder = imageMode
        ? '예: 따뜻한 오후 햇살이 드는 요양원 정원, 어르신과 직원이 함께 걷는 자연스러운 사진, 16:9'
        : '예: 생각담 서비스의 요양원 홍보 영상용 제목 3개를 JSON으로 작성해 주세요.';
    }

    function open() {
      const {root, elements: el} = current();
      el.promptLabModal.hidden = false;
      root.body.classList.add('modal-open');
      el.promptLabInput.focus();
    }

    function close() {
      const {root, elements: el} = current();
      el.promptLabModal.hidden = true;
      root.body.classList.remove('modal-open');
      el.promptLabForm.reset();
      el.promptLabOutput.textContent = '아직 실행하지 않았습니다.';
      el.promptLabImage.innerHTML = '<span class="prompt-lab-image-empty">생성된 이미지가 여기에 표시됩니다.</span>';
      el.promptLabMeta.textContent = 'Google Gemini API 연결 후 테스트할 수 있습니다.';
      syncMode();
    }

    async function run() {
      const {root, elements: el} = current();
      const prompt = el.promptLabInput.value.trim();
      const apiKey = el.promptLabKey.value.trim();
      if (!prompt) {
        el.promptLabMeta.textContent = '테스트할 프롬프트를 입력해 주세요.';
        el.promptLabInput.focus();
        return;
      }
      el.promptLabRun.disabled = true;
      el.promptLabOutput.textContent = 'Gemini 응답을 기다리고 있습니다…';
      el.promptLabMeta.textContent = '프로젝트와 격리된 테스트 요청을 전송했습니다.';
      try {
        if (mode() === 'image') {
          el.promptLabImage.innerHTML = '<span class="prompt-lab-image-empty">Gemini가 이미지를 생성하고 있습니다…</span>';
          const result = await deps.request('/api/prompt-harness/image', {method: 'POST', body: JSON.stringify({prompt, api_key: apiKey})});
          const generated = root.createElement('img');
          generated.src = result.image_data_url;
          generated.alt = prompt;
          el.promptLabImage.replaceChildren(generated);
          const usage = result.trace?.usage || {};
          el.promptLabMeta.textContent = `이미지 생성 · 모델 ${result.trace?.model || '-'} · 입력 ${usage.promptTokenCount ?? '-'} tokens · ${result.trace?.latency_ms ?? '-'}ms · 프로젝트 미반영`;
        } else if (el.promptLabStreaming.checked) {
          const response = await deps.fetch('/api/prompt-harness/stream', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({prompt, api_key: apiKey})});
          if (!response.ok) {
            const failed = await response.json();
            throw new Error(failed.error || '스트리밍 요청을 처리하지 못했습니다.');
          }
          el.promptLabOutput.textContent = '';
          let buffer = '';
          const reader = response.body.getReader();
          const decoder = deps.createTextDecoder();
          while (true) {
            const {value, done} = await reader.read();
            buffer += decoder.decode(value || deps.createEmptyBytes(), {stream: !done});
            const events = buffer.split('\n\n');
            buffer = events.pop() || '';
            for (const raw of events) {
              const line = raw.split('\n').find(item => item.startsWith('data: '));
              if (!line) continue;
              const item = JSON.parse(line.slice(6));
              if (item.type === 'chunk') {
                el.promptLabOutput.textContent += item.text;
                el.promptLabOutput.scrollTop = el.promptLabOutput.scrollHeight;
              }
              if (item.type === 'done') {
                const usage = item.usage || {};
                el.promptLabMeta.textContent = `스트리밍 · 모델 ${item.model || '-'} · 입력 ${usage.promptTokenCount ?? '-'} tokens · 출력 ${usage.candidatesTokenCount ?? '-'} tokens · ${item.latency_ms ?? '-'}ms · 프로젝트 미반영`;
              }
              if (item.type === 'error') throw new Error(item.error || '스트리밍이 중단됐습니다.');
            }
            if (done) break;
          }
        } else {
          const result = await deps.request('/api/prompt-harness/test', {method: 'POST', body: JSON.stringify({prompt, api_key: apiKey})});
          el.promptLabOutput.textContent = result.output;
          const usage = result.trace?.usage || {};
          el.promptLabMeta.textContent = `일괄 응답 · 모델 ${result.trace?.model || '-'} · 입력 ${usage.promptTokenCount ?? '-'} tokens · 출력 ${usage.candidatesTokenCount ?? '-'} tokens · ${result.trace?.latency_ms ?? '-'}ms · 프로젝트 미반영`;
        }
      } catch (error) {
        el.promptLabOutput.textContent = '출력 없음';
        if (mode() === 'image') el.promptLabImage.innerHTML = '<span class="prompt-lab-image-empty">이미지가 생성되지 않았습니다.</span>';
        el.promptLabMeta.textContent = error.message;
      } finally {
        el.promptLabKey.value = '';
        el.promptLabRun.disabled = false;
      }
    }

    const listeners = {
      mode: () => syncMode(),
      open: () => open(),
      close: () => close(),
      backdrop: event => { if (event.target === elements.promptLabModal) close(); },
      submit: event => { event.preventDefault(); return run(); }
    };

    function mount(root) {
      const nextRoot = resolveRoot(root);
      if (mountedRoot === nextRoot) return true;
      if (mountedRoot) unmount();
      const collected = collect(nextRoot);
      collected.inputs.forEach(input => input.addEventListener('change', listeners.mode));
      collected.found.promptLabOpen.addEventListener('click', listeners.open);
      collected.found.promptLabClose.addEventListener('click', listeners.close);
      collected.found.promptLabModal.addEventListener('pointerdown', listeners.backdrop);
      collected.found.promptLabForm.addEventListener('submit', listeners.submit);
      mountedRoot = nextRoot;
      elements = collected.found;
      modeInputs = collected.inputs;
      return true;
    }

    function unmount() {
      if (!mountedRoot) return;
      modeInputs.forEach(input => input.removeEventListener('change', listeners.mode));
      elements.promptLabOpen.removeEventListener('click', listeners.open);
      elements.promptLabClose.removeEventListener('click', listeners.close);
      elements.promptLabModal.removeEventListener('pointerdown', listeners.backdrop);
      elements.promptLabForm.removeEventListener('submit', listeners.submit);
      mountedRoot = null;
      elements = null;
      modeInputs = null;
    }

    return Object.freeze({mount, unmount, open, close, syncMode, run, mode});
  }

  return Object.freeze({create});
});
