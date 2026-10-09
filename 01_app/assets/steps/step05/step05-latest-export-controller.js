(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Step05LatestExportController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(dependencies) {
    const deps = dependencies || {};
    if (!deps.section || typeof deps.section !== 'object') throw new TypeError('Step05LatestExportController requires section');
    if (!deps.list || typeof deps.list.replaceChildren !== 'function' || typeof deps.list.append !== 'function') {
      throw new TypeError('Step05LatestExportController requires list');
    }
    if (!deps.storage || typeof deps.storage.getItem !== 'function' || typeof deps.storage.setItem !== 'function') {
      throw new TypeError('Step05LatestExportController requires storage');
    }
    if (typeof deps.storageKey !== 'string' || !deps.storageKey) throw new TypeError('Step05LatestExportController requires storageKey');
    if (!deps.platformLabels || typeof deps.platformLabels !== 'object') throw new TypeError('Step05LatestExportController requires platformLabels');
    if (!deps.platformFormats || typeof deps.platformFormats !== 'object') throw new TypeError('Step05LatestExportController requires platformFormats');
    ['createElement', 'now', 'onError'].forEach(name => {
      if (typeof deps[name] !== 'function') throw new TypeError(`Step05LatestExportController requires ${name}`);
    });

    function previewClass(item) {
      const width = Number(item?.width);
      const height = Number(item?.height);
      if (width > 0 && height > 0) {
        const ratio = width / height;
        if (Math.abs(ratio - 16 / 9) < 0.03) return 'preview-landscape';
        if (Math.abs(ratio - 9 / 16) < 0.03) return 'preview-portrait';
        if (Math.abs(ratio - 4 / 5) < 0.03) return 'preview-feed';
        if (Math.abs(ratio - 1) < 0.03) return 'preview-square';
      }
      return deps.platformFormats[item?.platform]?.className || 'preview-landscape';
    }

    function normalize(result) {
      if (Array.isArray(result?.exports) && result.exports.length) return result.exports;
      if (result?.url) return [{url: result.url, filename: result.filename, platform: result.platform}];
      return [];
    }

    function show(result) {
      const exports = normalize(result);
      if (!exports.length) return {shown: false, exports, error: null};
      deps.list.replaceChildren();
      exports.forEach(item => {
        const platforms = Array.isArray(item.platforms) && item.platforms.length
          ? item.platforms
          : [item.platform].filter(Boolean);
        const article = deps.createElement('article');
        article.className = `latest-export-item ${previewClass(item)}`;
        const preview = deps.createElement('video');
        preview.controls = true;
        preview.playsInline = true;
        preview.preload = 'metadata';
        preview.src = item.url;
        preview.addEventListener('loadedmetadata', () => {
          article.classList.remove('preview-landscape', 'preview-portrait', 'preview-feed');
          article.classList.add(previewClass({
            width: preview.videoWidth,
            height: preview.videoHeight,
            platform: item.platform
          }));
        }, {once: true});
        const copy = deps.createElement('div');
        copy.className = 'latest-export-copy';
        const kicker = deps.createElement('small');
        kicker.textContent = platforms.map(platform => deps.platformLabels[platform] || platform).join(' · ') || 'LATEST FINAL OUTPUT';
        const name = deps.createElement('strong');
        name.textContent = item.filename || '최종 변환 영상.mp4';
        const actions = deps.createElement('div');
        actions.className = 'latest-export-actions';
        const download = deps.createElement('a');
        download.href = item.url;
        download.download = item.filename || '';
        download.textContent = 'MP4 다운로드';
        actions.append(download);
        copy.append(kicker, name, actions);
        article.append(preview, copy);
        deps.list.append(article);
      });
      deps.section.hidden = false;
      let error = null;
      try {
        deps.storage.setItem(deps.storageKey, JSON.stringify({exports, savedAt: deps.now().toISOString()}));
      } catch (cause) {
        error = cause;
        deps.onError('save', cause);
      }
      return {shown: true, exports, error};
    }

    function load() {
      try {
        const result = JSON.parse(deps.storage.getItem(deps.storageKey) || 'null');
        return show(result);
      } catch (error) {
        deps.onError('load', error);
        return {shown: false, exports: [], error};
      }
    }

    return Object.freeze({show, load, previewClass});
  }

  return Object.freeze({create});
});
