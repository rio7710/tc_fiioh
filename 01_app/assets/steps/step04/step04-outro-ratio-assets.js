(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Step04OutroRatioAssets = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const RATIOS = Object.freeze(['16x9', '9x16', '4x5', '1x1']);

  function create(dependencies) {
    const deps = dependencies || {};
    if (!deps.state || typeof deps.state !== 'object') throw new TypeError('Step04OutroRatioAssets requires state');
    for (const method of ['snapshot', 'activeOutroProfile', 'hydrate']) {
      if (typeof deps.state[method] !== 'function') throw new TypeError(`Step04OutroRatioAssets state requires ${method}`);
    }
    if (typeof deps.getAssets !== 'function') throw new TypeError('Step04OutroRatioAssets requires getAssets');
    const getAssets = () => { const value = deps.getAssets(); return Array.isArray(value) ? value : []; };

    function isCompanion(item) {
      return Boolean(item?.role === 'outro' && /^greenhill_outro_v4_(9x16|4x5|1x1)\.png$/.test(item.uri || ''));
    }

    function ensure(item, options = {}) {
      if (!item) return undefined;
      const assets = getAssets();
      const force = options.force === true;
      const isGreenhillV4 = item.uri === 'greenhill_outro_v4_16x9.png' || /^greenhill_outro_v4_/.test(item.uri || '');
      const nextState = deps.state.snapshot();
      RATIOS.forEach(ratio => {
        if (!nextState.outroProfiles[ratio]) nextState.outroProfiles[ratio] = deps.state.activeOutroProfile(ratio);
        const currentVersionId = nextState.outroProfiles[ratio].version_id;
        const hasValidVersion = Boolean(currentVersionId && assets.some(asset => asset.role === 'outro' && asset.version_id === currentVersionId && asset.active !== false));
        if (!force && hasValidVersion) return;
        if (isGreenhillV4) {
          const ratioAsset = assets.find(asset => asset.role === 'outro' && asset.uri === `greenhill_outro_v4_${ratio}.png`);
          nextState.outroProfiles[ratio].version_id = ratioAsset ? ratioAsset.version_id : item.version_id;
        } else {
          nextState.outroProfiles[ratio].version_id = item.version_id;
        }
      });
      deps.state.hydrate(nextState);
      return undefined;
    }

    return Object.freeze({isCompanion, ensure});
  }
  return Object.freeze({create, RATIOS});
});
