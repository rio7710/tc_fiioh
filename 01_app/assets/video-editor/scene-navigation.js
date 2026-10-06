(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.VideoEditorSceneNav = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function calculateTimelineDuration(scenes) {
    if (!Array.isArray(scenes) || scenes.length === 0) return 0;
    const last = scenes[scenes.length - 1];
    return Number.isFinite(Number(last?.end)) ? Number(last.end) : 0;
  }

  function findSceneAtTime(scenes, time) {
    if (!Array.isArray(scenes) || scenes.length === 0) return 0;
    const t = Math.max(0, Number(time) || 0);
    const idx = scenes.findIndex((s, i) => {
      const start = Number(s.start) || 0;
      const end = Number(s.end) || 0;
      return t >= start && (t < end || i === scenes.length - 1);
    });
    return Math.max(0, idx);
  }

  function calculateSceneSeekTime(scene) {
    if (!scene) return 0;
    const base = scene.text && Number.isFinite(Number(scene.cueStart))
      ? Number(scene.cueStart)
      : Number(scene.start) || 0;
    return base + 0.05;
  }

  function calculateOutroSeekTime(duration) {
    const dur = Math.max(0, Number(duration) || 0);
    return Math.max(0, dur - 0.05);
  }

  function isOutroActive(time, duration, outroEnabled = true) {
    if (!outroEnabled) return false;
    const dur = Math.max(0, Number(duration) || 0);
    const t = Math.max(0, Number(time) || 0);
    const threshold = Math.max(0, dur - 2.0);
    return t >= threshold;
  }

  function getNavigationStatus(scenes, time, outroEnabled = true) {
    const list = Array.isArray(scenes) ? scenes : [];
    const duration = calculateTimelineDuration(list);
    const t = Math.max(0, Number(time) || 0);
    const isOutro = isOutroActive(t, duration, outroEnabled);
    const sceneIndex = isOutro ? -1 : findSceneAtTime(list, t);

    return {
      time: t,
      duration: duration,
      sceneIndex: sceneIndex,
      isOutro: isOutro,
      canPrev: list.length > 0 && (isOutro || sceneIndex > 0),
      canNext: list.length > 0 && (!isOutro && (sceneIndex < list.length - 1 || outroEnabled))
    };
  }

  function createInitialNavigationState(scenes, options = {}) {
    const list = Array.isArray(scenes) ? scenes : [];
    const outroEnabled = options.outroEnabled !== false;
    const duration = calculateTimelineDuration(list);
    const initialTime = Math.max(0, Number(options.initialTime) || 0);
    const isOutro = isOutroActive(initialTime, duration, outroEnabled);
    const index = isOutro ? (list.length > 0 ? list.length - 1 : 0) : findSceneAtTime(list, initialTime);

    return {
      scenes: list,
      currentSceneIndex: index,
      isOutro: isOutro,
      currentTime: initialTime,
      duration: duration,
      outroEnabled: outroEnabled,
      canPrev: list.length > 0 && (isOutro || index > 0),
      canNext: list.length > 0 && (!isOutro && (index < list.length - 1 || outroEnabled))
    };
  }

  function navigateScene(scenes, currentState, action, options = {}) {
    const list = Array.isArray(scenes) ? scenes : (currentState?.scenes || []);
    const duration = calculateTimelineDuration(list);
    const outroEnabled = options.outroEnabled ?? currentState?.outroEnabled ?? true;
    const state = currentState || createInitialNavigationState(list, { outroEnabled });

    let nextIndex = state.currentSceneIndex;
    let nextIsOutro = false;
    let targetTime = state.currentTime;

    const actionType = typeof action === 'string' ? action : action?.type;
    const actionIndex = typeof action === 'object' ? action.index : undefined;

    switch (actionType) {
      case 'SEEK_SCENE': {
        const target = Math.max(0, Math.min(list.length - 1, Number(actionIndex) || 0));
        nextIndex = target;
        nextIsOutro = false;
        targetTime = calculateSceneSeekTime(list[target]);
        break;
      }
      case 'SEEK_OUTRO': {
        if (outroEnabled) {
          nextIndex = list.length > 0 ? list.length - 1 : 0;
          nextIsOutro = true;
          targetTime = calculateOutroSeekTime(duration);
        }
        break;
      }
      case 'PREV_SCENE': {
        if (state.isOutro) {
          nextIndex = list.length > 0 ? list.length - 1 : 0;
          nextIsOutro = false;
          targetTime = calculateSceneSeekTime(list[nextIndex]);
        } else if (state.currentSceneIndex > 0) {
          nextIndex = state.currentSceneIndex - 1;
          nextIsOutro = false;
          targetTime = calculateSceneSeekTime(list[nextIndex]);
        }
        break;
      }
      case 'NEXT_SCENE': {
        if (!state.isOutro) {
          if (state.currentSceneIndex < list.length - 1) {
            nextIndex = state.currentSceneIndex + 1;
            nextIsOutro = false;
            targetTime = calculateSceneSeekTime(list[nextIndex]);
          } else if (outroEnabled) {
            nextIndex = list.length - 1;
            nextIsOutro = true;
            targetTime = calculateOutroSeekTime(duration);
          }
        }
        break;
      }
      case 'SEEK_TIME': {
        const t = Math.max(0, Number(action?.time) || 0);
        targetTime = t;
        nextIsOutro = isOutroActive(t, duration, outroEnabled);
        nextIndex = nextIsOutro ? (list.length > 0 ? list.length - 1 : 0) : findSceneAtTime(list, t);
        break;
      }
      default:
        break;
    }

    const canPrev = list.length > 0 && (nextIsOutro || nextIndex > 0);
    const canNext = list.length > 0 && (!nextIsOutro && (nextIndex < list.length - 1 || outroEnabled));

    return {
      scenes: list,
      currentSceneIndex: nextIndex,
      isOutro: nextIsOutro,
      currentTime: targetTime,
      duration: duration,
      outroEnabled: outroEnabled,
      canPrev: canPrev,
      canNext: canNext
    };
  }

  return {
    calculateTimelineDuration: calculateTimelineDuration,
    findSceneAtTime: findSceneAtTime,
    calculateSceneSeekTime: calculateSceneSeekTime,
    calculateOutroSeekTime: calculateOutroSeekTime,
    isOutroActive: isOutroActive,
    getNavigationStatus: getNavigationStatus,
    createInitialNavigationState: createInitialNavigationState,
    navigateScene: navigateScene
  };
}));
