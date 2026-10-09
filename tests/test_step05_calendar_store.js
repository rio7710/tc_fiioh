const assert = require('node:assert/strict');
const Calendar = require('../01_app/assets/steps/step05/step05-calendar.js');
const Store = require('../01_app/assets/steps/step05/step05-calendar-store.js');

(async () => {
  const entry = (id, projectId, title = 'Title', platform = 'youtube', updatedAt = null) => ({
    id,
    title,
    start: '2026-10-09',
    extendedProps: {projectId, platform, updatedAt}
  });
  let saved = null;
  let requestResult = {entries: []};
  const storage = {
    getItem: () => saved,
    setItem: (key, value) => { saved = value; }
  };
  const store = Store.create({
    storage,
    storageKey: 'calendar',
    request: async path => {
      assert.equal(path, '/api/calendar');
      return requestResult;
    },
    collapseDuplicates: Calendar.collapseDuplicates,
    uniquenessKey: Calendar.uniquenessKey
  });

  assert.equal(Object.isFrozen(store), true);
  assert.throws(() => Store.create(), /requires storage/);
  assert.throws(() => Store.create({storage, storageKey: 'calendar'}), /requires request/);

  saved = JSON.stringify([
    entry('demo-1', 'p0'),
    entry('old', 'p1', 'Title', 'youtube', '2026-10-09T09:00:00+09:00'),
    entry('new', 'p1', 'Title', 'youtube', '2026-10-09T10:00:00+09:00'),
    entry('other-platform', 'p1', 'Title', 'instagram')
  ]);
  let loaded = store.load();
  assert.deepEqual(loaded.entries.map(item => item.id), ['new', 'other-platform']);
  assert.equal(loaded.error, null);
  assert.deepEqual(JSON.parse(saved).map(item => item.id), ['new', 'other-platform']);

  saved = '{bad';
  loaded = store.load();
  assert.deepEqual(loaded.entries, []);
  assert.ok(loaded.error instanceof Error);

  const broken = Store.create({
    storage: {getItem: () => null, setItem() { throw new Error('quota'); }},
    storageKey: 'calendar',
    request: async () => ({entries: []}),
    collapseDuplicates: Calendar.collapseDuplicates,
    uniquenessKey: Calendar.uniquenessKey
  });
  const failed = broken.load();
  assert.deepEqual(failed.entries, []);
  assert.equal(failed.save.ok, false);
  assert.match(failed.error.message, /quota/);

  const localProject = entry('local-project', 'p1', 'Title', 'youtube', '2026-10-09T11:00:00+09:00');
  const localLegacy = entry('local-legacy', null, 'Legacy');
  const serverLegacy = entry('server-legacy', null, 'Legacy');
  const serverOld = entry('server-old', 'p1', 'Title', 'youtube', '2026-10-09T08:00:00+09:00');
  const serverNew = entry('server-new', 'p1', 'Title', 'youtube', '2026-10-09T09:00:00+09:00');
  requestResult = {entries: [serverLegacy, serverOld, serverNew]};
  const hydrated = await store.hydrate([localProject, localLegacy]);
  assert.deepEqual(hydrated.entries.map(item => item.id), ['server-new', 'server-legacy']);
  assert.deepEqual(JSON.parse(saved).map(item => item.id), ['server-new', 'server-legacy']);

  requestResult = {entries: null};
  assert.deepEqual((await store.hydrate([localProject])).entries, [localProject]);
  const rejecting = Store.create({
    storage,
    storageKey: 'calendar',
    request: async () => { throw new Error('offline'); },
    collapseDuplicates: Calendar.collapseDuplicates,
    uniquenessKey: Calendar.uniquenessKey
  });
  await assert.rejects(() => rejecting.hydrate([]), /offline/);

  console.log('Step05 calendar store tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
