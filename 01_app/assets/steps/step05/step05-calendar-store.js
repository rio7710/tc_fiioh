(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Step05CalendarStore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(dependencies) {
    const deps = dependencies || {};
    if (!deps.storage || typeof deps.storage.getItem !== 'function' || typeof deps.storage.setItem !== 'function') {
      throw new TypeError('Step05CalendarStore requires storage');
    }
    if (typeof deps.storageKey !== 'string' || !deps.storageKey) {
      throw new TypeError('Step05CalendarStore requires storageKey');
    }
    for (const name of ['request', 'collapseDuplicates', 'uniquenessKey']) {
      if (typeof deps[name] !== 'function') throw new TypeError(`Step05CalendarStore requires ${name}`);
    }

    function save(entries) {
      try {
        deps.storage.setItem(deps.storageKey, JSON.stringify(entries));
        return {ok: true, error: null};
      } catch (error) {
        return {ok: false, error};
      }
    }

    function load() {
      let entries = [];
      let error = null;
      try {
        const saved = JSON.parse(deps.storage.getItem(deps.storageKey) || 'null');
        entries = Array.isArray(saved)
          ? saved.filter(item => !String(item?.id || '').startsWith('demo-'))
          : [];
      } catch (cause) {
        error = cause;
      }
      entries = deps.collapseDuplicates(entries);
      const saved = save(entries);
      return {entries, error: error || saved.error, save: saved};
    }

    async function hydrate(localEntries) {
      const result = await deps.request('/api/calendar');
      const serverEntries = deps.collapseDuplicates(Array.isArray(result.entries) ? result.entries : []);
      const serverLegacyKeys = new Set(serverEntries.map(item => {
        const props = item.extendedProps || {};
        return `${item.start}\u0000${item.title}\u0000${props.platform || 'youtube'}`;
      }));
      const retainedLocalEntries = deps.collapseDuplicates(Array.isArray(localEntries) ? localEntries : [])
        .filter(item => {
          const props = item.extendedProps || {};
          const legacyKey = `${item.start}\u0000${item.title}\u0000${props.platform || 'youtube'}`;
          return props.projectId || !serverLegacyKeys.has(legacyKey);
        });
      const merged = new Map();
      retainedLocalEntries.forEach(item => merged.set(deps.uniquenessKey(item), item));
      serverEntries.forEach(item => merged.set(deps.uniquenessKey(item), item));
      const entries = [...merged.values()];
      const saved = save(entries);
      return {entries, error: saved.error, save: saved};
    }

    return Object.freeze({load, save, hydrate});
  }

  return Object.freeze({create});
});
