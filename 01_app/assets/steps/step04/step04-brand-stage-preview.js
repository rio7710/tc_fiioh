(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Step04BrandStagePreview = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(dependencies) {
    const deps = dependencies || {};
    for (const name of ['getRoot', 'getAssets', 'ensureOutroRatioAssets', 'getCurrentRatio']) {
      if (typeof deps[name] !== 'function') throw new TypeError(`Step04BrandStagePreview requires ${name}`);
    }
    if (!deps.state || typeof deps.state.activeWatermarkProfile !== 'function' || typeof deps.state.activeOutroProfile !== 'function') {
      throw new TypeError('Step04BrandStagePreview requires brand state');
    }

    function requireNode(selector) {
      const node = deps.getRoot()?.querySelector?.(selector);
      if (!node) throw new Error(`Step04BrandStagePreview missing ${selector}`);
      return node;
    }

    function roleControls(role) {
      const title = role[0].toUpperCase() + role.slice(1);
      return {
        enabled: requireNode(`#brand${title}Enabled`),
        select: requireNode(`#brand${title}Version`)
      };
    }

    function applyPosition(element, position) {
      if (!element?.style) throw new TypeError('Step04BrandStagePreview position target requires style');
      const [vertical, horizontal] = position.split('-');
      element.style.inset = 'auto';
      element.style.transform = '';
      if (horizontal === 'left') element.style.left = '3.5%';
      else if (horizontal === 'right') element.style.right = '3.5%';
      else { element.style.left = '50%'; element.style.transform = 'translateX(-50%)'; }
      if (vertical === 'top') element.style.top = '3.5%';
      else if (vertical === 'bottom') element.style.bottom = '3.5%';
      else { element.style.top = '50%'; element.style.transform += `${element.style.transform ? ' ' : ''}translateY(-50%)`; }
    }

    const currentRatio = () => deps.getCurrentRatio();
    const activeWatermarkProfile = () => deps.state.activeWatermarkProfile(currentRatio());
    const activeOutroProfile = () => deps.state.activeOutroProfile(currentRatio());

    function backgroundColor(profile) {
      const alpha = Math.max(0, Math.min(1, Number(profile.background_opacity ?? .8)));
      if (profile.background === 'white') return `rgba(255,255,255,${alpha})`;
      if (profile.background === 'black') return `rgba(0,0,0,${alpha})`;
      return 'transparent';
    }

    function updateWatermark() {
      const controls = roleControls('watermark');
      const preview = requireNode('#brandWatermarkPreview');
      preview.hidden = !controls.enabled.checked || !controls.select.value;
      preview.src = preview.hidden ? '' : `/api/brand-asset?version_id=${encodeURIComponent(controls.select.value)}`;
      preview.style.opacity = requireNode('#brandWatermarkOpacity').value;
      const profile = activeWatermarkProfile();
      preview.style.width = `${Number(profile.width_ratio || .15) * 100}%`;
      applyPosition(preview, profile.position || 'top-right');
    }

    function updateOutro() {
      const controls = roleControls('outro');
      const assets = deps.getAssets();
      const selectedItem = (Array.isArray(assets) ? assets : []).find(asset => asset.version_id === controls.select.value);
      if (selectedItem) deps.ensureOutroRatioAssets(selectedItem);
      const profile = activeOutroProfile();
      const item = (Array.isArray(assets) ? assets : []).find(asset => asset.version_id === profile.version_id) || selectedItem;
      const holder = requireNode('#brandOutroPreview');
      const image = requireNode('#brandOutroPreviewImage');
      const clip = requireNode('#brandOutroPreviewVideo');
      const enabled = Boolean(controls.enabled.checked && item);
      holder.dataset.enabled = String(enabled);
      image.hidden = !enabled || item?.media_type === 'video';
      clip.hidden = !enabled || item?.media_type !== 'video';
      if (!enabled) {
        holder.style.backgroundColor = 'transparent';
        image.removeAttribute('src');
        clip.removeAttribute('src');
        return;
      }
      const source = `/api/brand-asset?version_id=${encodeURIComponent(item.version_id)}`;
      const media = item.media_type === 'video' ? clip : image;
      if (media.getAttribute('src') !== source) media.src = source;
      holder.style.backgroundColor = backgroundColor(profile);
      media.style.width = `${Number(profile.width_ratio || 1) * 100}%`;
      media.style.inset = 'auto';
      applyPosition(media, profile.position || 'center-center');
    }

    return Object.freeze({roleControls, applyPosition, currentRatio, activeWatermarkProfile, activeOutroProfile, backgroundColor, updateWatermark, updateOutro});
  }

  return Object.freeze({create});
});
