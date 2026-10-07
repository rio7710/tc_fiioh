(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BrandOverlayController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RATIOS = Object.freeze([
    ['16x9', '1920 × 1080 · 16:9'],
    ['9x16', '1080 × 1920 · 9:16'],
    ['4x5', '1080 × 1350 · 4:5'],
    ['1x1', '1080 × 1080 · 1:1']
  ]);

  function create(dependencies) {
    const deps = dependencies || {};
    for (const name of ['state', 'getBrandAssets', 'saveSelection', 'applyPosition', 'backgroundColor', 'updateWatermarkPreview', 'updateOutroPreview', 'onError']) {
      if (typeof deps[name] !== (name === 'state' ? 'object' : 'function')) throw new TypeError(`BrandOverlayController requires ${name}`);
    }

    let rootNode = null;
    let mounted = false;
    let listeners = [];
    const watermark = {item: null, index: 0, snapshot: null, saved: false};
    const outro = {item: null, index: 0, snapshot: null, saved: false};

    function query(selector) {
      return rootNode?.querySelector(selector) || null;
    }

    function requireNode(selector) {
      const node = query(selector);
      if (!node) throw new Error(`BrandOverlayController missing ${selector}`);
      return node;
    }

    function listen(node, type, handler) {
      if (!node) return false;
      node.addEventListener(type, handler);
      listeners.push(() => node.removeEventListener(type, handler));
      return true;
    }

    function guarded(feature, callback) {
      return function (event) {
        try {
          const result = callback(event);
          if (result && typeof result.catch === 'function') result.catch(error => deps.onError(feature, error));
        } catch (error) {
          deps.onError(feature, error);
        }
      };
    }

    function ratioAt(index) {
      return RATIOS[index]?.[0];
    }

    function syncWatermarkControls() {
      const {watermarkPosition} = deps.state.snapshot();
      rootNode.querySelectorAll('[data-watermark-position]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.watermarkPosition === watermarkPosition));
      });
    }

    function activateWatermarkRatio(index) {
      if (!RATIOS[index]) throw new RangeError(`Invalid watermark ratio index: ${index}`);
      watermark.index = index;
      const ratio = ratioAt(index);
      deps.state.updateWatermarkProfile(ratio, deps.state.activeWatermarkProfile(ratio));
      syncWatermarkControls();
    }

    function renderWatermark() {
      if (!watermark.item) throw new Error('Watermark preview item is not selected');
      const [ratio, label] = RATIOS[watermark.index];
      const {watermarkPosition, watermarkWidthRatio} = deps.state.snapshot();
      const mark = `/api/brand-asset?version_id=${encodeURIComponent(watermark.item.version_id)}`;
      const grid = requireNode('#watermarkPreviewGrid');
      grid.innerHTML = `<figure class="watermark-demo"><div class="watermark-demo-frame ratio-${ratio}"><img class="watermark-demo-bg" src="/02_media/images/scenes/scene_01.webp" alt=""><img class="watermark-demo-mark" src="${mark}" alt=""></div><figcaption>${label} · ${watermark.index + 1}/${RATIOS.length}</figcaption></figure>`;
      const previewMark = requireNode('#watermarkPreviewGrid .watermark-demo-mark');
      previewMark.style.width = `${watermarkWidthRatio * 100}%`;
      deps.applyPosition(previewMark, watermarkPosition);
      const sizePercent = Math.round(watermarkWidthRatio * 100);
      requireNode('#watermarkSizeRange').value = String(sizePercent);
      requireNode('#watermarkSizeLabel').textContent = `${sizePercent}%`;
      requireNode('#watermarkPreviewPrev').disabled = watermark.index === 0;
      requireNode('#watermarkPreviewNext').disabled = watermark.index === RATIOS.length - 1;
      return {ratio, index: watermark.index};
    }

    function openWatermarkPreview(versionId) {
      const item = deps.getBrandAssets().find(asset => asset.version_id === versionId && asset.role === 'watermark');
      if (!item) throw new Error(`Watermark asset not found: ${versionId}`);
      watermark.item = item;
      watermark.snapshot = deps.state.snapshot();
      watermark.saved = false;
      activateWatermarkRatio(0);
      requireNode('#watermarkPreviewName').textContent = `${item.name} · v${item.version}`;
      renderWatermark();
      requireNode('#watermarkPreviewModal').hidden = false;
      rootNode.body?.classList.add('modal-open');
      return {opened: true, versionId};
    }

    function closeWatermarkPreview() {
      if (!watermark.saved && watermark.snapshot) {
        deps.state.hydrate(watermark.snapshot);
        deps.updateWatermarkPreview();
      }
      watermark.snapshot = null;
      requireNode('#watermarkPreviewModal').hidden = true;
      rootNode.body?.classList.remove('modal-open');
      return {closed: true, restored: !watermark.saved};
    }

    async function saveWatermarkPreview() {
      if (!watermark.item) throw new Error('Watermark preview item is not selected');
      const select = requireNode('#brandWatermarkVersion');
      const enabled = requireNode('#brandWatermarkEnabled');
      const button = requireNode('#watermarkPreviewSave');
      select.value = watermark.item.version_id;
      enabled.checked = true;
      button.disabled = true;
      try {
        await deps.saveSelection();
        deps.updateWatermarkPreview();
        watermark.saved = true;
        closeWatermarkPreview();
      } finally {
        button.disabled = false;
      }
    }

    function syncOutroControls() {
      const {outroPosition, outroBackground} = deps.state.snapshot();
      rootNode.querySelectorAll('[data-outro-position]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.outroPosition === outroPosition));
      });
      rootNode.querySelectorAll('[data-outro-background]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.outroBackground === outroBackground));
      });
      requireNode('#outroBackgroundOpacity').disabled = outroBackground === 'none';
    }

    function activateOutroRatio(index) {
      if (!RATIOS[index]) throw new RangeError(`Invalid outro ratio index: ${index}`);
      outro.index = index;
      const ratio = ratioAt(index);
      deps.state.updateOutroProfile(ratio, deps.state.activeOutroProfile(ratio));
      syncOutroControls();
    }

    function renderOutro() {
      if (!outro.item) throw new Error('Outro preview item is not selected');
      const [ratio, label] = RATIOS[outro.index];
      const profile = deps.state.activeOutroProfile(ratio);
      const {outroPosition, outroWidthRatio, outroBackground, outroBackgroundOpacity} = deps.state.snapshot();
      const ratioItem = deps.getBrandAssets().find(asset => asset.version_id === profile.version_id) || outro.item;
      const source = `/api/brand-asset?version_id=${encodeURIComponent(ratioItem.version_id)}`;
      const media = ratioItem.media_type === 'video'
        ? `<video class="outro-preview-asset" src="${source}" autoplay muted loop playsinline></video>`
        : `<img class="outro-preview-asset" src="${source}" alt="">`;
      const grid = requireNode('#outroPreviewGrid');
      grid.innerHTML = `<figure class="watermark-demo"><div class="watermark-demo-frame ratio-${ratio}"><img class="watermark-demo-bg" src="/02_media/images/scenes/scene_01.webp" alt=""><span class="outro-preview-background"></span>${media}</div><figcaption>${label} · ${outro.index + 1}/${RATIOS.length}</figcaption></figure>`;
      requireNode('#outroPreviewGrid .outro-preview-background').style.backgroundColor = deps.backgroundColor({background: outroBackground, background_opacity: outroBackgroundOpacity});
      const asset = requireNode('#outroPreviewGrid .outro-preview-asset');
      asset.style.inset = 'auto';
      asset.style.width = `${outroWidthRatio * 100}%`;
      asset.style.height = 'auto';
      deps.applyPosition(asset, outroPosition);
      const sizePercent = Math.round(outroWidthRatio * 100);
      requireNode('#outroSizeRange').value = String(sizePercent);
      requireNode('#outroSizeLabel').textContent = `${sizePercent}%`;
      const opacityPercent = Math.round(outroBackgroundOpacity * 100);
      requireNode('#outroBackgroundOpacity').value = String(opacityPercent);
      requireNode('#outroBackgroundOpacityLabel').textContent = `${opacityPercent}%`;
      syncOutroControls();
      requireNode('#outroPreviewPrev').disabled = outro.index === 0;
      requireNode('#outroPreviewNext').disabled = outro.index === RATIOS.length - 1;
      return {ratio, index: outro.index, versionId: ratioItem.version_id};
    }

    function openOutroPreview(versionId) {
      const item = deps.getBrandAssets().find(asset => asset.version_id === versionId && asset.role === 'outro');
      if (!item) throw new Error(`Outro asset not found: ${versionId}`);
      outro.item = item;
      outro.snapshot = deps.state.snapshot();
      outro.saved = false;
      activateOutroRatio(0);
      requireNode('#outroPreviewName').textContent = `${item.name} · v${item.version}`;
      renderOutro();
      requireNode('#outroPreviewModal').hidden = false;
      rootNode.body?.classList.add('modal-open');
      return {opened: true, versionId};
    }

    function closeOutroPreview() {
      if (!outro.saved && outro.snapshot) deps.state.hydrate(outro.snapshot);
      outro.snapshot = null;
      requireNode('#outroPreviewModal').hidden = true;
      rootNode.body?.classList.remove('modal-open');
      requireNode('#outroPreviewGrid').innerHTML = '';
      return {closed: true, restored: !outro.saved};
    }

    async function saveOutroPreview() {
      if (!outro.item) throw new Error('Outro preview item is not selected');
      const select = requireNode('#brandOutroVersion');
      const enabled = requireNode('#brandOutroEnabled');
      const button = requireNode('#outroPreviewSave');
      select.value = outro.item.version_id;
      enabled.checked = true;
      button.disabled = true;
      try {
        await deps.saveSelection();
        deps.updateOutroPreview();
        outro.saved = true;
        closeOutroPreview();
      } finally {
        button.disabled = false;
      }
    }

    function bindFeature(feature, bindings) {
      const missing = [];
      bindings.forEach(([selector, type, handler, multiple]) => {
        const nodes = multiple ? Array.from(rootNode.querySelectorAll(selector)) : [query(selector)].filter(Boolean);
        if (!nodes.length) missing.push(selector);
        nodes.forEach(node => listen(node, type, guarded(feature, handler)));
      });
      return missing.length ? {ok: false, error: `Missing controls: ${missing.join(', ')}`} : {ok: true};
    }

    function mount(nextRoot) {
      if (mounted) return {mounted: false, reason: 'already-mounted'};
      if (!nextRoot || typeof nextRoot.querySelector !== 'function') throw new TypeError('BrandOverlayController mount root must support querySelector');
      rootNode = nextRoot;
      const watermarkStatus = bindFeature('watermark', [
        ['#watermarkPreviewClose', 'click', closeWatermarkPreview],
        ['#watermarkPreviewSave', 'click', saveWatermarkPreview],
        ['#watermarkPreviewPrev', 'click', () => { if (watermark.index > 0) { activateWatermarkRatio(watermark.index - 1); renderWatermark(); } }],
        ['#watermarkPreviewNext', 'click', () => { if (watermark.index < RATIOS.length - 1) { activateWatermarkRatio(watermark.index + 1); renderWatermark(); } }],
        ['[data-watermark-position]', 'click', event => { deps.state.updateWatermarkProfile(ratioAt(watermark.index), {position: event.currentTarget.dataset.watermarkPosition}); syncWatermarkControls(); renderWatermark(); deps.updateWatermarkPreview(); }, true],
        ['#watermarkSizeRange', 'input', event => { deps.state.updateWatermarkProfile(ratioAt(watermark.index), {width_ratio: Number(event.target.value) / 100}); renderWatermark(); deps.updateWatermarkPreview(); }],
        ['#watermarkPreviewModal', 'pointerdown', event => { if (event.target === event.currentTarget) closeWatermarkPreview(); }]
      ]);
      const outroStatus = bindFeature('outro', [
        ['#outroPreviewClose', 'click', closeOutroPreview],
        ['#outroPreviewSave', 'click', saveOutroPreview],
        ['#outroPreviewPrev', 'click', () => { if (outro.index > 0) { activateOutroRatio(outro.index - 1); renderOutro(); } }],
        ['#outroPreviewNext', 'click', () => { if (outro.index < RATIOS.length - 1) { activateOutroRatio(outro.index + 1); renderOutro(); } }],
        ['[data-outro-position]', 'click', event => { deps.state.updateOutroProfile(ratioAt(outro.index), {position: event.currentTarget.dataset.outroPosition}); syncOutroControls(); renderOutro(); }, true],
        ['#outroSizeRange', 'input', event => { deps.state.updateOutroProfile(ratioAt(outro.index), {width_ratio: Number(event.target.value) / 100}); renderOutro(); }],
        ['[data-outro-background]', 'click', event => { deps.state.updateOutroProfile(ratioAt(outro.index), {background: event.currentTarget.dataset.outroBackground}); renderOutro(); }, true],
        ['#outroBackgroundOpacity', 'input', event => { deps.state.updateOutroProfile(ratioAt(outro.index), {background_opacity: Number(event.target.value) / 100}); renderOutro(); }],
        ['#outroPreviewModal', 'pointerdown', event => { if (event.target === event.currentTarget) closeOutroPreview(); }]
      ]);
      mounted = true;
      return {mounted: true, watermark: watermarkStatus, outro: outroStatus};
    }

    function unmount() {
      listeners.splice(0).forEach(remove => remove());
      const wasMounted = mounted;
      mounted = false;
      rootNode = null;
      return {unmounted: wasMounted};
    }

    function refresh() {
      const result = {};
      for (const [name, callback] of [['watermark', deps.updateWatermarkPreview], ['outro', deps.updateOutroPreview]]) {
        try {
          callback();
          result[name] = {ok: true};
        } catch (error) {
          result[name] = {ok: false, error};
          deps.onError(name, error);
        }
      }
      return result;
    }

    return Object.freeze({mount, unmount, refresh, openWatermarkPreview, openOutroPreview});
  }

  return Object.freeze({create, RATIOS});
});
