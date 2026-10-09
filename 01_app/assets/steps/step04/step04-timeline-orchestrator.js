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
    let logicalTime = 0;
    let pendingSeekTime = null;
    const getRoot = () => d.getRoot?.() || d.root || null;
    const getScenes = () => scenes;
    const getPreviewTime = () => logicalTime;
    function setPreviewTime(value) {
      logicalTime = Math.max(0, Number(value) || 0);
      pendingSeekTime = logicalTime;
      const video = getRoot()?.querySelector?.('#video');
      if (video) {
        try { video.currentTime = logicalTime; }
        catch (error) { d.onMediaSeekError?.(error); }
      }
      d.syncNarration?.(logicalTime, true);
    }
    function sync() {
      if (!scenes.length) return;
      const root = getRoot();
      if (!root) return;
      const video = root.querySelector?.('#video');
      if (!video) return;
      const mediaTime = Math.max(0, Number(video.currentTime) || 0);
      const playbackValue = d.getPlaybackTime?.();
      const playbackTime = Number(playbackValue);
      const hasPlaybackTime = playbackValue != null && Number.isFinite(playbackTime) && playbackTime >= 0;
      if (pendingSeekTime != null) {
        if (hasPlaybackTime && Math.abs(playbackTime - pendingSeekTime) <= 0.35) {
          pendingSeekTime = null;
          logicalTime = playbackTime;
        } else if (Math.abs(mediaTime - pendingSeekTime) <= 0.35) {
          pendingSeekTime = null;
          if (!video.paused) logicalTime = hasPlaybackTime ? playbackTime : mediaTime;
        } else {
          // Safari can ignore a currentTime assignment until metadata/seek
          // ranges are ready. Keep the requested scene authoritative while
          // playback is active and retry instead of snapping back to 0.
          logicalTime = pendingSeekTime;
          if (video.readyState == null || video.readyState >= 1) {
            try { video.currentTime = pendingSeekTime; }
            catch (error) { d.onMediaSeekError?.(error); }
          }
        }
      } else if (!video.paused) logicalTime = hasPlaybackTime ? playbackTime : mediaTime;
      const view = d.previewSync?.(logicalTime);
      d.syncNarration?.(view.time, false);
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
      logicalTime = 0;
      pendingSeekTime = null;
      d.setCurrentScene?.(-1);
      d.renderSceneList?.();
      if (getRoot()) { d.updateSummary?.(); sync(); }
    }
    return { getScenes, getPreviewTime, setPreviewTime, applyTimeline, sync };
  }
  return { create };
}));
