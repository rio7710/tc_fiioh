const assert = require('node:assert/strict');
const DragController = require('../01_app/assets/steps/step05/step05-calendar-drag-controller.js');
const Calendar = require('../01_app/assets/steps/step05/step05-calendar.js');

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add: value => values.add(value),
    remove: value => values.delete(value),
    contains: value => values.has(value),
    toggle(value, force) {
      if (force) values.add(value);
      else values.delete(value);
    },
    has: value => values.has(value)
  };
}

function element(classes, dataset = {}) {
  const styles = new Map();
  const node = {
    dataset: {...dataset},
    classList: classList(classes),
    style: {
      setProperty: (key, value) => styles.set(key, value),
      removeProperty: key => styles.delete(key),
      get: key => styles.get(key)
    },
    contains: value => value === node,
    getBoundingClientRect: () => ({top: 100})
  };
  return node;
}

function gridFixture() {
  const listeners = new Map();
  const targets = [];
  return {
    listeners,
    targets,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    querySelectorAll(selector) {
      return selector === '.drop-target' ? targets.filter(target => target.classList.has('drop-target')) : [];
    },
    dispatch(type, event) {
      for (const listener of listeners.get(type) || []) listener(event);
    }
  };
}

function entry(id, projectId, title, platform, start, status = 'draft') {
  return {
    id,
    title,
    start,
    end: Calendar.nextDateKey(start),
    extendedProps: {
      projectId,
      platform,
      status,
      createdAt: `${start}T01:15:20Z`
    }
  };
}

function harness(sourceEntries) {
  const grid = gridFixture();
  let entries = sourceEntries;
  const calls = [];
  const timers = [];
  const clearedTimers = [];
  const controller = DragController.create({
    grid,
    getEntries: () => entries,
    setEntries(value) { entries = value; calls.push(['set', value]); },
    save() { calls.push(['save']); },
    render(options) { calls.push(['render', options]); },
    setHelp(text) { calls.push(['help', text]); },
    contentIdentity: Calendar.contentIdentity,
    collapseDuplicates: Calendar.collapseDuplicates,
    nextDateKey: Calendar.nextDateKey,
    shiftTimestampDate: Calendar.shiftTimestampDate,
    dateKey: Calendar.dateKey,
    setTimer(callback, delay) {
      const timer = {callback, delay};
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) { clearedTimers.push(timer); }
  });
  return {controller, grid, calls, timers, clearedTimers, entries: () => entries};
}

assert.throws(() => DragController.create({}), /requires grid/);
assert.throws(() => DragController.create({grid: gridFixture()}), /requires getEntries/);

const original = [
  entry('a-youtube', 'project-a', '같은 제목', 'youtube', '2026-10-09'),
  entry('a-instagram', 'project-a', '같은 제목', 'instagram', '2026-10-09', 'scheduled'),
  entry('b-youtube', 'project-b', '같은 제목', 'youtube', '2026-10-09')
];
const movement = harness(original);
assert.equal(movement.controller.moveGroupToDate('a-youtube', '2026-10-10', 570), true);
assert.deepEqual(
  movement.entries().filter(item => item.extendedProps.projectId === 'project-a').map(item => item.start),
  ['2026-10-10', '2026-10-10'],
  'all platforms for one content identity move together'
);
assert.equal(movement.entries().find(item => item.id === 'b-youtube').start, '2026-10-09', 'same-title other project remains unchanged');
assert.ok(movement.entries().filter(item => item.extendedProps.projectId === 'project-a').every(item => item.end === '2026-10-11'));
assert.equal(movement.entries().find(item => item.id === 'a-youtube').extendedProps.createdAt, '2026-10-10T09:30:00+09:00');
assert.equal(movement.entries().find(item => item.id === 'a-instagram').extendedProps.scheduledAt, '2026-10-10T09:30:00+09:00');
assert.deepEqual(movement.calls.slice(-3), [
  ['save'],
  ['render', {preserveScroll: true}],
  ['help', '같은 제목 스티커를 2026-10-10 09:30로 이동했습니다.']
]);
assert.equal(original[0].start, '2026-10-09', 'movement does not mutate input entries');

const duplicate = {...original[0], id: 'duplicate', extendedProps: {...original[0].extendedProps, updatedAt: '2026-10-09T12:00:00+09:00'}};
const unique = harness([...original, duplicate]);
unique.controller.moveGroupToDate('a-youtube', '2026-10-11');
assert.equal(unique.entries().filter(item => item.extendedProps.projectId === 'project-a' && item.extendedProps.platform === 'youtube').length, 1);

const invalid = harness(original);
assert.equal(invalid.controller.moveGroupToDate('missing', '2026-10-10'), false);
assert.equal(invalid.controller.moveGroupToDate('a-youtube', 'bad-date'), false);
assert.equal(invalid.controller.moveGroupToDate('a-youtube', '2026-02-31'), false);
assert.equal(invalid.controller.moveGroupToDate('a-youtube', '2026-10-09'), false);
assert.equal(invalid.calls.length, 0);

const minuteColumn = element(['calendar-time-column']);
assert.equal(invalid.controller.dropMinute({clientY: 75}, minuteColumn), 0);
assert.equal(invalid.controller.dropMinute({clientY: 126}, minuteColumn), 30);
assert.equal(invalid.controller.dropMinute({clientY: 5000}, minuteColumn), 1410);

const lifecycle = harness(original);
assert.equal(lifecycle.controller.mount(), true);
assert.equal(lifecycle.controller.mount(), true);
for (const type of ['dragstart', 'dragover', 'dragleave', 'drop', 'dragend']) {
  assert.equal(lifecycle.grid.listeners.get(type).size, 1, `${type} binds once`);
}
const sticker = element(['calendar-sticker'], {groupId: 'a-youtube'});
const day = element(['calendar-day'], {date: '2026-10-12'});
const column = element(['calendar-time-column'], {date: '2026-10-13'});
lifecycle.grid.targets.push(day, column);
const transfer = {
  value: '',
  effectAllowed: '',
  dropEffect: '',
  setData(type, value) { assert.equal(type, 'text/plain'); this.value = value; },
  getData() { return this.value; }
};
lifecycle.grid.dispatch('dragstart', {target: {closest: selector => selector === '.calendar-sticker' ? sticker : null}, dataTransfer: transfer});
assert.equal(sticker.classList.has('dragging'), true);
assert.equal(transfer.effectAllowed, 'move');
assert.equal(lifecycle.controller.consumeDidDrag(), true);
assert.equal(lifecycle.controller.consumeDidDrag(), false);
lifecycle.grid.dispatch('dragover', {
  target: {closest: () => column},
  clientY: 126,
  dataTransfer: transfer,
  preventDefault() {}
});
assert.equal(column.classList.has('drop-target'), true);
assert.equal(column.dataset.dropTime, '00:30');
assert.equal(column.style.get('--drop-top'), '26.0px');
const nextTarget = element(['calendar-day'], {date: '2026-10-14'});
lifecycle.grid.targets.push(nextTarget);
lifecycle.grid.dispatch('dragover', {
  target: {closest: () => nextTarget},
  dataTransfer: transfer,
  preventDefault() {}
});
assert.equal(column.classList.has('drop-target'), false, 'previous marker class is cleared');
assert.equal(column.style.get('--drop-top'), undefined, 'previous marker position is cleared');
assert.equal(column.dataset.dropTime, undefined, 'previous marker label is cleared');
lifecycle.grid.dispatch('dragleave', {
  target: {closest: () => nextTarget},
  relatedTarget: null
});
assert.equal(nextTarget.classList.has('drop-target'), false, 'dragleave clears its marker');
lifecycle.grid.dispatch('dragover', {
  target: {closest: () => column},
  clientY: 126,
  dataTransfer: transfer,
  preventDefault() {}
});
lifecycle.grid.dispatch('drop', {
  target: {closest: () => column},
  clientY: 126,
  dataTransfer: transfer,
  preventDefault() {}
});
lifecycle.grid.dispatch('dragend', {target: {closest: () => sticker}});
assert.equal(sticker.classList.has('dragging'), false);
assert.equal(column.classList.has('drop-target'), false);
assert.equal(lifecycle.timers[0].delay, 100);
lifecycle.timers[0].callback();
assert.equal(lifecycle.controller.consumeDidDrag(), false);
assert.equal(lifecycle.controller.unmount(), true);
assert.equal(lifecycle.controller.unmount(), false);
assert.equal(lifecycle.controller.mount(), true, 'controller remounts');

const timerLifecycle = harness(original);
timerLifecycle.controller.mount();
timerLifecycle.grid.dispatch('dragstart', {target: {closest: () => sticker}, dataTransfer: transfer});
timerLifecycle.grid.dispatch('dragend', {target: {closest: () => sticker}});
const oldTimer = timerLifecycle.timers[0];
timerLifecycle.controller.unmount();
assert.deepEqual(timerLifecycle.clearedTimers, [oldTimer], 'unmount cancels pending drag reset');
timerLifecycle.controller.mount();
timerLifecycle.grid.dispatch('dragstart', {target: {closest: () => sticker}, dataTransfer: transfer});
oldTimer.callback();
assert.equal(timerLifecycle.controller.consumeDidDrag(), true, 'old timer cannot suppress a remounted drag');

const nextDrag = harness(original);
nextDrag.controller.mount();
nextDrag.grid.dispatch('dragstart', {target: {closest: () => sticker}, dataTransfer: transfer});
nextDrag.grid.dispatch('dragend', {target: {closest: () => sticker}});
nextDrag.grid.dispatch('dragstart', {target: {closest: () => sticker}, dataTransfer: transfer});
assert.deepEqual(nextDrag.clearedTimers, [nextDrag.timers[0]], 'new drag cancels the prior reset timer');
nextDrag.timers[0].callback();
assert.equal(nextDrag.controller.consumeDidDrag(), true, 'cancelled prior timer cannot clear current drag state');

console.log('Step 5 calendar drag controller tests passed.');
