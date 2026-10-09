(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Step05CalendarDataController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(dependencies) {
    const deps = dependencies || {};
    if (!deps.store || ['load', 'hydrate', 'save'].some(name => typeof deps.store[name] !== 'function')) {
      throw new TypeError('Step05CalendarDataController requires store');
    }
    ['getEntries', 'setEntries', 'render'].forEach(name => {
      if (typeof deps[name] !== 'function') throw new TypeError(`Step05CalendarDataController requires ${name}`);
    });

    function load() {
      const result = deps.store.load();
      deps.setEntries(result.entries);
      return result;
    }

    async function hydrate() {
      const currentEntries = deps.getEntries();
      const result = await deps.store.hydrate(currentEntries);
      deps.setEntries(result.entries);
      deps.render({preserveScroll: true});
      return result;
    }

    function save() {
      return deps.store.save(deps.getEntries());
    }

    return Object.freeze({load, hydrate, save});
  }

  return Object.freeze({create});
});
