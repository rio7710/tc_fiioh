const assert = require('node:assert/strict');
const Presentation = require('../01_app/assets/steps/step05/step05-calendar-presentation-controller.js');

function classList() {
  const values = new Set();
  return {
    toggle(value, force) { if (force) values.add(value); else values.delete(value); },
    contains: value => values.has(value)
  };
}

function eventNode(extra = {}) {
  const listeners = new Map();
  return Object.assign({
    listeners,
    dataset: {},
    attributes: new Map(),
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatch(type) { for (const listener of listeners.get(type) || []) listener(); },
    setAttribute(name, value) { this.attributes.set(name, value); }
  }, extra);
}

function harness(initialView = 'month') {
  let view = initialView;
  let cursor = new Date('2026-10-09T12:00:00');
  const calls = [];
  const frames = [];
  const cancelled = [];
  const windowScrolls = [];
  const entries = [{id: 'entry-1'}];
  const styleValues = new Map([['--calendar-days', 'stale']]);
  const grid = eventNode({
    className: '',
    innerHTML: '',
    style: {
      setProperty(name, value) { styleValues.set(name, value); },
      removeProperty(name) { styleValues.delete(name); }
    }
  });
  const scroller = eventNode({scrollTop: 0, scrollLeft: 0, classList: classList()});
  const title = eventNode({textContent: ''});
  const prevButton = eventNode();
  const nextButton = eventNode();
  const viewButtons = ['month', 'week', 'day'].map(value => eventNode({dataset: {calendarView: value}}));
  const loadResult = {snapshot: {view: 'month'}, error: null};
  const viewController = {
    snapshot() { calls.push(['snapshot']); return {view, cursor: new Date(cursor)}; },
    load() { calls.push(['load']); return loadResult; },
    save() { calls.push(['save']); return {ok: true}; },
    move(direction) { calls.push(['move', direction]); cursor.setDate(cursor.getDate() + direction); },
    selectView(value) { calls.push(['selectView', value]); view = value; },
    selectDate(value) { calls.push(['selectDate', value]); view = 'day'; cursor = new Date(`${value}T12:00:00`); }
  };
  const renderer = {
    render(input) {
      calls.push(['render', input]);
      return {
        title: `${input.view}-title`,
        className: `calendar-${input.view}`,
        html: `<div>${input.view}</div>`,
        calendarDays: input.view === 'month' ? 7 : null,
        timeScroll: input.view !== 'month'
      };
    }
  };
  const currentNow = new Date('2026-10-10T12:00:00');
  const controller = Presentation.create({
    grid, scroller, title, viewButtons, prevButton, nextButton, viewController, renderer,
    getEntries: () => entries,
    now: () => currentNow,
    requestFrame(callback) { const frame = {callback}; frames.push(frame); return frame; },
    cancelFrame(frame) { cancelled.push(frame); },
    getPageScroll: () => ({x: 11, y: 22}),
    scrollWindow(x, y) { windowScrolls.push([x, y]); }
  });
  return {
    controller, grid, scroller, title, viewButtons, prevButton, nextButton, calls, frames,
    cancelled, windowScrolls, entries, currentNow, styleValues, loadResult
  };
}

assert.throws(() => Presentation.create({}), /requires prevButton/);

const fixture = harness();
assert.equal(Object.isFrozen(fixture.controller), true);
assert.equal(fixture.controller.load(), fixture.loadResult, 'load returns the view controller result unchanged');
const monthModel = fixture.controller.render();
assert.equal(monthModel.className, 'calendar-month');
assert.equal(fixture.grid.className, 'calendar-month');
assert.equal(fixture.grid.innerHTML, '<div>month</div>');
assert.equal(fixture.title.textContent, 'month-title');
assert.equal(fixture.styleValues.get('--calendar-days'), 7);
assert.equal(fixture.scroller.classList.contains('time-scroll'), false);
assert.deepEqual(fixture.viewButtons.map(button => button.attributes.get('aria-pressed')), ['true', 'false', 'false']);
const renderInput = fixture.calls.find(call => call[0] === 'render')[1];
assert.equal(renderInput.entries, fixture.entries);
assert.equal(renderInput.now, fixture.currentNow);
assert.equal(fixture.calls.filter(call => call[0] === 'save').length, 1);

fixture.controller.selectView('week');
assert.equal(fixture.grid.className, 'calendar-week');
assert.equal(fixture.scroller.classList.contains('time-scroll'), true);
assert.equal(fixture.scroller.scrollTop, 8 * 52, 'time views default to 08:00');
assert.equal(fixture.styleValues.has('--calendar-days'), false, 'non-month render removes stale day count');
assert.deepEqual(fixture.viewButtons.map(button => button.attributes.get('aria-pressed')), ['false', 'true', 'false']);

fixture.scroller.scrollTop = 123;
fixture.scroller.scrollLeft = 45;
const preserved = fixture.controller.render({preserveScroll: true});
assert.equal(preserved.className, 'calendar-week');
assert.equal(fixture.scroller.scrollTop, 123);
assert.equal(fixture.scroller.scrollLeft, 45);
assert.deepEqual(fixture.windowScrolls.at(-1), [11, 22], 'page scroll restores immediately');
fixture.scroller.scrollTop = 0;
fixture.scroller.scrollLeft = 0;
fixture.frames.at(-1).callback();
assert.equal(fixture.scroller.scrollTop, 123);
assert.equal(fixture.scroller.scrollLeft, 45);
assert.deepEqual(fixture.windowScrolls.at(-1), [11, 22], 'page scroll restores in animation frame');

fixture.scroller.scrollTop = 200;
fixture.controller.render({preserveScroll: true});
const staleFrame = fixture.frames.at(-1);
fixture.scroller.scrollTop = 300;
fixture.controller.render({preserveScroll: true});
assert.ok(fixture.cancelled.includes(staleFrame), 'a newer preserve render cancels the stale frame');

const nav = harness();
assert.equal(nav.controller.mount(), true);
assert.equal(nav.controller.mount(), true);
assert.equal(nav.prevButton.listeners.get('click').size, 1);
nav.prevButton.dispatch('click');
nav.nextButton.dispatch('click');
nav.viewButtons[2].dispatch('click');
nav.controller.selectDate('2026-10-15');
assert.deepEqual(nav.calls.filter(call => ['move', 'selectView', 'selectDate'].includes(call[0])), [
  ['move', -1],
  ['move', 1],
  ['selectView', 'day'],
  ['selectDate', '2026-10-15']
]);
nav.scroller.scrollTop = 99;
nav.controller.render({preserveScroll: true});
const pending = nav.frames.at(-1);
assert.equal(nav.controller.unmount(), true);
assert.ok(nav.cancelled.includes(pending), 'unmount cancels the pending frame');
assert.equal(nav.controller.unmount(), false);
nav.prevButton.dispatch('click');
assert.equal(nav.calls.filter(call => call[0] === 'move').length, 2, 'unmount removes navigation listeners');

console.log('Step 5 calendar presentation controller tests passed.');
