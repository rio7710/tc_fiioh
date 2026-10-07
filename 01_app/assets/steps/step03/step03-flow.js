/* Step 03 Script/Storyboard data helpers. DOM binding remains in the shell until fragment loading is enabled. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Step03Flow = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function timelineScenes(timeline) {
    const scenes = timeline && Array.isArray(timeline.scenes) ? timeline.scenes : [];
    return scenes.map((scene, index) => ({ ...scene, sourceIndex: index }));
  }

  function scriptRows(timeline) {
    return timelineScenes(timeline).filter(scene => (
      scene.scriptLineIndex != null || scene.script_line_index != null
    ));
  }

  function storyboardRows(timeline) {
    return timelineScenes(timeline);
  }

  function duration(timeline) {
    const scenes = timelineScenes(timeline);
    return scenes.length ? Number(scenes[scenes.length - 1].end) || 0 : 0;
  }

  function setLook(rootElement, requestedLook) {
    const allowed = ['original', 'warm', 'cool', 'realistic'];
    const look = allowed.includes(requestedLook) ? requestedLook : 'original';
    if (!rootElement) return look;
    const grid = rootElement.querySelector('#storyboardGrid');
    if (grid) grid.dataset.look = look;
    rootElement.querySelectorAll('.storyboard-look-btn').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.look === look));
    });
    return look;
  }

  return { timelineScenes, scriptRows, storyboardRows, duration, setLook };
}));
