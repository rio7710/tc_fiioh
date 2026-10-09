(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Step02TrendKeywordController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const requiredIds = [
    'trendKeywordOpen', 'trendKeywordModal', 'trendKeywordLoading', 'trendKeywordGrid',
    'trendKeywordMessage', 'trendKeywordApply', 'trendKeywordClose', 'trendKeywordMonth',
    'trendTokenUsage', 'tokenUsage', 'trendKeywordLimitModal', 'trendKeywordLimitClose',
    'keywordMessage'
  ];

  function create(dependencies) {
    const deps = dependencies || {};
    for (const name of [
      'getRoot', 'request', 'getActiveProjectId', 'isKeywordLocked',
      'getSelectedKeywords', 'getSeasonalKeywordIds', 'setSeasonalKeywordIds',
      'getVisibleKeywordIds', 'setVisibleKeywordIds', 'getKeywords', 'setKeywords',
      'renderKeywords', 'showTokenUsage', 'escapeHtml'
    ]) if (typeof deps[name] !== 'function') throw new TypeError(`Step02TrendKeywordController requires ${name}`);

    let choices = [];
    let selection = new Set();
    let requestVersion = 0;
    let mountedRoot = null;
    let elements = null;

    function resolveRoot(root) {
      const value = root || mountedRoot || deps.getRoot();
      if (!value || typeof value.querySelector !== 'function' || !value.body) {
        throw new TypeError('Step02TrendKeywordController requires a DOM root');
      }
      return value;
    }

    function collect(root) {
      const found = {};
      for (const id of requiredIds) {
        found[id] = root.querySelector(`#${id}`);
        if (!found[id]) throw new Error(`Step02TrendKeywordController missing #${id}`);
      }
      return found;
    }

    function current() {
      const root = resolveRoot();
      return {root, nodes: mountedRoot ? elements : collect(root)};
    }

    function render() {
      const {nodes} = current();
      nodes.trendKeywordGrid.innerHTML = choices.length ? choices.map(item =>
        `<button class="trend-keyword-card ${selection.has(item.id) ? 'selected' : ''}" type="button" data-trend-keyword="${deps.escapeHtml(item.id)}"><strong>${deps.escapeHtml(item.label)}</strong><small>${deps.escapeHtml(item.description)}</small></button>`
      ).join('') : '<p class="trend-keyword-empty">추천 키워드가 없습니다.</p>';
    }

    function setLoading(loading) {
      const {nodes} = current();
      nodes.trendKeywordLoading.hidden = !loading;
      nodes.trendKeywordGrid.hidden = loading;
      nodes.trendKeywordGrid.setAttribute('aria-busy', String(loading));
      nodes.trendKeywordOpen.textContent = loading ? 'AI 추천 생성 중…' : 'AI 트렌드 추천';
    }

    async function open() {
      const {root, nodes} = current();
      const selected = deps.getSelectedKeywords();
      const activeProjectId = deps.getActiveProjectId();
      if (!activeProjectId || deps.isKeywordLocked()) {
        nodes.keywordMessage.textContent = '키워드를 편집할 콘텐츠를 먼저 선택해 주세요.';
        return;
      }
      if (selected.size >= 5) {
        nodes.trendKeywordLimitModal.hidden = false;
        root.body.classList.add('modal-open');
        return;
      }
      const projectId = activeProjectId;
      const version = ++requestVersion;
      nodes.trendKeywordOpen.disabled = true;
      nodes.trendKeywordApply.disabled = true;
      nodes.trendKeywordModal.hidden = false;
      root.body.classList.add('modal-open');
      nodes.trendKeywordMessage.textContent = '요양원 계절·행사 추천 후보를 불러오고 있습니다…';
      choices = [];
      selection.clear();
      render();
      setLoading(true);
      try {
        const result = await deps.request('/api/season-keywords', {
          method: 'POST',
          body: JSON.stringify({project_id: projectId, refresh: true, month: nodes.trendKeywordMonth.value})
        });
        if (version !== requestVersion || projectId !== deps.getActiveProjectId() || nodes.trendKeywordModal.hidden) return;
        choices = result.keywords || [];
        deps.showTokenUsage(result.usage);
        nodes.trendTokenUsage.textContent = nodes.tokenUsage.textContent;
        nodes.trendKeywordMessage.textContent = result.source === 'monthly_pool'
          ? `${result.month} 요양원 후보 ${result.pool_size}개에서 무작위 추천 · 남은 후보 ${result.remaining}개 · 외부 API 호출 없음${result.cycled ? ' · 후보를 한 바퀴 돌아 다시 섞었습니다.' : ''}`
          : '기존 추천과 다른 키워드를 실제 API로 받았습니다. 닫고 다시 추천하면 새로 요청합니다.';
        render();
        nodes.trendKeywordApply.disabled = false;
      } catch (error) {
        if (version === requestVersion && projectId === deps.getActiveProjectId() && !nodes.trendKeywordModal.hidden) {
          nodes.trendKeywordMessage.textContent = error.message;
          render();
        }
      } finally {
        if (version === requestVersion) {
          setLoading(false);
          nodes.trendKeywordOpen.disabled = deps.isKeywordLocked();
        }
      }
    }

    function toggle(event) {
      const {nodes} = current();
      const card = event.target.closest('[data-trend-keyword]');
      if (!card) return;
      const id = card.dataset.trendKeyword;
      const trendIds = new Set(choices.map(item => item.id));
      const baseCount = [...deps.getSelectedKeywords()].filter(item => !trendIds.has(item)).length;
      if (selection.has(id)) selection.delete(id);
      else if (baseCount + selection.size < 5) selection.add(id);
      else {
        nodes.trendKeywordMessage.textContent = '기존 선택을 포함해 키워드는 최대 5개입니다.';
        return;
      }
      render();
    }

    function close() {
      const {root, nodes} = current();
      nodes.trendKeywordModal.hidden = true;
      setLoading(false);
      root.body.classList.remove('modal-open');
    }

    function closeLimit() {
      const {root, nodes} = current();
      nodes.trendKeywordLimitModal.hidden = true;
      root.body.classList.remove('modal-open');
    }

    function apply() {
      const {root, nodes} = current();
      const selected = deps.getSelectedKeywords();
      const applied = choices.filter(item => selection.has(item.id));
      deps.getSeasonalKeywordIds().forEach(id => selected.delete(id));
      deps.setSeasonalKeywordIds(new Set(applied.map(item => item.id)));
      deps.setKeywords([...deps.getKeywords().filter(item => !item.seasonal), ...applied]);
      const keywords = deps.getKeywords();
      const baseIds = deps.getVisibleKeywordIds().filter(id => !keywords.find(item => item.id === id)?.seasonal).slice(0, 8);
      const refill = keywords.filter(item => !item.seasonal && !baseIds.includes(item.id)).map(item => item.id);
      while (baseIds.length < 8 && refill.length) baseIds.push(refill.shift());
      const targetCount = 8 - applied.length;
      for (let index = baseIds.length - 1; baseIds.length > targetCount && index >= 0; index--) {
        if (!selected.has(baseIds[index])) baseIds.splice(index, 1);
      }
      applied.forEach(item => selected.add(item.id));
      deps.setVisibleKeywordIds([...baseIds.slice(0, targetCount), ...applied.map(item => item.id)]);
      nodes.trendKeywordModal.hidden = true;
      root.body.classList.remove('modal-open');
      nodes.keywordMessage.textContent = `AI 추천 ${applied.length}개를 뒤쪽 카드에 반영했습니다.`;
      deps.renderKeywords();
    }

    const listeners = {
      open: () => open(),
      grid: event => toggle(event),
      close: () => close(),
      closeLimit: () => closeLimit(),
      apply: () => apply()
    };

    function mount(root) {
      const value = resolveRoot(root);
      if (mountedRoot) return true;
      const found = collect(value);
      found.trendKeywordOpen.addEventListener('click', listeners.open);
      found.trendKeywordGrid.addEventListener('click', listeners.grid);
      found.trendKeywordClose.addEventListener('click', listeners.close);
      found.trendKeywordLimitClose.addEventListener('click', listeners.closeLimit);
      found.trendKeywordApply.addEventListener('click', listeners.apply);
      mountedRoot = value;
      elements = found;
      return true;
    }

    function unmount() {
      if (!mountedRoot) return;
      elements.trendKeywordOpen.removeEventListener('click', listeners.open);
      elements.trendKeywordGrid.removeEventListener('click', listeners.grid);
      elements.trendKeywordClose.removeEventListener('click', listeners.close);
      elements.trendKeywordLimitClose.removeEventListener('click', listeners.closeLimit);
      elements.trendKeywordApply.removeEventListener('click', listeners.apply);
      mountedRoot = null;
      elements = null;
    }

    return Object.freeze({mount, unmount, open, close, closeLimit, apply, render, setLoading});
  }

  return Object.freeze({create});
});
