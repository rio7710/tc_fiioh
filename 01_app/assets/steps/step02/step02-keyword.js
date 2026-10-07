/* Step 02 keyword selection controller. Data and navigation are supplied by the shell. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Step02Keyword = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_SELECTION = 5;
  let adapter = null;
  let host = null;
  let locked = false;
  let initialized = false;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function element(id) {
    return host && host.querySelector(`#${id}`);
  }

  function selectedSet() {
    const selected = adapter && adapter.getSelectedKeywords && adapter.getSelectedKeywords();
    return selected instanceof Set ? selected : new Set(Array.isArray(selected) ? selected : []);
  }

  function items() {
    const values = adapter && adapter.getKeywords && adapter.getKeywords();
    return Array.isArray(values) ? values : [];
  }

  function visibleItems() {
    const all = items();
    const byId = new Map(all.map(item => [String(item.id), item]));
    const requested = adapter && adapter.getVisibleKeywordIds && adapter.getVisibleKeywordIds();
    const ids = Array.isArray(requested) && requested.length ? requested : all.slice(0, 8).map(item => item.id);
    return ids.map(id => byId.get(String(id))).filter(Boolean);
  }

  function renderMonthOptions() {
    const select = element('trendKeywordMonth');
    if (!select) return;
    const months = adapter && adapter.getKeywordMonths && adapter.getKeywordMonths();
    if (!Array.isArray(months)) return;
    select.innerHTML = '<option value="">이번 달 자동</option>' + months.map(month => (
      `<option value="${escapeHtml(month.value)}">${escapeHtml(month.label)}</option>`
    )).join('');
  }

  function tiltFor(id) {
    let hash = 0;
    for (const character of String(id)) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
    const angle = .35 + (hash % 86) / 100;
    return `${hash % 2 ? '-' : ''}${angle.toFixed(2)}deg`;
  }

  function render() {
    const grid = element('keywordGrid');
    if (!grid) return false;
    const selected = selectedSet();
    grid.innerHTML = visibleItems().map(item => {
      const id = String(item.id);
      const isSelected = selected.has(id);
      const image = encodeURIComponent(String(item.image || id));
      return `<label class="keyword-card ${isSelected ? 'selected' : ''} ${locked ? 'locked' : ''}" data-keyword="${escapeHtml(id)}" style="--keyword-bg:url('/01_app/assets/keywords/${image}.webp');--selected-tilt:${tiltFor(id)}"><input type="checkbox" ${isSelected ? 'checked' : ''} ${locked ? 'disabled' : ''}>${item.seasonal ? '<span class="keyword-ai-badge">AI 추천</span>' : ''}<span class="keyword-label">${escapeHtml(item.label)}</span><span class="keyword-description">${escapeHtml(item.description)}</span></label>`;
    }).join('');
    const count = element('selectionCount');
    if (count) count.textContent = `${selected.size} / ${MAX_SELECTION} 선택 · 전체 ${items().length}개`;
    return true;
  }

  function setMessage(message) {
    const target = element('keywordMessage');
    if (target) target.textContent = message || '';
  }

  function setLocked(value) {
    locked = Boolean(value);
    const trend = element('trendKeywordOpen');
    const refresh = element('keywordRefresh');
    const next = element('keywordNext');
    if (trend) trend.disabled = locked;
    if (refresh) refresh.disabled = locked;
    if (next) next.textContent = locked ? '저장된 대본 보기' : '다음 · 대본 구성';
    if (locked) setMessage('이 콘텐츠는 대본이 확정되어 키워드가 잠겨 있습니다.');
    render();
  }

  function onGridClick(event) {
    const card = event.target.closest && event.target.closest('.keyword-card');
    if (!card || !host.contains(card)) return;
    if (locked) return setMessage('대본이 확정된 콘텐츠의 키워드는 수정할 수 없습니다.');
    const selected = selectedSet();
    const id = String(card.dataset.keyword);
    if (selected.has(id)) selected.delete(id);
    else if (selected.size >= MAX_SELECTION) return setMessage('키워드는 최대 5개까지 선택할 수 있습니다.');
    else selected.add(id);
    if (adapter.setSelectedKeywords) adapter.setSelectedKeywords(selected);
    setMessage('');
    render();
  }

  async function saveAndContinue() {
    const selected = selectedSet();
    if (locked) return adapter.goToStep && adapter.goToStep(3);
    const projectId = adapter.getActiveProjectId && adapter.getActiveProjectId();
    if (!projectId) return setMessage('키워드를 편집할 콘텐츠를 먼저 선택해 주세요.');
    if (selected.size < 1 || selected.size > MAX_SELECTION) return setMessage('키워드를 1~5개 선택해 주세요.');
    const next = element('keywordNext');
    if (next) next.disabled = true;
    try {
      const result = await adapter.api('/api/keywords', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId, selected: Array.from(selected) })
      });
      if (adapter.onSaved) await adapter.onSaved(result);
      if (adapter.goToStep) await adapter.goToStep(3);
      return result;
    } catch (error) {
      setMessage(error && error.message ? error.message : '키워드를 저장하지 못했습니다.');
      return null;
    } finally {
      if (next) next.disabled = false;
    }
  }

  function init(options) {
    if (!options || !options.root || typeof options.root.querySelector !== 'function') return false;
    host = options.root;
    adapter = options.adapter || {};
    if (initialized) return render();
    const grid = element('keywordGrid');
    const refresh = element('keywordRefresh');
    const trend = element('trendKeywordOpen');
    const next = element('keywordNext');
    if (!grid || !refresh || !trend || !next) return false;
    grid.addEventListener('click', onGridClick);
    refresh.addEventListener('click', () => adapter.refreshKeywordBatch && adapter.refreshKeywordBatch());
    trend.addEventListener('click', () => adapter.openTrendKeywords && adapter.openTrendKeywords());
    next.addEventListener('click', saveAndContinue);
    initialized = true;
    renderMonthOptions();
    render();
    return true;
  }

  function reset() {
    adapter = null;
    host = null;
    locked = false;
    initialized = false;
  }

  return Object.freeze({ MAX_SELECTION, init, renderKeywords: render, renderMonthOptions, setKeywordStageLocked: setLocked, saveAndContinue, reset, escapeHtml });
}));
