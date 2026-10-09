(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Step05CalendarViewController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VIEWS = Object.freeze(['month', 'week', 'day']);

  function create(dependencies) {
    const deps = dependencies || {};
    if (!deps.storage || typeof deps.storage.getItem !== 'function' || typeof deps.storage.setItem !== 'function') throw new TypeError('Step05CalendarViewController requires storage');
    if (typeof deps.storageKey !== 'string' || !deps.storageKey) throw new TypeError('Step05CalendarViewController requires storageKey');
    if (typeof deps.now !== 'function') throw new TypeError('Step05CalendarViewController requires now');
    if (typeof deps.isDateKey !== 'function') throw new TypeError('Step05CalendarViewController requires isDateKey');
    if (typeof deps.dateKey !== 'function') throw new TypeError('Step05CalendarViewController requires dateKey');
    let view = 'month';
    let cursor = new Date(deps.now());

    function parseDateKey(value) {
      if (!deps.isDateKey(value)) return null;
      const parsed = new Date(`${value}T12:00:00`);
      return !Number.isNaN(parsed.getTime()) && deps.dateKey(parsed) === value ? parsed : null;
    }
    function snapshot() { return Object.freeze({view, cursor: new Date(cursor)}); }
    function save() {
      try {
        deps.storage.setItem(deps.storageKey, JSON.stringify({view, cursor: deps.dateKey(cursor)}));
        return {ok: true, error: null};
      } catch (error) {
        return {ok: false, error};
      }
    }
    function load() {
      let error = null;
      try {
        const saved = JSON.parse(deps.storage.getItem(deps.storageKey) || 'null') || {};
        if (VIEWS.includes(saved.view)) view = saved.view;
        const restoredCursor = parseDateKey(saved.cursor);
        if (restoredCursor) cursor = restoredCursor;
      } catch (cause) {
        error = cause;
      }
      return {snapshot: snapshot(), error};
    }
    function move(direction) {
      const amount = Number(direction);
      if (view === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + amount, 1);
      else {
        const next = new Date(cursor);
        next.setDate(next.getDate() + amount * (view === 'week' ? 7 : 1));
        cursor = next;
      }
      return snapshot();
    }
    function selectView(nextView) {
      if (!VIEWS.includes(nextView)) return snapshot();
      view = nextView;
      if (view === 'day') cursor = new Date(deps.now());
      return snapshot();
    }
    function selectDate(value) {
      const selected = parseDateKey(value);
      if (!selected) return snapshot();
      cursor = selected;
      view = 'day';
      return snapshot();
    }
    function setCursor(value) {
      const selected = parseDateKey(value);
      if (selected) cursor = selected;
      return snapshot();
    }

    return Object.freeze({snapshot, load, save, move, selectView, selectDate, setCursor});
  }

  return Object.freeze({create, VIEWS});
});
