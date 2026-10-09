const assert = require('node:assert/strict');
const SettingsController = require('../01_app/assets/steps/step05/step05-calendar-settings-controller.js');
const Calendar = require('../01_app/assets/steps/step05/step05-calendar.js');

function eventNode(extra = {}) {
  const listeners = new Map();
  return Object.assign({
    listeners,
    hidden: true,
    dataset: {},
    classList: {
      values: new Set(),
      add(value) { this.values.add(value); },
      remove(value) { this.values.delete(value); },
      contains(value) { return this.values.has(value); }
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    }
  }, extra);
}

function entry(id, projectId, platform, start = '2026-10-09', title = '같은 제목') {
  return {
    id,
    title,
    start,
    end: Calendar.nextDateKey(start),
    extendedProps: {
      projectId,
      platform,
      status: 'draft',
      createdAt: `${start}T09:00:00+09:00`
    }
  };
}

function harness(initialEntries) {
  const grid = eventNode();
  const modal = eventNode();
  const title = eventNode({textContent: ''});
  const dateInput = eventNode({value: '', focused: 0, focus() { this.focused += 1; }});
  const rows = [];
  const platforms = eventNode({innerHTML: '', querySelectorAll: () => rows});
  const cancelButton = eventNode();
  const saveButton = eventNode();
  const body = eventNode();
  const keyTarget = eventNode();
  let entries = initialEntries;
  const calls = [];
  const timers = [];
  const cleared = [];
  const controller = SettingsController.create({
    grid,
    modal,
    title,
    dateInput,
    platforms,
    cancelButton,
    saveButton,
    body,
    keyTarget,
    getEntries: () => entries,
    setEntries(value) { entries = value; calls.push(['setEntries']); },
    contentIdentity: Calendar.contentIdentity,
    nextDateKey: Calendar.nextDateKey,
    timeInputValue: Calendar.calendarTimeInputValue,
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;'),
    statusLabels: {draft: '미배포', scheduled: '배포 예약', published: '배포 완료', deleted: '삭제·제거'},
    platformLabels: {youtube: 'YouTube', instagram: 'Instagram'},
    setCursor(value) { calls.push(['cursor', value]); },
    saveEntries() { calls.push(['save']); },
    render() { calls.push(['render']); },
    setHelp(value) { calls.push(['help', value]); },
    setTimer(callback, delay) {
      const timer = {callback, delay};
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) { cleared.push(timer); }
  });
  return {
    controller, grid, modal, title, dateInput, platforms, rows, cancelButton, saveButton,
    body, keyTarget, calls, timers, cleared, entries: () => entries
  };
}

assert.throws(() => SettingsController.create({}), /requires grid/);

const records = [
  entry('a-youtube', 'project-a', 'youtube'),
  entry('a-instagram', 'project-a', 'instagram'),
  entry('b-youtube', 'project-b', 'youtube')
];
const fixture = harness(records);
assert.equal(Object.isFrozen(fixture.controller), true);
assert.equal(fixture.controller.mount(), true);
assert.equal(fixture.controller.mount(), true);
for (const type of ['contextmenu', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
  assert.equal(fixture.grid.listeners.get(type).size, 1, `${type} is bound once`);
}

const sticker = eventNode({dataset: {groupId: 'a-youtube'}});
let prevented = 0;
let stopped = 0;
fixture.grid.dispatch('contextmenu', {
  target: {closest: () => sticker},
  preventDefault() { prevented += 1; },
  stopPropagation() { stopped += 1; }
});
assert.equal(prevented, 1);
assert.equal(stopped, 1);
assert.equal(fixture.modal.hidden, false);
assert.equal(fixture.title.textContent, '같은 제목');
assert.equal(fixture.dateInput.value, '2026-10-09');
assert.equal(fixture.dateInput.focused, 1);
assert.deepEqual(fixture.controller.getActiveEntries().map(item => item.id), ['a-youtube', 'a-instagram'], 'canonical identity excludes same-title other project');
assert.match(fixture.platforms.innerHTML, /YouTube/);
assert.match(fixture.platforms.innerHTML, /Instagram/);
assert.equal(fixture.body.classList.contains('modal-open'), true);

fixture.cancelButton.dispatch('click');
assert.equal(fixture.modal.hidden, true);
assert.deepEqual(fixture.controller.getActiveEntries(), []);
fixture.controller.open('a-youtube');
fixture.modal.dispatch('pointerdown', {target: fixture.modal});
assert.equal(fixture.modal.hidden, true, 'backdrop closes settings');
fixture.controller.open('a-youtube');
fixture.keyTarget.dispatch('keydown', {key: 'Escape'});
assert.equal(fixture.modal.hidden, true, 'Escape closes settings');

fixture.grid.dispatch('pointerdown', {
  target: {closest: () => sticker}, pointerType: 'touch', clientX: 10, clientY: 20
});
assert.equal(fixture.timers.at(-1).delay, 600);
fixture.timers.at(-1).callback();
assert.equal(fixture.controller.consumeLongPressOpened(), true);
assert.equal(fixture.controller.consumeLongPressOpened(), false, 'long press click suppression is one-shot');

fixture.grid.dispatch('pointerdown', {
  target: {closest: () => sticker}, pointerType: 'touch', clientX: 0, clientY: 0
});
const movingTimer = fixture.timers.at(-1);
fixture.grid.dispatch('pointermove', {clientX: 9, clientY: 0});
assert.ok(fixture.cleared.includes(movingTimer), 'movement over 8px cancels long press');
fixture.grid.dispatch('pointerdown', {
  target: {closest: () => sticker}, pointerType: 'touch', clientX: 0, clientY: 0
});
const endingTimer = fixture.timers.at(-1);
fixture.grid.dispatch('pointerup');
assert.ok(fixture.cleared.includes(endingTimer), 'pointerup cancels long press');
fixture.grid.dispatch('pointerdown', {
  target: {closest: () => sticker}, pointerType: 'touch', clientX: 0, clientY: 0
});
const cancelledTimer = fixture.timers.at(-1);
fixture.grid.dispatch('pointercancel');
assert.ok(fixture.cleared.includes(cancelledTimer), 'pointercancel cancels long press');
const timerCount = fixture.timers.length;
fixture.grid.dispatch('pointerdown', {target: {closest: () => sticker}, pointerType: 'mouse', clientX: 0, clientY: 0});
assert.equal(fixture.timers.length, timerCount, 'mouse does not start long press');

fixture.controller.open('a-youtube');
fixture.dateInput.value = '2026-10-12';
function row(id, status, time) {
  return {
    dataset: {eventId: id},
    querySelector(selector) {
      return selector === 'select' ? {value: status} : {value: time};
    }
  };
}
fixture.rows.push(row('a-youtube', 'published', '14:30'), row('a-instagram', 'scheduled', ''));
assert.equal(fixture.controller.save(), true);
const youtube = fixture.entries().find(item => item.id === 'a-youtube');
const instagram = fixture.entries().find(item => item.id === 'a-instagram');
const other = fixture.entries().find(item => item.id === 'b-youtube');
assert.equal(youtube.start, '2026-10-12');
assert.equal(youtube.end, '2026-10-13');
assert.equal(youtube.extendedProps.status, 'published');
assert.equal(youtube.extendedProps.distributedAt, '2026-10-12T14:30:00+09:00');
assert.equal(instagram.extendedProps.scheduledAt, '2026-10-12T09:00:00+09:00');
assert.equal(other.start, '2026-10-09');
assert.deepEqual(fixture.calls.slice(-4), [
  ['cursor', '2026-10-12'],
  ['save'],
  ['render'],
  ['help', '스티커의 날짜와 플랫폼별 파이프라인 시간을 저장했습니다.']
]);

fixture.grid.dispatch('pointerdown', {
  target: {closest: () => sticker}, pointerType: 'touch', clientX: 1, clientY: 1
});
const pending = fixture.timers.at(-1);
assert.equal(fixture.controller.unmount(), true);
assert.ok(fixture.cleared.includes(pending), 'unmount clears pending long press');
assert.equal(fixture.controller.unmount(), false);
assert.equal(fixture.controller.mount(), true, 'controller remounts');

console.log('Step 5 calendar settings controller tests passed.');
