(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Step04BrandSelectionController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const ROLES = Object.freeze(['intro', 'outro', 'watermark']);
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  function create(dependencies) {
    const deps = dependencies || {};
    for (const name of ['getRoot', 'request', 'isOutroRatioCompanion', 'ensureOutroRatioAssets', 'updateWatermarkPreview', 'updateOutroPreview', 'getSceneCount', 'renderSceneList', 'escapeHtml']) {
      if (typeof deps[name] !== 'function') throw new TypeError(`Step04BrandSelectionController requires ${name}`);
    }
    if (!deps.state || typeof deps.state.hydrate !== 'function' || typeof deps.state.serializeSettings !== 'function') {
      throw new TypeError('Step04BrandSelectionController requires brand state');
    }
    let assets = [];
    let selections = [];

    function requireNode(selector) {
      const node = deps.getRoot()?.querySelector?.(selector);
      if (!node) throw new Error(`Step04BrandSelectionController missing ${selector}`);
      return node;
    }
    function roleControls(role) {
      const title = role[0].toUpperCase() + role.slice(1);
      return {enabled: requireNode(`#brand${title}Enabled`), select: requireNode(`#brand${title}Version`)};
    }
    const getAssets = () => clone(assets);
    const getSelections = () => clone(selections);

    function hydrate(values) {
      const source = values || {};
      if (Object.prototype.hasOwnProperty.call(source, 'assets')) assets = clone(Array.isArray(source.assets) ? source.assets : []);
      if (Object.prototype.hasOwnProperty.call(source, 'selections')) selections = clone(Array.isArray(source.selections) ? source.selections : []);
      return Object.freeze({assets: getAssets(), selections: getSelections()});
    }

    function renderChoices() {
      ROLES.forEach(role => {
        const controls = roleControls(role);
        const items = assets.filter(item => item.role === role && item.active && !deps.isOutroRatioCompanion(item));
        controls.select.innerHTML = '<option value="">등록된 버전 없음</option>' + items.map(item => `<option value="${deps.escapeHtml(item.version_id)}">${deps.escapeHtml(item.name)} · v${item.version}</option>`).join('');
        const saved = selections.find(item => item.role === role);
        const isValidSaved = saved?.version_id && items.some(item => item.version_id === saved.version_id);
        if (isValidSaved) controls.select.value = saved.version_id;
        else if (items.length) controls.select.value = items[0].version_id;
        controls.enabled.checked = Boolean(saved?.enabled && controls.select.value);
        controls.enabled.disabled = !items.length;
      });
      const watermark = selections.find(item => item.role === 'watermark');
      const watermarkSettings = watermark?.settings || {};
      requireNode('#brandWatermarkOpacity').value = watermarkSettings.opacity ?? .8;
      const outro = selections.find(item => item.role === 'outro');
      deps.state.hydrate({watermark: watermarkSettings, outro: outro?.settings || {}});
      const outroControls = roleControls('outro');
      const selectedOutro = assets.find(item => item.version_id === outroControls.select.value);
      if (selectedOutro) deps.ensureOutroRatioAssets(selectedOutro);
      deps.updateWatermarkPreview();
      deps.updateOutroPreview();
      if (deps.getSceneCount()) deps.renderSceneList();
    }

    function serializeSelections() {
      return ROLES.map(role => {
        const controls = roleControls(role);
        const settings = role === 'watermark'
          ? {opacity: Number(requireNode('#brandWatermarkOpacity').value), ...deps.state.serializeSettings('watermark')}
          : role === 'outro' ? deps.state.serializeSettings('outro') : {};
        return {role, enabled: controls.enabled.checked, version_id: controls.select.value || null, settings};
      });
    }

    async function saveSelections() {
      const payload = {selections: serializeSelections()};
      const result = await deps.request('/api/content-brand-selection', {method: 'POST', body: JSON.stringify(payload)});
      selections = clone(Array.isArray(result?.selections) ? result.selections : []);
      if (deps.getSceneCount()) deps.renderSceneList();
    }

    return Object.freeze({getAssets, getSelections, hydrate, renderChoices, serializeSelections, saveSelections});
  }
  return Object.freeze({create, ROLES});
});
