(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Step05CalendarDragController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const TIMESTAMP_KEYS = Object.freeze([
    'createdAt',
    'scheduledAt',
    'distributedAt',
    'deletedAt'
  ]);

  function create(dependencies) {
    const deps = dependencies || {};
    const requiredFunctions = [
      'getEntries',
      'setEntries',
      'save',
      'render',
      'setHelp',
      'contentIdentity',
      'collapseDuplicates',
      'nextDateKey',
      'shiftTimestampDate',
      'dateKey',
      'setTimer',
      'clearTimer'
    ];
    if (!deps.grid || typeof deps.grid.addEventListener !== 'function' || typeof deps.grid.removeEventListener !== 'function') {
      throw new TypeError('Step05CalendarDragController requires grid');
    }
    requiredFunctions.forEach(name => {
      if (typeof deps[name] !== 'function') {
        throw new TypeError(`Step05CalendarDragController requires ${name}`);
      }
    });

    let mounted = false;
    let draggingGroupId = null;
    let didDrag = false;
    let resetTimer = null;
    let resetGeneration = 0;

    function validDateKey(value) {
      if (!DATE_PATTERN.test(value || '')) return false;
      const parsed = new Date(`${value}T12:00:00`);
      return !Number.isNaN(parsed.getTime()) && deps.dateKey(parsed) === value;
    }

    function moveGroupToDate(groupId, nextDate, nextMinute = null) {
      if (!validDateKey(nextDate)) return false;
      const entries = deps.getEntries();
      if (!Array.isArray(entries)) throw new TypeError('calendar entries must be an array');
      const anchor = entries.find(item => item?.id === groupId);
      if (!anchor || (anchor.start === nextDate && !Number.isFinite(nextMinute))) return false;
      const previousDate = anchor.start;
      const identity = deps.contentIdentity(anchor);
      const moved = entries.map(item => {
        if (item?.start !== previousDate || deps.contentIdentity(item) !== identity) return item;
        const extendedProps = {...(item.extendedProps || {})};
        TIMESTAMP_KEYS.forEach(key => {
          if (extendedProps[key]) extendedProps[key] = deps.shiftTimestampDate(extendedProps[key], nextDate);
        });
        if (Number.isFinite(nextMinute)) {
          const status = extendedProps.status || 'draft';
          const timeKey = status === 'published'
            ? 'distributedAt'
            : status === 'scheduled'
              ? 'scheduledAt'
              : status === 'deleted'
                ? 'deletedAt'
                : 'createdAt';
          const hour = String(Math.floor(nextMinute / 60)).padStart(2, '0');
          const minute = String(nextMinute % 60).padStart(2, '0');
          extendedProps[timeKey] = `${nextDate}T${hour}:${minute}:00+09:00`;
        }
        return {...item, start: nextDate, end: deps.nextDateKey(nextDate), extendedProps};
      });
      deps.setEntries(deps.collapseDuplicates(moved));
      deps.save();
      deps.render({preserveScroll: true});
      const movedTime = Number.isFinite(nextMinute)
        ? ` ${String(Math.floor(nextMinute / 60)).padStart(2, '0')}:${String(nextMinute % 60).padStart(2, '0')}`
        : '';
      deps.setHelp(`${anchor.title} 스티커를 ${nextDate}${movedTime}로 이동했습니다.`);
      return true;
    }

    function dropMinute(event, column) {
      const rect = column.getBoundingClientRect();
      const raw = (event.clientY - rect.top) * 60 / 52;
      return Math.max(0, Math.min(1410, Math.round(raw / 30) * 30));
    }

    function clearDropTargets() {
      deps.grid.querySelectorAll('.drop-target').forEach(item => {
        clearTarget(item);
      });
    }

    function clearTarget(target) {
      target.classList.remove('drop-target');
      target.style.removeProperty('--drop-top');
      delete target.dataset.dropTime;
    }

    function cancelResetTimer() {
      resetGeneration += 1;
      if (resetTimer === null) return;
      deps.clearTimer(resetTimer);
      resetTimer = null;
    }

    function closest(event, selector) {
      return event.target && typeof event.target.closest === 'function'
        ? event.target.closest(selector)
        : null;
    }

    function onDragStart(event) {
      const sticker = closest(event, '.calendar-sticker');
      if (!sticker) return;
      cancelResetTimer();
      draggingGroupId = sticker.dataset.groupId;
      didDrag = true;
      sticker.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggingGroupId);
    }

    function onDragOver(event) {
      const target = closest(event, '.calendar-day,.calendar-time-column');
      if (!target || !draggingGroupId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      deps.grid.querySelectorAll('.drop-target').forEach(item => {
        if (item !== target) clearTarget(item);
      });
      target.classList.add('drop-target');
      if (target.classList.contains('calendar-time-column')) {
        const minute = dropMinute(event, target);
        target.style.setProperty('--drop-top', `${(minute * 52 / 60).toFixed(1)}px`);
        target.dataset.dropTime = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      }
    }

    function onDragLeave(event) {
      const target = closest(event, '.calendar-day,.calendar-time-column');
      if (target && !target.contains(event.relatedTarget)) {
        clearTarget(target);
      }
    }

    function onDrop(event) {
      const target = closest(event, '.calendar-day,.calendar-time-column');
      if (!target) return;
      event.preventDefault();
      const groupId = draggingGroupId || event.dataTransfer.getData('text/plain');
      const minute = target.classList.contains('calendar-time-column')
        ? dropMinute(event, target)
        : null;
      moveGroupToDate(groupId, target.dataset.date, minute);
    }

    function onDragEnd(event) {
      closest(event, '.calendar-sticker')?.classList.remove('dragging');
      clearDropTargets();
      draggingGroupId = null;
      cancelResetTimer();
      const generation = resetGeneration;
      resetTimer = deps.setTimer(() => {
        if (generation !== resetGeneration) return;
        didDrag = false;
        resetTimer = null;
      }, 100);
    }

    const listeners = Object.freeze({
      dragstart: onDragStart,
      dragover: onDragOver,
      dragleave: onDragLeave,
      drop: onDrop,
      dragend: onDragEnd
    });

    function mount() {
      if (mounted) return true;
      Object.entries(listeners).forEach(([type, listener]) => deps.grid.addEventListener(type, listener));
      mounted = true;
      return true;
    }

    function unmount() {
      if (!mounted) return false;
      Object.entries(listeners).forEach(([type, listener]) => deps.grid.removeEventListener(type, listener));
      cancelResetTimer();
      clearDropTargets();
      draggingGroupId = null;
      didDrag = false;
      mounted = false;
      return true;
    }

    function consumeDidDrag() {
      if (!didDrag) return false;
      didDrag = false;
      return true;
    }

    return Object.freeze({
      mount,
      unmount,
      consumeDidDrag,
      moveGroupToDate,
      dropMinute,
      clearDropTargets
    });
  }

  return Object.freeze({create});
});
