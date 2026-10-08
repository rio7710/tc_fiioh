/* Step 04 small UI actions and lifecycle binding callbacks. */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Step04UIActionsController = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function create(d) {
    d = d || {};
    const root = () => d.getRoot?.() || d.root || null;
    const query = selector => root()?.querySelector?.(selector) || null;
    function openImageRegeneration(...args) {
      if (d.hasShellFeature?.('openImageRegeneration')) return d.callShellFeature?.('openImageRegeneration', ...args);
      const modal = query('#imageRegenerationModal'); if (modal) modal.hidden = false;
    }
    function closeImageRegeneration(...args) {
      if (d.hasShellFeature?.('closeImageRegeneration')) return d.callShellFeature?.('closeImageRegeneration', ...args);
      const modal = query('#imageRegenerationModal'); if (modal) modal.hidden = true;
    }
    function requestImageRegeneration(...args) {
      if (d.hasShellFeature?.('requestImageRegeneration')) return d.callShellFeature?.('requestImageRegeneration', ...args);
      const modal = query('#imageRegenerationModal'); if (modal) modal.hidden = true;
    }
    function platformForRatio(ratio) { return ratio === '9x16' ? 'instagram' : ratio === '4x5' ? 'facebook' : ratio === '1x1' ? 'square' : 'youtube'; }
    function startRender() { return typeof d.startRender === 'function' ? d.startRender() : undefined; }
    function openDistributionHelp() {
      const modal = query('#platformGuideModal');
      if (modal) { modal.hidden = false; d.getBody?.()?.classList?.add('modal-open'); }
    }
    async function brandChanged(event) {
      if (event.target.id === 'brandOutroVersion') {
        const assets = d.getBrandAssets?.() || [];
        d.callShellFeature?.('ensureOutroRatioAssets', assets.find(item => item.version_id === event.target.value));
      }
      d.callShellFeature?.('updateWatermarkPreview');
      d.callShellFeature?.('updateCommonOutroPreview');
      const saved = d.callShellFeature?.('saveBrandSelections');
      if (saved && typeof saved.then === 'function') await saved;
    }
    function toggleDistribution(platform, button) {
      if (!platform) return;
      const selected = d.getSelectedPlatforms?.();
      selected.has(platform) ? selected.delete(platform) : selected.add(platform);
      d.setSelectedPlatforms?.(selected);
      button.setAttribute('aria-pressed', String(selected.has(platform)));
      d.saveEditorSettings?.();
    }
    return { openImageRegeneration, closeImageRegeneration, requestImageRegeneration, platformForRatio, startRender, openDistributionHelp, brandChanged, toggleDistribution };
  }
  return { create };
}));
