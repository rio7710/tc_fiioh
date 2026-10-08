/* Step 04 timeline ownership and playback synchronization. */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Step04TimelineOrchestrator = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function create(d) {
    d = d || {};
    let scenes = [];
    const getRoot = () => d.getRoot?.() || d.root || null;
    const getScenes = () => scenes;
    function sync() {
      if (!scenes.length) return;
      const root = getRoot();
      if (!root) return;
      const video = root.querySelector?.('#video');
      if (!video) return;
      const time = video.currentTime || 0;
      const view = d.previewSync?.(time);
      d.syncNarration?.(view.time);
      if (!video.paused) d.scheduleFrame?.(sync);
    }
    function applyTimeline(timeline) {
      const source = Array.isArray(timeline?.scenes) ? timeline.scenes : [];
      scenes = source.map(scene => ({
        ...scene,
        text: scene.text || scene.script || scene.narration || scene.line || scene.title || scene.name || '',
        image: scene.image || scene.preview_uri || '',
        cueStart: scene.cueStart != null ? Number(scene.cueStart) : (scene.cue_start != null ? Number(scene.cue_start) : Number(scene.start || 0)),
        cueEnd: scene.cueEnd != null ? Number(scene.cueEnd) : (scene.cue_end != null ? Number(scene.cue_end) : Number(scene.end || 0))
      }));
      d.setCurrentScene?.(-1);
      d.renderSceneList?.();
      if (getRoot()) { d.updateSummary?.(); sync(); }
    }
    return { getScenes, applyTimeline, sync };
  }
  return { create };
}));
