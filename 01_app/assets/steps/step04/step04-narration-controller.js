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
    let pendingTimelineTime = null;
    const root = () => deps.getRoot?.() || deps.root || null;

    function active() { return Number(deps.getActiveNarration?.() ?? -1); }
    function setActive(value) { if (typeof deps.setActiveNarration === 'function') deps.setActiveNarration(value); }
    function enabled() { return Boolean(deps.isNarrationEnabled?.()); }

    function stop() {
      const index = active();
      const audio = index >= 0 ? narrationAudios[index] : null;
      if (audio && typeof audio.pause === 'function') audio.pause();
      setActive(-1);
      pendingTimelineTime = null;
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
        pendingTimelineTime = time;
        audio.currentTime = targetTime;
        const playing = audio.play();
        if (playing && typeof playing.catch === 'function') playing.catch(() => {});
      } else if (Math.abs(audio.currentTime - targetTime) > 0.25) {
        pendingTimelineTime = time;
        audio.currentTime = targetTime;
        if (audio.paused) {
          const playing = audio.play();
          if (playing && typeof playing.catch === 'function') playing.catch(() => {});
        }
      } else pendingTimelineTime = null;
    }

    function getTimelineTime() {
      const index = active();
      const target = index >= 0 ? narrations[index] : null;
      const audio = index >= 0 ? narrationAudios[index] : null;
      if (!enabled() || !target || !audio) return null;
      const cueDuration = Math.max(0.001, Number(target.end) - Number(target.start));
      const audioDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : cueDuration;
      if (pendingTimelineTime != null) {
        const expected = Math.min(Math.max(0, audioDuration - 0.03), Math.max(0, pendingTimelineTime - target.start) / cueDuration * audioDuration);
        if (Math.abs((Number(audio.currentTime) || 0) - expected) <= 0.25) pendingTimelineTime = null;
        else return pendingTimelineTime;
      }
      const progress = Math.max(0, Math.min(1, (Number(audio.currentTime) || 0) / audioDuration));
      return Number(target.start) + progress * cueDuration;
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

    function setEnabled(value) {
      const next = Boolean(value);
      deps.setNarrationEnabled?.(next);
      const currentRoot = root();
      if (currentRoot) {
        const button = currentRoot.querySelector?.('#narrationBtn');
        if (button) {
          button.classList.toggle('active', next);
          button.setAttribute('aria-pressed', String(next));
          button.textContent = next ? 'STT 내레이션 켬' : 'STT 내레이션 끔';
        }
        const video = currentRoot.querySelector?.('#video');
        if (video) next ? sync(video.currentTime, true) : stop();
      }
      deps.saveEditorSettings?.();
    }

    return { setTracks, stop, start, sync, reset, setEnabled, getTimelineTime };
  }

  return { create };
}));
