(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Step02Keyword = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_SELECTION = 5;
  const requiredIds = ['keywordGrid', 'selectionCount', 'keywordRefresh', 'keywordMessage', 'keywordNext'];

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[character]);
  }

  function create(dependencies) {
    const deps = dependencies || {};
    for (const name of ['getRoot','getKeywords','getVisibleKeywordIds','setVisibleKeywordIds','getSelectedKeywords','getActiveProjectId','beginNav','isStaleNav','loadProjectContent','showStep','ensureStepApiReady','request','setDemoState','runAiWorkflow','random']) {
      if (typeof deps[name] !== 'function') throw new TypeError(`Step02Keyword requires ${name}`);
    }
    let locked = false;
    let busy = false;
    const tilts = new Map();
    let mountedRoot = null;
    let elements = null;

    function resolveRoot(root) {
      const value = root || mountedRoot || deps.getRoot();
      if (!value || typeof value.querySelector !== 'function') throw new TypeError('Step02Keyword requires a DOM root');
      return value;
    }
    function collect(root) {
      const found = {};
      for (const id of requiredIds) {
        found[id] = root.querySelector(`#${id}`);
        if (!found[id]) throw new Error(`Step02Keyword missing #${id}`);
      }
      return found;
    }
    function current() {
      const root = resolveRoot();
      return {root, nodes: mountedRoot ? elements : collect(root)};
    }
    function render() {
      const {nodes} = current();
      const keywords = deps.getKeywords();
      const selected = deps.getSelectedKeywords();
      const keywordMap = new Map(keywords.map(item => [item.id, item]));
      const requested = deps.getVisibleKeywordIds();
      const visible = (requested.length ? requested : keywords.slice(0, 8).map(item => item.id)).map(id => keywordMap.get(id)).filter(Boolean);
      nodes.keywordGrid.innerHTML = visible.map(item => {
        const isSelected = selected.has(item.id);
        if (isSelected && !tilts.has(item.id)) {
          const angle = (.35 + deps.random() * .85) * (deps.random() < .5 ? -1 : 1);
          tilts.set(item.id, `${angle.toFixed(2)}deg`);
        }
        const tilt = tilts.get(item.id) || '0deg';
        return `<label class="keyword-card ${isSelected ? 'selected' : ''} ${locked ? 'locked' : ''}" data-keyword="${escapeHtml(item.id)}" style="--keyword-bg:url('/01_app/assets/keywords/${encodeURIComponent(item.image || item.id)}.webp');--selected-tilt:${tilt}"><input type="checkbox" ${isSelected ? 'checked' : ''} ${locked ? 'disabled' : ''}>${item.seasonal ? '<span class="keyword-ai-badge">AI 추천</span>' : ''}<span class="keyword-label">${escapeHtml(item.label)}</span><span class="keyword-description">${escapeHtml(item.description)}</span></label>`;
      }).join('');
      nodes.selectionCount.textContent = `${selected.size} / ${MAX_SELECTION} 선택 · 전체 ${keywords.length}개`;
    }
    function setLocked(value) {
      const {nodes} = current();
      locked = Boolean(value);
      nodes.keywordRefresh.disabled = locked;
      nodes.keywordNext.textContent = locked ? '저장된 대본 보기' : '다음 · 대본 구성';
      render();
      if (locked) nodes.keywordMessage.textContent = '이 콘텐츠는 대본이 확정되어 키워드가 잠겨 있습니다.';
    }
    function select(event) {
      const {root, nodes} = current();
      const card = event.target.closest('.keyword-card');
      if (!card || (typeof root.contains === 'function' && !root.contains(card))) return;
      event.preventDefault();
      if (locked) { nodes.keywordMessage.textContent = '대본이 확정된 콘텐츠의 키워드는 수정할 수 없습니다.'; return; }
      const selected = deps.getSelectedKeywords();
      const id = card.dataset.keyword;
      if (selected.has(id)) { selected.delete(id); tilts.delete(id); }
      else if (selected.size < MAX_SELECTION) selected.add(id);
      else { nodes.keywordMessage.textContent = '키워드는 최대 5개까지 선택할 수 있습니다.'; return; }
      nodes.keywordMessage.textContent = '';
      render();
    }
    function refresh() {
      const currentIds = deps.getVisibleKeywordIds().slice(0, 8);
      const currentSet = new Set(currentIds);
      const selected = deps.getSelectedKeywords();
      const replacements = deps.getKeywords().filter(item => !item.seasonal && !selected.has(item.id) && !currentSet.has(item.id)).map(item => item.id).sort(() => deps.random() - .5);
      deps.setVisibleKeywordIds(currentIds.map(id => selected.has(id) ? id : (replacements.shift() || id)));
      render();
    }
    async function saveAndContinue() {
      const {nodes} = current();
      const button = nodes.keywordNext;
      const message = nodes.keywordMessage;
      message.textContent = '';
      if (busy || button.disabled) return;
      busy = true;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      try {
        const projectId = deps.getActiveProjectId();
        if (!projectId) throw new Error('키워드를 편집할 콘텐츠를 먼저 선택해 주세요.');
        if (locked) {
          const token = deps.beginNav();
          try { await deps.loadProjectContent(projectId, token); }
          catch (error) { if (!deps.isStaleNav(token)) throw error; return; }
          if (deps.isStaleNav(token)) return;
          deps.showStep(3);
          return;
        }
        const selected = deps.getSelectedKeywords();
        if (!selected.size) throw new Error('키워드를 1개 이상 선택해 주세요.');
        if (!await deps.ensureStepApiReady(2)) return;
        const saved = await deps.request('/api/keywords', {method:'POST',body:JSON.stringify({project_id:projectId,selected:[...selected]})});
        deps.setDemoState(saved.state);
        await deps.runAiWorkflow();
        return saved;
      } catch (error) { message.textContent = error.message; }
      finally { busy = false; button.disabled = false; button.removeAttribute('aria-busy'); }
    }
    const listeners = {grid:event=>select(event),refresh:()=>refresh(),next:()=>saveAndContinue()};
    function mount(root) {
      const value = resolveRoot(root);
      if (mountedRoot) return true;
      const found = collect(value);
      found.keywordGrid.addEventListener('click', listeners.grid);
      found.keywordRefresh.addEventListener('click', listeners.refresh);
      found.keywordNext.addEventListener('click', listeners.next);
      mountedRoot = value;
      elements = found;
      render();
      return true;
    }
    function unmount() {
      if (!mountedRoot) return;
      elements.keywordGrid.removeEventListener('click', listeners.grid);
      elements.keywordRefresh.removeEventListener('click', listeners.refresh);
      elements.keywordNext.removeEventListener('click', listeners.next);
      mountedRoot = null;
      elements = null;
    }
    return Object.freeze({mount,unmount,render,refresh,setLocked,saveAndContinue,isLocked:()=>locked,isBusy:()=>busy});
  }
  return Object.freeze({MAX_SELECTION,create,escapeHtml});
});
