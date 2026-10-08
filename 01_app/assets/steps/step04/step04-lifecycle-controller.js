/* Step 04 partial-DOM lifecycle controller. */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Step04LifecycleController = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function create(d) {
    d = d || {};
    let initialized = false;
    function init() {
      const document = d.getDocument?.();
      if (!document) return false;
      const step4 = document.querySelector?.('#step4');
      if (!step4) return false;
      if (initialized) return true;
      d.navigationMount?.(document);
      d.playbackMount?.();
      const options = typeof d.getBindingOptions === 'function' ? d.getBindingOptions() : (d.bindingOptions || {});
      const result = d.UIBindings?.bind({ document, root: step4, ...options });
      if (!result?.bound) return false;
      try { d.restoreEditorSettings?.(); }
      catch (error) { d.onError?.('[Step04:settings-restore]', error); }
      initialized = true;
      return true;
    }
    return { init, isInitialized: () => initialized };
  }
  return { create };
}));
