(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([
      './scene-navigation',
      './ratio-profiles',
      './brand-selection',
      './mobile-sync'
    ], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./scene-navigation'),
      require('./ratio-profiles'),
      require('./brand-selection'),
      require('./mobile-sync')
    );
  } else {
    root.VideoEditor = factory(
      root.VideoEditorSceneNav,
      root.VideoEditorRatioProfiles,
      root.VideoEditorBrandSelection,
      root.VideoEditorMobileSync
    );
  }
}(typeof self !== 'undefined' ? self : this, function (sceneNav, ratioProfiles, brandSelection, mobileSync) {
  'use strict';

  return {
    SceneNav: sceneNav,
    RatioProfiles: ratioProfiles,
    BrandSelection: brandSelection,
    MobileSync: mobileSync
  };
}));
