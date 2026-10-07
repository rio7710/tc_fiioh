/* Step 04 narration playback controller. */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Step04NarrationController = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(dependencies) {
    const deps = dependencies || {};
    let narrations = [];
    let narrationAudios = [];

    function active() { return Number(deps.getActiveNarration?.() ?? -1); }
    function setActive(value) { if (typeof deps.setActiveNarration === 'function') deps.setActiveNarration(value); }
    function enabled() { return Boolean(deps.isNarrationEnabled?.()); }

    function stop() {
      const index = active();
      const audio = index >= 0 ? narrationAudios[index] : null;
      if (audio && typeof audio.pause === 'function') audio.pause();
      setActive(-1);
    }

    function setTracks(payload) {
      stop();
      narrations = Array.isArray(payload?.narrations) ? payload.narrations.map(item => ({ ...item })) : [];
      narrationAudios = Array.isArray(payload?.narrationAudios) ? payload.narrationAudios.slice() : [];
    }

    function start(index, time) {
      if (!enabled() || index < 0 || !narrations[index] || !narrationAudios[index]) {
        stop();
        return;
      }
      const target = narrations[index];
      const audio = narrationAudios[index];
      const duration = Math.max(0.001, target.end - target.start);
      const audioDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
      const targetTime = Math.min(Math.max(0, audioDuration - 0.03), Math.max(0, time - target.start) / duration * audioDuration);
      if (active() !== index) {
        stop();
        setActive(index);
        audio.currentTime = targetTime;
        const playing = audio.play();
        if (playing && typeof playing.catch === 'function') playing.catch(() => {});
      } else if (Math.abs(audio.currentTime - targetTime) > 0.25) {
        audio.currentTime = targetTime;
        if (audio.paused) {
          const playing = audio.play();
          if (playing && typeof playing.catch === 'function') playing.catch(() => {});
        }
      }
    }

    function sync(time, force) {
      void force;
      const video = deps.getPreviewVideo?.();
      if (!enabled() || !video || video.paused) {
        stop();
        return;
      }
      const index = narrations.findIndex(item => time >= item.start && time < item.end);
      if (index >= 0) start(index, time);
      else stop();
    }

    function reset() {
      stop();
      narrations = [];
      narrationAudios = [];
    }

    return { setTracks, stop, start, sync, reset };
  }

  return { create };
}));
