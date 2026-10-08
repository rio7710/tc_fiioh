/* Step 04 visual style controls. */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Step04StyleController = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const FALLBACK_STYLES = ['card', 'minimal', 'editorial', 'bubble', 'block', 'action'];
  function create(d) {
    d = d || {};
    const root = () => d.getRoot?.() || d.root || null;
    const query = selector => root()?.querySelector?.(selector) || null;
    const all = selector => Array.from(root()?.querySelectorAll?.(selector) || []);
    function setSceneDissolveSeconds(seconds) {
      const value = Number.isFinite(Number(seconds)) ? Math.max(0, Math.min(3, Number(seconds))) : .5;
      d.setState?.('sceneDissolveSeconds', value);
      query('#stage')?.style?.setProperty?.('--scene-dissolve-seconds', `${value}s`);
    }
    function setCaptionSize(level) {
      const value = Math.max(-5, Math.min(5, level));
      d.setState?.('captionSizeLevel', value);
      if (!root()) return;
      query('#stage')?.style?.setProperty?.('--caption-size-offset', `${value * .278}cqmin`);
      const display = query('#captionSizeValue'); if (display) display.textContent = value === 0 ? '기본' : `${value > 0 ? '+' : ''}${value}`;
      const down = query('#captionSizeDown'); if (down) down.disabled = value === -5;
      const up = query('#captionSizeUp'); if (up) up.disabled = value === 5;
      d.saveEditorSettings?.();
    }
    function setType(type) {
      d.setState?.('currentType', type);
      if (!root()) return;
      const catalogStyles = d.getCatalog?.()?.styles;
      const styleNames = catalogStyles && typeof catalogStyles === 'object'
        ? Array.from(new Set([...FALLBACK_STYLES, ...Object.keys(catalogStyles)]))
        : FALLBACK_STYLES;
      const stage = query('#stage');
      if (stage) { stage.classList.remove(...styleNames.map(name => `type-${name}`)); stage.classList.add(`type-${type}`); }
      all('.type-btn').forEach(button => {
        const selected = button.dataset.type === type;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      d.saveEditorSettings?.();
    }
    return { setSceneDissolveSeconds, setCaptionSize, setType };
  }
  return { create, FALLBACK_STYLES: FALLBACK_STYLES.slice() };
}));
