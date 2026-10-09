const assert = require('node:assert/strict');
const Calendar = require('../01_app/assets/steps/step05/step05-calendar.js');
const Controller = require('../01_app/assets/steps/step05/step05-calendar-view-controller.js');

(() => {
  const fixedNow = new Date(2026, 11, 31, 8);
  let stored = null;
  let failWrite = false;
  const storage = {
    getItem: () => stored,
    setItem: (key, value) => {
      if (failWrite) throw new Error('quota');
      stored = value;
    }
  };
  const create = () => Controller.create({
    storage,
    storageKey: 'calendar-ui',
    now: () => new Date(fixedNow),
    isDateKey: value => /^\d{4}-\d{2}-\d{2}$/.test(value || ''),
    dateKey: Calendar.dateKey
  });

  assert.throws(() => Controller.create(), /requires storage/);
  let controller = create();
  assert.equal(Object.isFrozen(controller), true);
  let state = controller.snapshot();
  assert.equal(state.view, 'month');
  assert.equal(Calendar.dateKey(state.cursor), '2026-12-31');
  state.cursor.setFullYear(2000);
  assert.equal(Calendar.dateKey(controller.snapshot().cursor), '2026-12-31', 'snapshot Date is isolated');

  stored = '{bad';
  const failedLoad = controller.load();
  assert.ok(failedLoad.error instanceof Error);
  assert.equal(failedLoad.snapshot.view, 'month');
  stored = JSON.stringify({view: 'invalid', cursor: 'bad-date'});
  controller.load();
  assert.equal(controller.snapshot().view, 'month');
  assert.equal(Calendar.dateKey(controller.snapshot().cursor), '2026-12-31');
  stored = JSON.stringify({view: 'month', cursor: '2026-02-31'});
  controller.load();
  assert.equal(Calendar.dateKey(controller.snapshot().cursor), '2026-12-31', 'calendar-invalid date is ignored');
  stored = JSON.stringify({view: 'week', cursor: '2026-12-28'});
  controller.load();
  assert.equal(controller.snapshot().view, 'week');
  assert.equal(Calendar.dateKey(controller.snapshot().cursor), '2026-12-28');

  controller.move(1);
  assert.equal(Calendar.dateKey(controller.snapshot().cursor), '2027-01-04');
  controller.move(-1);
  assert.equal(Calendar.dateKey(controller.snapshot().cursor), '2026-12-28');
  controller.selectView('day');
  assert.equal(Calendar.dateKey(controller.snapshot().cursor), '2026-12-31', 'day tab resets to today');
  controller.move(1);
  assert.equal(Calendar.dateKey(controller.snapshot().cursor), '2027-01-01');
  controller.selectDate('2027-02-15');
  assert.equal(controller.snapshot().view, 'day');
  assert.equal(Calendar.dateKey(controller.snapshot().cursor), '2027-02-15');

  controller = create();
  controller.setCursor('2026-12-31');
  controller.move(1);
  assert.equal(Calendar.dateKey(controller.snapshot().cursor), '2027-01-01', 'month move targets first day of next month');
  failWrite = false;
  assert.equal(controller.save().ok, true);
  assert.deepEqual(JSON.parse(stored), {view: 'month', cursor: '2027-01-01'});
  failWrite = true;
  const failedSave = controller.save();
  assert.equal(failedSave.ok, false);
  assert.match(failedSave.error.message, /quota/);

  console.log('Step05 calendar view controller tests passed');
})();
