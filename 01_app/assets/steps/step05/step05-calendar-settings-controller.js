(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Step05CalendarSettingsController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(dependencies) {
    const deps = dependencies || {};
    const eventNodes = ['grid', 'modal', 'cancelButton', 'saveButton', 'keyTarget'];
    eventNodes.forEach(name => {
      const node = deps[name];
      if (!node || typeof node.addEventListener !== 'function' || typeof node.removeEventListener !== 'function') {
        throw new TypeError(`Step05CalendarSettingsController requires ${name}`);
      }
    });
    ['title', 'dateInput', 'platforms'].forEach(name => {
      if (!deps[name] || typeof deps[name] !== 'object') throw new TypeError(`Step05CalendarSettingsController requires ${name}`);
    });
    if (!deps.body?.classList || typeof deps.body.classList.add !== 'function' || typeof deps.body.classList.remove !== 'function') {
      throw new TypeError('Step05CalendarSettingsController requires body');
    }
    const requiredFunctions = [
      'getEntries', 'setEntries', 'contentIdentity', 'nextDateKey', 'timeInputValue',
      'escapeHtml', 'setCursor', 'saveEntries', 'render', 'setHelp', 'setTimer', 'clearTimer'
    ];
    requiredFunctions.forEach(name => {
      if (typeof deps[name] !== 'function') throw new TypeError(`Step05CalendarSettingsController requires ${name}`);
    });
    if (!deps.statusLabels || typeof deps.statusLabels !== 'object') throw new TypeError('Step05CalendarSettingsController requires statusLabels');
    if (!deps.platformLabels || typeof deps.platformLabels !== 'object') throw new TypeError('Step05CalendarSettingsController requires platformLabels');

    let mounted = false;
    let activeIds = [];
    let longPressTimer = null;
    let longPressPoint = null;
    let longPressOpened = false;

    function entries() {
      const value = deps.getEntries();
      if (!Array.isArray(value)) throw new TypeError('calendar entries must be an array');
      return value;
    }

    function getActiveEntries() {
      const ids = new Set(activeIds);
      return entries().filter(item => ids.has(item?.id));
    }

    function clearLongPressTimer() {
      if (longPressTimer !== null) deps.clearTimer(longPressTimer);
      longPressTimer = null;
      longPressPoint = null;
    }

    function close() {
      deps.modal.hidden = true;
      activeIds = [];
      deps.body.classList.remove('modal-open');
    }

    function open(groupId) {
      const source = entries();
      const anchor = source.find(entry => entry?.id === groupId);
      if (!anchor) return false;
      const identity = deps.contentIdentity(anchor);
      const group = source.filter(item => item?.start === anchor.start && deps.contentIdentity(item) === identity);
      activeIds = group.map(item => item.id);
      deps.title.textContent = anchor.title;
      deps.dateInput.value = anchor.start;
      deps.platforms.innerHTML = group.map(item => {
        const platform = item.extendedProps?.platform || 'youtube';
        const status = item.extendedProps?.status || 'draft';
        const label = deps.platformLabels[platform] || platform;
        const options = Object.entries(deps.statusLabels).map(([value, optionLabel]) => (
          `<option value="${value}" ${value === status ? 'selected' : ''}>${optionLabel}</option>`
        )).join('');
        return `<div class="calendar-setting-row" data-event-id="${deps.escapeHtml(item.id)}"><span class="calendar-platform" data-platform="${platform}"></span><strong>${label}</strong><select aria-label="${label} 상태">${options}</select><input type="time" value="${deps.timeInputValue(item)}" aria-label="${label} 상태 시간"></div>`;
      }).join('');
      deps.modal.hidden = false;
      deps.body.classList.add('modal-open');
      deps.dateInput.focus();
      return true;
    }

    function save() {
      const nextDate = deps.dateInput.value;
      if (!nextDate) return false;
      const rows = deps.platforms.querySelectorAll('.calendar-setting-row');
      const rowValues = new Map();
      rows.forEach(row => {
        rowValues.set(row.dataset.eventId, {
          status: row.querySelector('select').value,
          time: row.querySelector('input[type="time"]').value || '09:00'
        });
      });
      const ids = new Set(activeIds);
      const updated = entries().map(item => {
        if (!ids.has(item?.id) || !rowValues.has(item.id)) return item;
        const value = rowValues.get(item.id);
        const timestamp = `${nextDate}T${value.time}:00+09:00`;
        const extendedProps = {...(item.extendedProps || {}), status: value.status};
        if (value.status === 'draft') extendedProps.createdAt = timestamp;
        if (value.status === 'scheduled') extendedProps.scheduledAt = timestamp;
        if (value.status === 'published') extendedProps.distributedAt = timestamp;
        if (value.status === 'deleted') extendedProps.deletedAt = timestamp;
        return {...item, start: nextDate, end: deps.nextDateKey(nextDate), extendedProps};
      });
      deps.setEntries(updated);
      deps.setCursor(nextDate);
      deps.saveEntries();
      close();
      deps.render();
      deps.setHelp('스티커의 날짜와 플랫폼별 파이프라인 시간을 저장했습니다.');
      return true;
    }

    function closestSticker(event) {
      return event.target && typeof event.target.closest === 'function'
        ? event.target.closest('.calendar-sticker')
        : null;
    }

    function onContextMenu(event) {
      const sticker = closestSticker(event);
      if (!sticker) return;
      event.preventDefault();
      event.stopPropagation();
      open(sticker.dataset.groupId);
    }

    function onPointerDown(event) {
      const sticker = closestSticker(event);
      if (!sticker || event.pointerType === 'mouse') return;
      clearLongPressTimer();
      longPressPoint = {x: event.clientX, y: event.clientY};
      longPressTimer = deps.setTimer(() => {
        longPressOpened = true;
        open(sticker.dataset.groupId);
        longPressTimer = null;
        longPressPoint = null;
      }, 600);
    }

    function onPointerMove(event) {
      if (longPressTimer === null || !longPressPoint) return;
      if (Math.hypot(event.clientX - longPressPoint.x, event.clientY - longPressPoint.y) > 8) {
        clearLongPressTimer();
      }
    }

    function onPointerEnd() {
      clearLongPressTimer();
    }

    function onCancel() { close(); }
    function onSave() { save(); }
    function onBackdrop(event) { if (event.target === deps.modal) close(); }
    function onKeydown(event) { if (event.key === 'Escape' && !deps.modal.hidden) close(); }

    const listeners = Object.freeze([
      [deps.grid, 'contextmenu', onContextMenu],
      [deps.grid, 'pointerdown', onPointerDown],
      [deps.grid, 'pointermove', onPointerMove],
      [deps.grid, 'pointerup', onPointerEnd],
      [deps.grid, 'pointercancel', onPointerEnd],
      [deps.cancelButton, 'click', onCancel],
      [deps.saveButton, 'click', onSave],
      [deps.modal, 'pointerdown', onBackdrop],
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
      clearLongPressTimer();
      longPressOpened = false;
      mounted = false;
      return true;
    }

    function consumeLongPressOpened() {
      if (!longPressOpened) return false;
      longPressOpened = false;
      return true;
    }

    return Object.freeze({mount, unmount, open, close, save, getActiveEntries, consumeLongPressOpened});
  }

  return Object.freeze({create});
});
