/* Step 04 video and background-music playback controller. */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Step04PlaybackController = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(dependencies) {
    const deps = dependencies || {};
    let mountedRoot = null;
    const root = () => deps.getRoot?.() || deps.root || null;
    const query = selector => root()?.querySelector?.(selector) || null;
    const all = selector => Array.from(root()?.querySelectorAll?.(selector) || []);
    const report = (name, error) => deps.onError?.(name, error);
    const playSafely = (media, name) => {
      if (!media || typeof media.play !== 'function') return;
      try {
        const result = media.play();
        if (result && typeof result.catch === 'function') result.catch(error => report(name, error));
      } catch (error) { report(name, error); }
    };

    function musicUri(track) {
      const uri = deps.resolveMusicUri?.(track) || deps.getCatalog?.()?.music?.[track]?.uri;
      if (!uri) return `/02_media/music/${track}.mp3`;
      const value = String(uri);
      return /^(?:https?:)?\/\//i.test(value) ? value : `/${value.replace(/^\/+/, '')}`;
    }

    function musicTiming() {
      const defaults = deps.getCatalog?.()?.defaults || {};
      const number = (value, fallback) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : fallback;
      return {
        startOffset: number(defaults.music_start_offset_seconds, 3),
        fadeIn: number(defaults.music_fade_in_seconds, 2)
      };
    }

    function syncMusicVolume(time) {
      const bgm = query('#bgm');
      if (!bgm) return 0;
      const timelineTime = Math.max(0, Number(time ?? query('#video')?.currentTime) || 0);
      const fadeIn = musicTiming().fadeIn;
      const target = Math.max(0, Math.min(1, Number(deps.getCurrentVolume?.()) || 0));
      const gain = fadeIn > 0 ? Math.max(0, Math.min(1, timelineTime / fadeIn)) : 1;
      bgm.volume = target * gain;
      return bgm.volume;
    }

    function alignMusic() {
      const video = query('#video');
      const bgm = query('#bgm');
      if (!video || !bgm || deps.getSelectedMusic?.() === 'none') return;
      if (bgm.readyState >= 1 && Number.isFinite(bgm.duration) && bgm.duration > 0) {
        const target = (video.currentTime + musicTiming().startOffset) % bgm.duration;
        if (Math.abs(bgm.currentTime - target) > 0.25) bgm.currentTime = target;
      }
      syncMusicVolume(video.currentTime);
    }

    function setMusic(track) {
      deps.setSelectedMusic?.(track);
      const bgm = query('#bgm');
      const video = query('#video');
      if (bgm && track !== 'none') {
        bgm.src = musicUri(track);
        bgm.addEventListener('loadedmetadata', () => {
          alignMusic();
          if (video && !video.paused) playSafely(bgm, 'bgm-play');
        }, { once: true });
        bgm.load?.();
      }
      all('.music-btn[data-music]').forEach(button => {
        const selected = button.dataset.music === track;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      deps.saveEditorSettings?.();
    }

    function togglePlay() {
      const video = query('#video');
      if (!video) return;
      if (video.paused) playSafely(video, 'video-play');
      else video.pause();
    }

    function mount() {
      const targetRoot = root();
      if (!targetRoot) return false;
      if (mountedRoot === targetRoot) return true;
      mountedRoot = targetRoot;
      const video = query('#video');
      const playButton = query('#playBtn');
      playButton?.addEventListener('click', togglePlay);
      if (!video) return true;
      video.addEventListener('play', () => {
        if (playButton) { playButton.textContent = '일시정지'; playButton.setAttribute('aria-label', '일시정지'); }
        const bgm = query('#bgm');
        if (deps.getSelectedMusic?.() !== 'none' && bgm) {
          alignMusic();
          playSafely(bgm, 'bgm-play');
        }
        deps.sync?.();
      });
      video.addEventListener('pause', () => {
        if (playButton) { playButton.textContent = '재생'; playButton.setAttribute('aria-label', '재생'); }
        query('#sceneVideo')?.pause?.();
        query('#bgm')?.pause?.();
        deps.stopNarration?.();
        deps.sync?.();
      });
      video.addEventListener('seeked', () => {
        alignMusic();
        deps.syncNarration?.(video.currentTime, true);
        deps.sync?.();
      });
      video.addEventListener('timeupdate', () => syncMusicVolume(video.currentTime));
      video.addEventListener('loadedmetadata', () => { deps.updatePanAvailability?.(); deps.sync?.(); });
      video.addEventListener('ended', () => { query('#bgm')?.pause?.(); deps.sync?.(); });
      return true;
    }

    return { mount, setMusic, alignMusic, togglePlay, musicUri, syncMusicVolume };
  }

  return { create };
}));
