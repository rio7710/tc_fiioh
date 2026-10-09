(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Step03ScriptEditorController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(dependencies) {
    const deps = dependencies || {};
    for (const name of [
      'getRoot', 'storage', 'storageKey', 'request', 'getScenes', 'escapeHtml',
      'getActiveProjectId', 'setDemoTimeline', 'applyTimeline',
      'getActiveStoryboardDocument', 'setActiveStoryboardDocument',
      'setDemoState', 'applyScript', 'refreshProjectIndex'
    ]) {
      const valid = name === 'storageKey' ? typeof deps[name] === 'string' :
        name === 'storage' ? deps[name] && typeof deps[name].getItem === 'function' && typeof deps[name].setItem === 'function' :
          typeof deps[name] === 'function';
      if (!valid) throw new TypeError(`Step03ScriptEditorController requires ${name}`);
    }

    let baselineLines = [];
    let mountedRoot = null;
    let elements = null;

    function resolveRoot(root) {
      const value = root || deps.getRoot();
      if (!value || typeof value.querySelector !== 'function' || typeof value.querySelectorAll !== 'function') {
        throw new TypeError('Step03ScriptEditorController requires a DOM root');
      }
      return value;
    }

    function collect(root) {
      const found = {};
      for (const id of ['scriptHeadline','scriptConcept','scriptLines','scriptSaveBar','scriptDiffSummary','scriptSaveBtn','scriptMessage']) {
        found[id] = root.querySelector(`#${id}`);
        if (!found[id]) throw new Error(`Step03ScriptEditorController missing #${id}`);
      }
      return found;
    }

    function current() {
      const root = resolveRoot(mountedRoot);
      return {root, elements: mountedRoot ? elements : collect(root)};
    }

    function fill(script) {
      const {elements: el} = current();
      el.scriptHeadline.textContent = script.headline || '';
      el.scriptConcept.textContent = script.concept || '';
      baselineLines = (script.lines || []).map(line => String(line).trim());
      const scenes = deps.getScenes();
      el.scriptLines.innerHTML = (script.lines || []).map((line, index) => {
        const sceneIndex = scenes.findIndex(item => item.scriptLineIndex === index);
        const scene = scenes[sceneIndex];
        const seconds = scene ? Math.max(0, scene.cueEnd - scene.cueStart).toFixed(1) : '0.0';
        const sceneLabel = `S#${String(sceneIndex + 1).padStart(2, '0')}`;
        return `<label class="script-row" data-script-index="${index}"><span class="script-no" title="${deps.escapeHtml(scene?.name || '장면')}">${sceneLabel}</span><input value="${deps.escapeHtml(line)}" aria-label="${sceneLabel} 대본"><span class="script-duration" title="타이틀 노출 시간">#${seconds}s</span><small class="script-diff-old" hidden></small></label>`;
      }).join('');
      updateDiff();
    }

    function payload() {
      const {root, elements: el} = current();
      return {
        headline: el.scriptHeadline.textContent,
        concept: el.scriptConcept.textContent,
        lines: [...root.querySelectorAll('#scriptLines input')].map(input => input.value.trim())
      };
    }

    function updateDiff() {
      const {root, elements: el} = current();
      let changedCount = 0;
      root.querySelectorAll('#scriptLines .script-row').forEach((row, index) => {
        const currentValue = row.querySelector('input').value.trim();
        const baseline = baselineLines[index] || '';
        const changed = currentValue !== baseline;
        row.classList.toggle('changed', changed);
        const old = row.querySelector('.script-diff-old');
        old.hidden = !changed;
        old.textContent = changed ? `수정 전 · ${baseline}` : '';
        if (changed) changedCount += 1;
      });
      el.scriptSaveBar.hidden = changedCount === 0;
      el.scriptDiffSummary.textContent = `수정된 문장 ${changedCount}개 · 아직 저장되지 않았습니다.`;
      return changedCount;
    }

    function loadSaved() {
      try {
        const saved = JSON.parse(deps.storage.getItem(deps.storageKey) || 'null');
        return Array.isArray(saved?.lines) ? saved : null;
      } catch (error) {
        return null;
      }
    }

    function saveLocal(script) {
      try {
        deps.storage.setItem(deps.storageKey, JSON.stringify(script));
      } catch (error) {}
    }

    async function save() {
      const {elements: el} = current();
      el.scriptMessage.textContent = '';
      el.scriptSaveBtn.disabled = true;
      el.scriptSaveBtn.textContent = '저장 중…';
      try {
        const result = await deps.request('/api/script/save', {
          method: 'POST',
          body: JSON.stringify({project_id: deps.getActiveProjectId(), ...payload()})
        });
        if (result.timeline) {
          deps.setDemoTimeline(result.timeline);
          deps.applyTimeline(result.timeline);
        }
        deps.setActiveStoryboardDocument(result.document || deps.getActiveStoryboardDocument());
        deps.setDemoState(result.state);
        saveLocal(result.state.script);
        fill(result.state.script);
        deps.applyScript(result.state.script);
        await deps.refreshProjectIndex();
        el.scriptMessage.textContent = '수정한 대본을 저장했습니다.';
        return result.state.script;
      } finally {
        el.scriptSaveBtn.disabled = false;
        el.scriptSaveBtn.textContent = '수정 내용 저장';
      }
    }

    const listeners = {
      input: () => { updateDiff(); elements.scriptMessage.textContent = ''; },
      save: async () => {
        try { await save(); }
        catch (error) { elements.scriptMessage.textContent = error.message; }
      }
    };

    function mount(root) {
      const nextRoot = resolveRoot(root);
      if (mountedRoot === nextRoot) return true;
      if (mountedRoot) unmount();
      const nextElements = collect(nextRoot);
      nextElements.scriptLines.addEventListener('input', listeners.input);
      nextElements.scriptSaveBtn.addEventListener('click', listeners.save);
      mountedRoot = nextRoot;
      elements = nextElements;
      return true;
    }

    function unmount() {
      if (!mountedRoot) return;
      elements.scriptLines.removeEventListener('input', listeners.input);
      elements.scriptSaveBtn.removeEventListener('click', listeners.save);
      mountedRoot = null;
      elements = null;
    }

    return Object.freeze({mount, unmount, fill, payload, updateDiff, loadSaved, saveLocal, save});
  }

  return Object.freeze({create});
});
