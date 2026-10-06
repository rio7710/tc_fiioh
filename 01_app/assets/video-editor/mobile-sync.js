(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.VideoEditorMobileSync = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function formatTime(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function computeMobileSyncState(scenes, activeIndex, isOutro, time, duration, outroEnabled = true) {
    const list = Array.isArray(scenes) ? scenes : [];
    const idx = isOutro ? -1 : Math.max(0, Math.min(list.length - 1, Number(activeIndex) || 0));

    const options = list.map((scene, i) => {
      const startFmt = formatTime(scene?.start || 0);
      const endFmt = formatTime(scene?.end || 0);
      const sceneNum = String(i + 1).padStart(2, '0');
      const name = scene?.name ? ` (${scene.name})` : '';
      return {
        value: String(i),
        label: `SCENE ${sceneNum}${name} · ${startFmt}~${endFmt}`
      };
    });

    if (outroEnabled) {
      options.push({
        value: 'outro',
        label: 'OUTRO · 엔딩 카피 & 브랜딩'
      });
    }

    const selectedValue = isOutro ? 'outro' : (list.length > 0 ? String(idx) : '0');
    const prevDisabled = list.length === 0 || (!isOutro && idx <= 0);
    const nextDisabled = list.length === 0 || isOutro || (idx >= list.length - 1 && !outroEnabled);

    let displayLabel = '';
    if (isOutro) {
      displayLabel = `OUTRO (${formatTime(duration)})`;
    } else if (list.length > 0) {
      displayLabel = `SCENE ${String(idx + 1).padStart(2, '0')} / ${String(list.length).padStart(2, '0')}`;
    } else {
      displayLabel = 'NO SCENES';
    }

    return {
      options: options,
      selectedValue: selectedValue,
      prevDisabled: prevDisabled,
      nextDisabled: nextDisabled,
      displayLabel: displayLabel,
      formattedCurrentTime: formatTime(time),
      formattedDuration: formatTime(duration)
    };
  }

  function resolveMobileSelectChange(selectValue, scenes, outroEnabled = true) {
    const value = String(selectValue || '').toLowerCase().trim();
    if (value === 'outro') {
      return { type: 'SEEK_OUTRO' };
    }
    const list = Array.isArray(scenes) ? scenes : [];
    const parsed = parseInt(value, 10);
    const validIndex = Number.isNaN(parsed) ? 0 : Math.max(0, Math.min(list.length - 1, parsed));
    return { type: 'SEEK_SCENE', index: validIndex };
  }

  return {
    formatTime: formatTime,
    computeMobileSyncState: computeMobileSyncState,
    resolveMobileSelectChange: resolveMobileSelectChange
  };
}));
