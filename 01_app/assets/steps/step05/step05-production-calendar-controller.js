(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Step05ProductionCalendarController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(dependencies) {
    const deps = dependencies || {};
    const requiredFunctions = [
      'getEntries', 'setEntries', 'getActiveProjectId', 'getTitle', 'getSelectedPlatforms',
      'getPreviewPlatform', 'calendarContentVersions', 'collapseDuplicates', 'nextDateKey',
      'dateKey', 'createId', 'now', 'save', 'render', 'refresh', 'onError'
    ];
    requiredFunctions.forEach(name => {
      if (typeof deps[name] !== 'function') throw new TypeError(`Step05ProductionCalendarController requires ${name}`);
    });

    function targets() {
      const selected = deps.getSelectedPlatforms();
      const selectedValues = selected && typeof selected[Symbol.iterator] === 'function' ? [...selected] : [];
      const source = selectedValues.length
        ? selectedValues
        : [deps.getPreviewPlatform()];
      const seen = new Set();
      return source.reduce((values, item) => {
        const platform = String(item || '').trim();
        if (platform && !seen.has(platform)) {
          seen.add(platform);
          values.push(platform);
        }
        return values;
      }, []);
    }

    function exportFor(result, platform) {
      const matched = (Array.isArray(result?.exports) ? result.exports : []).find(item => (
        item?.platform === platform
        || (Array.isArray(item?.platforms) && item.platforms.includes(platform))
      ));
      return {
        url: matched?.url || result?.url || null,
        filename: matched?.filename || result?.filename || null
      };
    }

    function record(result) {
      const projectId = String(deps.getActiveProjectId() || '').trim();
      if (!projectId) return false;
      const targetPlatforms = targets();
      if (!targetPlatforms.length) return false;
      const current = deps.now();
      const nowIso = current.toISOString();
      const start = deps.dateKey(current);
      const title = String(deps.getTitle() || '').trim() || '그린힐 콘텐츠';
      const existingEntries = deps.getEntries();
      if (!Array.isArray(existingEntries)) throw new TypeError('calendar entries must be an array');
      let nextEntries = deps.collapseDuplicates(existingEntries).map(item => ({
        ...item,
        extendedProps: {...(item.extendedProps || {})}
      }));

      targetPlatforms.forEach(platform => {
        const artifact = exportFor(result, platform);
        const index = nextEntries.findIndex(item => (
          item.start === start
          && item.extendedProps?.projectId === projectId
          && item.extendedProps?.platform === platform
        ));
        if (index >= 0) {
          const existing = nextEntries[index];
          const extendedProps = {...existing.extendedProps};
          const versions = deps.calendarContentVersions(existing).map(version => ({...version}));
          if (artifact.url && !versions.some(version => version.url === artifact.url)) {
            versions.push({url: artifact.url, filename: artifact.filename, createdAt: nowIso});
          }
          extendedProps.status = 'draft';
          extendedProps.projectId = projectId;
          extendedProps.platform = platform;
          extendedProps.createdAt = extendedProps.createdAt || nowIso;
          extendedProps.updatedAt = nowIso;
          extendedProps.contentVersions = versions;
          if (artifact.url) {
            extendedProps.contentUrl = artifact.url;
            extendedProps.filename = artifact.filename;
          }
          nextEntries[index] = {...existing, title, extendedProps};
        } else {
          nextEntries.push({
            id: deps.createId(),
            title,
            start,
            end: deps.nextDateKey(start),
            allDay: true,
            extendedProps: {
              status: 'draft',
              platform,
              projectId,
              createdAt: nowIso,
              updatedAt: nowIso,
              distributedAt: null,
              contentUrl: artifact.url,
              filename: artifact.filename,
              contentVersions: artifact.url
                ? [{url: artifact.url, filename: artifact.filename, createdAt: nowIso}]
                : []
            }
          });
        }
      });

      nextEntries = deps.collapseDuplicates(nextEntries);
      deps.setEntries(nextEntries);
      deps.save();
      deps.render();
      const refreshResult = deps.refresh();
      if (refreshResult && typeof refreshResult.catch === 'function') {
        refreshResult.catch(error => deps.onError('refresh', error));
      }
      return true;
    }

    return Object.freeze({record});
  }

  return Object.freeze({create});
});
