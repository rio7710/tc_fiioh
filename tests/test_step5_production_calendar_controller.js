const assert = require('node:assert/strict');
const ProductionCalendar = require('../01_app/assets/steps/step05/step05-production-calendar-controller.js');
const Calendar = require('../01_app/assets/steps/step05/step05-calendar.js');

const FIXED_NOW = new Date('2026-10-09T01:02:03.000Z');

function existing(id, projectId, platform, extra = {}) {
  return {
    id,
    title: '기존 제목',
    start: '2026-10-09',
    end: '2026-10-10',
    allDay: true,
    extendedProps: {
      projectId,
      platform,
      status: 'published',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      contentUrl: '/old.mp4',
      filename: 'old.mp4',
      contentVersions: [{url: '/old.mp4', filename: 'old.mp4', createdAt: '2026-10-01T00:00:00.000Z'}],
      ...extra
    }
  };
}

function harness(options = {}) {
  let entries = options.entries || [];
  const original = entries;
  const calls = [];
  let id = 0;
  const errors = [];
  const controller = ProductionCalendar.create({
    getEntries: () => entries,
    setEntries(value) { entries = value; calls.push('set'); },
    getActiveProjectId: () => options.projectId === undefined ? 'project-a' : options.projectId,
    getTitle: () => options.title === undefined ? ' 새 제목 ' : options.title,
    getSelectedPlatforms: () => options.selected === undefined ? new Set(['youtube']) : options.selected,
    getPreviewPlatform: () => options.preview === undefined ? 'instagram' : options.preview,
    calendarContentVersions: Calendar.calendarContentVersions,
    collapseDuplicates: Calendar.collapseDuplicates,
    nextDateKey: Calendar.nextDateKey,
    dateKey: Calendar.dateKey,
    createId: () => `new-${++id}`,
    now: () => FIXED_NOW,
    save() { calls.push('save'); if (options.saveError) throw options.saveError; },
    render() { calls.push('render'); if (options.renderError) throw options.renderError; },
    refresh() { calls.push('refresh'); return options.refreshResult; },
    onError(feature, error) { errors.push([feature, error]); }
  });
  return {controller, calls, errors, original, entries: () => entries};
}

assert.throws(() => ProductionCalendar.create({}), /requires getEntries/);

const noProject = harness({projectId: ''});
assert.equal(noProject.controller.record({url: '/new.mp4'}), false);
assert.deepEqual(noProject.calls, []);
const noTarget = harness({selected: [], preview: ''});
assert.equal(noTarget.controller.record({url: '/new.mp4'}), false);
assert.deepEqual(noTarget.calls, []);

const selected = harness({selected: ['youtube', '', 'youtube', 'instagram']});
assert.equal(selected.controller.record({
  exports: [
    {platform: 'youtube', url: '/youtube.mp4', filename: 'youtube.mp4'},
    {platforms: ['instagram', 'threads'], url: '/vertical.mp4', filename: 'vertical.mp4'}
  ]
}), true);
assert.deepEqual(selected.entries().map(item => item.extendedProps.platform), ['youtube', 'instagram']);
assert.deepEqual(selected.entries().map(item => item.extendedProps.contentUrl), ['/youtube.mp4', '/vertical.mp4']);
assert.notEqual(selected.entries(), selected.original);
assert.deepEqual(selected.calls, ['set', 'save', 'render', 'refresh']);

const fallback = harness({selected: new Set(), preview: 'facebook', title: '   '});
fallback.controller.record({url: '/fallback.mp4', filename: 'fallback.mp4'});
assert.equal(fallback.entries()[0].extendedProps.platform, 'facebook');
assert.equal(fallback.entries()[0].title, '그린힐 콘텐츠');
assert.equal(fallback.entries()[0].extendedProps.createdAt, FIXED_NOW.toISOString());
assert.equal(fallback.entries()[0].extendedProps.updatedAt, FIXED_NOW.toISOString());
assert.equal(fallback.entries()[0].extendedProps.distributedAt, null);

const oldEntry = existing('existing', 'project-a', 'youtube');
const update = harness({entries: [oldEntry]});
update.controller.record({url: '/new.mp4', filename: 'new.mp4'});
const updated = update.entries()[0];
assert.equal(oldEntry.extendedProps.status, 'published', 'input entry is not mutated');
assert.equal(updated.extendedProps.status, 'draft');
assert.equal(updated.extendedProps.createdAt, '2026-10-01T00:00:00.000Z', 'original content creation time is preserved');
assert.equal(updated.extendedProps.updatedAt, FIXED_NOW.toISOString());
assert.equal(updated.extendedProps.contentUrl, '/new.mp4');
assert.equal(updated.extendedProps.filename, 'new.mp4');
assert.deepEqual(updated.extendedProps.contentVersions.map(item => item.url), ['/old.mp4', '/new.mp4']);
assert.equal(updated.extendedProps.contentVersions[1].createdAt, FIXED_NOW.toISOString());

const dedupeVersion = harness({entries: [existing('existing', 'project-a', 'youtube')]});
dedupeVersion.controller.record({url: '/old.mp4', filename: 'renamed.mp4'});
assert.equal(dedupeVersion.entries()[0].extendedProps.contentVersions.length, 1);
assert.equal(dedupeVersion.entries()[0].extendedProps.contentUrl, '/old.mp4');
assert.equal(dedupeVersion.entries()[0].extendedProps.filename, 'renamed.mp4');
const missingUrl = harness({entries: [existing('existing', 'project-a', 'youtube')]});
missingUrl.controller.record({filename: 'ignored.mp4'});
assert.equal(missingUrl.entries()[0].extendedProps.contentUrl, '/old.mp4');
assert.equal(missingUrl.entries()[0].extendedProps.filename, 'old.mp4');

const duplicateOld = existing('duplicate-old', 'project-a', 'youtube', {updatedAt: '2026-10-01T00:00:00.000Z'});
const duplicateNew = existing('duplicate-new', 'project-a', 'youtube', {updatedAt: '2026-10-02T00:00:00.000Z'});
const collapse = harness({entries: [duplicateOld, duplicateNew]});
collapse.controller.record({url: '/latest.mp4'});
assert.equal(collapse.entries().length, 1, 'legacy uniqueness duplicates collapse immediately');
assert.equal(collapse.entries()[0].id, 'duplicate-new');

const saveError = new Error('save failed');
const saveFailure = harness({saveError});
assert.throws(() => saveFailure.controller.record({url: '/new.mp4'}), saveError);
assert.deepEqual(saveFailure.calls, ['set', 'save']);
const renderError = new Error('render failed');
const renderFailure = harness({renderError});
assert.throws(() => renderFailure.controller.record({url: '/new.mp4'}), renderError);
assert.deepEqual(renderFailure.calls, ['set', 'save', 'render']);

const refreshError = new Error('refresh failed');
const refreshFailure = harness({refreshResult: Promise.reject(refreshError)});
assert.equal(refreshFailure.controller.record({url: '/new.mp4'}), true);
setImmediate(() => {
  assert.deepEqual(refreshFailure.errors, [['refresh', refreshError]]);
  console.log('Step 5 production calendar controller tests passed.');
});
