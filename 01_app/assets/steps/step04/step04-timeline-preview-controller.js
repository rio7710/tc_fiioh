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
        const image = query('#sceneImage');
        if (image) {
          image.src = scenes[index]?.image || '';
          image.alt = `${scenes[index]?.name || ''} 장면 이미지`;
        }
        deps.applyStoredSceneCrop?.();
      }
      const currentScene = deps.getCurrentScene?.() ?? index;
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
