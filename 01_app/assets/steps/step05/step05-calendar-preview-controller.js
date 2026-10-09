(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Step05CalendarPreviewController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(dependencies) {
    const deps = dependencies || {};
    const eventNodes = [
      'previewModal', 'previewMeta', 'previousButton', 'nextButton', 'previewCloseButton',
      'unavailableModal', 'unavailableCloseButton', 'keyTarget'
    ];
    eventNodes.forEach(name => {
      const node = deps[name];
      if (!node || typeof node.addEventListener !== 'function' || typeof node.removeEventListener !== 'function') {
        throw new TypeError(`Step05CalendarPreviewController requires ${name}`);
      }
    });
    ['video', 'title', 'download', 'count', 'body'].forEach(name => {
      if (!deps[name] || typeof deps[name] !== 'object') throw new TypeError(`Step05CalendarPreviewController requires ${name}`);
    });
    const requiredFunctions = ['getEntries', 'contentIdentity', 'contentVersions', 'escapeHtml', 'onError'];
    requiredFunctions.forEach(name => {
      if (typeof deps[name] !== 'function') throw new TypeError(`Step05CalendarPreviewController requires ${name}`);
    });
    if (!deps.platformFormats || typeof deps.platformFormats !== 'object') throw new TypeError('Step05CalendarPreviewController requires platformFormats');
    if (!deps.platformLabels || typeof deps.platformLabels !== 'object') throw new TypeError('Step05CalendarPreviewController requires platformLabels');

    let mounted = false;
    let previewVersions = [];
    let previewVersionIndex = 0;

    function entries() {
      const value = deps.getEntries();
      if (!Array.isArray(value)) throw new TypeError('calendar entries must be an array');
      return value;
    }

    function play() {
      try {
        const result = deps.video.play();
        if (result && typeof result.catch === 'function') result.catch(error => deps.onError('play', error));
      } catch (error) {
        deps.onError('play', error);
      }
    }

    function updateBodyLock() {
      if (deps.previewModal.hidden && deps.unavailableModal.hidden) deps.body.classList.remove('modal-open');
      else deps.body.classList.add('modal-open');
    }

    function openUnavailable() {
      deps.unavailableModal.hidden = false;
      updateBodyLock();
    }

    function closeUnavailable() {
      deps.unavailableModal.hidden = true;
      updateBodyLock();
    }

    function close() {
      deps.video.pause();
      deps.video.removeAttribute('src');
      deps.video.load();
      previewVersions = [];
      previewVersionIndex = 0;
      deps.previewModal.hidden = true;
      updateBodyLock();
    }

    function selectVersion(index) {
      if (!previewVersions.length) return false;
      previewVersionIndex = (index + previewVersions.length) % previewVersions.length;
      const version = previewVersions[previewVersionIndex];
      deps.video.src = version.url;
      deps.video.load();
      deps.download.href = version.url;
      deps.download.download = version.filename || 'thinkcast-final.mp4';
      const multiple = previewVersions.length > 1;
      deps.previousButton.disabled = !multiple;
      deps.nextButton.disabled = !multiple;
      deps.count.hidden = !multiple;
      deps.count.textContent = `${previewVersionIndex + 1} / ${previewVersions.length}`;
      if (!deps.previewModal.hidden) play();
      return true;
    }

    function selectTab(button) {
      if (!button) return false;
      deps.previewMeta.querySelectorAll('.calendar-preview-tab').forEach(item => {
        item.setAttribute('aria-pressed', String(item === button));
      });
      const dialog = deps.previewModal.querySelector('.calendar-preview-dialog');
      const previewClass = deps.platformFormats[button.dataset.platform]?.className || 'preview-landscape';
      dialog.classList.remove('preview-landscape', 'preview-portrait', 'preview-feed');
      dialog.classList.add(previewClass);
      const entry = entries().find(item => item?.id === button.dataset.entryId);
      previewVersions = deps.contentVersions(entry);
      previewVersionIndex = Math.max(0, previewVersions.length - 1);
      return selectVersion(previewVersionIndex);
    }

    function open(groupId) {
      const source = entries();
      const anchor = source.find(entry => entry?.id === groupId);
      if (!anchor) return false;
      const identity = deps.contentIdentity(anchor);
      const group = source.filter(item => item?.start === anchor.start && deps.contentIdentity(item) === identity);
      const playable = group.filter(entry => deps.contentVersions(entry).length > 0);
      if (!playable.length) {
        openUnavailable();
        return false;
      }
      deps.title.textContent = anchor.title;
      deps.previewMeta.innerHTML = playable.map((entry, index) => {
        const platform = entry.extendedProps?.platform || 'youtube';
        return `<button class="calendar-preview-tab" type="button" data-entry-id="${deps.escapeHtml(entry.id)}" data-platform="${deps.escapeHtml(platform)}" aria-pressed="${index === 0}"><span class="calendar-platform" data-platform="${deps.escapeHtml(platform)}"></span><span>${deps.escapeHtml(deps.platformLabels[platform] || platform)} · 미배포</span></button>`;
      }).join('');
      selectTab(deps.previewMeta.querySelector('.calendar-preview-tab'));
      deps.previewModal.hidden = false;
      updateBodyLock();
      play();
      return true;
    }

    function onMetaClick(event) {
      const button = event.target && typeof event.target.closest === 'function'
        ? event.target.closest('.calendar-preview-tab')
        : null;
      if (button) selectTab(button);
    }
    function onPrevious() { selectVersion(previewVersionIndex - 1); }
    function onNext() { selectVersion(previewVersionIndex + 1); }
    function onPreviewBackdrop(event) { if (event.target === deps.previewModal) close(); }
    function onUnavailableBackdrop(event) { if (event.target === deps.unavailableModal) closeUnavailable(); }
    function onKeydown(event) {
      if (event.key !== 'Escape') return;
      if (!deps.previewModal.hidden) close();
      else if (!deps.unavailableModal.hidden) closeUnavailable();
    }

    const listeners = Object.freeze([
      [deps.previewMeta, 'click', onMetaClick],
      [deps.previousButton, 'click', onPrevious],
      [deps.nextButton, 'click', onNext],
      [deps.previewCloseButton, 'click', close],
      [deps.previewModal, 'pointerdown', onPreviewBackdrop],
      [deps.unavailableCloseButton, 'click', closeUnavailable],
      [deps.unavailableModal, 'pointerdown', onUnavailableBackdrop],
      [deps.keyTarget, 'keydown', onKeydown]
    ]);

    function mount() {
      if (mounted) return true;
      listeners.forEach(([node, type, listener]) => node.addEventListener(type, listener));
      mounted = true;
      return true;
    }

    function unmount() {
      if (!mounted) return false;
      listeners.forEach(([node, type, listener]) => node.removeEventListener(type, listener));
      close();
      closeUnavailable();
      mounted = false;
      return true;
    }

    return Object.freeze({mount, unmount, open, close, selectTab, selectVersion, openUnavailable, closeUnavailable});
  }

  return Object.freeze({create});
});
