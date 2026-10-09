/* Step 04 timeline preview DOM synchronization controller. */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Step04TimelinePreviewController = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(dependencies) {
    const deps = dependencies || {};
    const query = selector => deps.root?.querySelector?.(selector) || null;
    const durationFor = scenes => deps.SceneNav?.calculateTimelineDuration
      ? deps.SceneNav.calculateTimelineDuration(scenes)
      : (scenes.length ? Number(scenes[scenes.length - 1].end) || 0 : 0);

    function generatedVideoUri(scene) {
      const value = scene?.generatedVideo || scene?.video || null;
      if (typeof value === 'string') return value;
      return value?.uri || value?.preview_uri || value?.url || '';
    }

    function syncSceneMedia(scene, time, changed) {
      const stage = query('#stage');
      const image = query('#sceneImage');
      const video = query('#sceneVideo');
      const clock = query('#video');
      const badge = query('#sceneResourceBadge');
      const videoUri = generatedVideoUri(scene);
      const usesVideo = Boolean(videoUri);
      if (changed && image) {
        image.src = scene?.image || '';
        image.alt = `${scene?.name || ''} 장면 이미지`;
      }
      stage?.classList?.toggle?.('has-scene-video', usesVideo);
      if (badge) badge.textContent = usesVideo ? '영상' : '사진';
      if (!video) return;
      if (!usesVideo) {
        video.pause?.();
        return;
      }
      video.dataset = video.dataset || {};
      if (changed || video.dataset.previewSrc !== videoUri) {
        video.dataset.previewSrc = videoUri;
        video.src = videoUri;
        video.load?.();
      }
      let targetTime = Math.max(0, Number(time) - (Number(scene?.start) || 0));
      if (Number.isFinite(video.duration) && video.duration > 0) targetTime = Math.min(targetTime, Math.max(0, video.duration - 0.03));
      if (Math.abs((Number(video.currentTime) || 0) - targetTime) > 0.25) {
        try { video.currentTime = targetTime; } catch (_) {}
      }
      if (clock && !clock.paused) {
        if (video.paused) {
          const playing = video.play?.();
          if (playing && typeof playing.catch === 'function') playing.catch(() => {});
        }
      } else video.pause?.();
    }

    function sync(time) {
      const scenes = deps.getScenes?.() || [];
      const t = Number(time) || 0;
      const duration = durationFor(scenes);
      if (!scenes.length) {
        const empty = { currentScene: -1, showOutro: false, time: t, duration: 0 };
        deps.syncNavigation?.(empty);
        return empty;
      }
      const index = deps.SceneNav?.findSceneAtTime ? deps.SceneNav.findSceneAtTime(scenes, t) : 0;
      const changed = index !== deps.getCurrentScene?.();
      if (changed) {
        deps.setCurrentScene?.(index);
        deps.applyStoredSceneCrop?.();
      }
      const currentScene = deps.getCurrentScene?.() ?? index;
      syncSceneMedia(scenes[currentScene], t, changed);
      const showOutro = deps.SceneNav?.isOutroActive
        ? deps.SceneNav.isOutroActive(t, duration, true)
        : t >= Math.max(0, duration - 2);
      const stage = query('#stage');
      if (stage) {
        stage.style?.setProperty?.('--scene-dissolve-seconds', `${deps.getDissolveSeconds?.() ?? .5}s`);
        stage.classList?.toggle?.('has-outro-preview', showOutro);
      }
      const outro = query('#brandOutroPreview');
      if (outro) outro.hidden = !showOutro;
      const item = scenes[currentScene];
      const captionText = item ? (item.text || item.script || item.narration || item.line || item.name || '') : '';
      const title = query('#titleText');
      if (title) title.textContent = captionText;
      stage?.classList?.toggle?.('has-title', Boolean(captionText) && !showOutro);

      const view = { currentScene, showOutro, time: t, duration };
      deps.syncNavigation?.(view);
      const progress = query('#progressFill');
      if (progress) progress.style.width = `${duration ? Math.max(0, Math.min(100, t / duration * 100)) : 0}%`;
      const clock = query('#clock');
      if (clock) clock.textContent = `${deps.formatTime?.(t) || '00:00'} / ${deps.formatTime?.(duration) || '00:00'}`;
      return view;
    }

    function updateSummary() {
      const scenes = deps.getScenes?.() || [];
      const duration = durationFor(scenes);
      const summary = query('#sceneTimelineSummary');
      if (summary) summary.textContent = `타임라인 기준 · 총 ${scenes.length}장면 · ${duration}초`;
      return { count: scenes.length, duration };
    }

    return { sync, updateSummary };
  }

  return { create };
}));
