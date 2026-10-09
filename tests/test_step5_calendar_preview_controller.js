const assert = require('node:assert/strict');
const PreviewController = require('../01_app/assets/steps/step05/step05-calendar-preview-controller.js');
const Calendar = require('../01_app/assets/steps/step05/step05-calendar.js');

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add: value => values.add(value),
    remove: (...items) => items.forEach(value => values.delete(value)),
    contains: value => values.has(value)
  };
}

function node(extra = {}) {
  const listeners = new Map();
  return Object.assign({
    listeners,
    hidden: true,
    dataset: {},
    classList: classList(),
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatch(type, event = {}) { for (const listener of listeners.get(type) || []) listener(event); }
  }, extra);
}

function tab(entryId, platform) {
  const attributes = new Map();
  return node({
    dataset: {entryId, platform},
    setAttribute(name, value) { attributes.set(name, value); },
    getAttribute(name) { return attributes.get(name); }
  });
}

function entry(id, projectId, platform, versions, title = '같은 제목') {
  return {
    id,
    title,
    start: '2026-10-09',
    extendedProps: {projectId, platform, contentVersions: versions}
  };
}

function harness(entries, playResult = Promise.resolve()) {
  const tabs = [];
  let html = '';
  const previewMeta = node({
    querySelector(selector) { return selector === '.calendar-preview-tab' ? tabs[0] || null : null; },
    querySelectorAll(selector) { return selector === '.calendar-preview-tab' ? tabs : []; }
  });
  Object.defineProperty(previewMeta, 'innerHTML', {
    configurable: true,
    get() { return html; },
    set(value) {
      html = value;
      tabs.length = 0;
      const pattern = /data-entry-id="([^"]+)" data-platform="([^"]+)"/g;
      let match;
      while ((match = pattern.exec(value))) tabs.push(tab(match[1], match[2]));
    }
  });
  const dialog = node({classList: classList(['preview-landscape'])});
  const previewModal = node({querySelector: selector => selector === '.calendar-preview-dialog' ? dialog : null});
  const unavailableModal = node();
  const video = node({
    src: '', pauseCount: 0, loadCount: 0, playCount: 0, removed: [],
    pause() { this.pauseCount += 1; },
    load() { this.loadCount += 1; },
    play() { this.playCount += 1; return playResult; },
    removeAttribute(name) { this.removed.push(name); if (name === 'src') this.src = ''; }
  });
  const title = node({textContent: ''});
  const download = node({href: '', download: ''});
  const count = node({hidden: true, textContent: ''});
  const previousButton = node({disabled: false});
  const nextButton = node({disabled: false});
  const previewCloseButton = node();
  const unavailableCloseButton = node();
  const body = node();
  const keyTarget = node();
  const errors = [];
  const controller = PreviewController.create({
    previewModal, previewMeta, video, title, download, count, previousButton, nextButton,
    previewCloseButton, unavailableModal, unavailableCloseButton, body, keyTarget,
    getEntries: () => entries,
    contentIdentity: Calendar.contentIdentity,
    contentVersions: Calendar.calendarContentVersions,
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;'),
    platformFormats: {
      youtube: {className: 'preview-landscape'},
      instagram: {className: 'preview-portrait'},
      facebook: {className: 'preview-feed'}
    },
    platformLabels: {youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook'},
    onError(feature, error) { errors.push([feature, error]); }
  });
  return {
    controller, tabs, previewMeta, previewModal, unavailableModal, video, title, download,
    count, previousButton, nextButton, previewCloseButton, unavailableCloseButton, body,
    keyTarget, dialog, errors
  };
}

assert.throws(() => PreviewController.create({}), /requires previewModal/);

const records = [
  entry('a-youtube', 'project-a', 'youtube', [
    {url: '/a-v1.mp4', filename: 'a-v1.mp4'},
    {url: '/a-v2.mp4', filename: 'a-v2.mp4'}
  ]),
  entry('a-instagram', 'project-a', 'instagram', [{url: '/a-portrait.mp4'}]),
  entry('b-youtube', 'project-b', 'youtube', [{url: '/wrong-project.mp4'}])
];
const fixture = harness(records);
assert.equal(Object.isFrozen(fixture.controller), true);
assert.equal(fixture.controller.mount(), true);
assert.equal(fixture.controller.mount(), true);
assert.equal(fixture.previewMeta.listeners.get('click').size, 1);
assert.equal(fixture.controller.open('a-youtube'), true);
assert.equal(fixture.tabs.length, 2, 'canonical group excludes same-title other project');
assert.equal(fixture.title.textContent, '같은 제목');
assert.equal(fixture.video.src, '/a-v2.mp4', 'latest version is selected initially');
assert.equal(fixture.download.href, '/a-v2.mp4');
assert.equal(fixture.download.download, 'a-v2.mp4');
assert.equal(fixture.count.hidden, false);
assert.equal(fixture.count.textContent, '2 / 2');
assert.equal(fixture.previousButton.disabled, false);
assert.equal(fixture.nextButton.disabled, false);
assert.equal(fixture.tabs[0].getAttribute('aria-pressed'), 'true');
assert.equal(fixture.tabs[1].getAttribute('aria-pressed'), 'false');
assert.equal(fixture.body.classList.contains('modal-open'), true);

fixture.previousButton.dispatch('click');
assert.equal(fixture.video.src, '/a-v1.mp4');
fixture.previousButton.dispatch('click');
assert.equal(fixture.video.src, '/a-v2.mp4', 'previous wraps cyclically');
fixture.nextButton.dispatch('click');
assert.equal(fixture.video.src, '/a-v1.mp4', 'next wraps cyclically');
fixture.previewMeta.dispatch('click', {target: {closest: () => fixture.tabs[1]}});
assert.equal(fixture.video.src, '/a-portrait.mp4');
assert.equal(fixture.dialog.classList.contains('preview-portrait'), true);
assert.equal(fixture.count.hidden, true);
assert.equal(fixture.previousButton.disabled, true);
assert.equal(fixture.nextButton.disabled, true);

fixture.controller.openUnavailable();
fixture.controller.close();
assert.equal(fixture.body.classList.contains('modal-open'), true, 'body remains locked while unavailable modal is open');
assert.equal(fixture.video.src, '');
assert.ok(fixture.video.pauseCount > 0);
assert.ok(fixture.video.removed.includes('src'));
fixture.unavailableCloseButton.dispatch('click');
assert.equal(fixture.body.classList.contains('modal-open'), false);

const empty = harness([entry('empty', 'project-empty', 'youtube', [])]);
empty.controller.mount();
assert.equal(empty.controller.open('empty'), false);
assert.equal(empty.unavailableModal.hidden, false);

fixture.controller.open('a-youtube');
fixture.controller.openUnavailable();
fixture.keyTarget.dispatch('keydown', {key: 'Escape'});
assert.equal(fixture.previewModal.hidden, true, 'Escape closes preview first');
assert.equal(fixture.unavailableModal.hidden, false);
fixture.keyTarget.dispatch('keydown', {key: 'Escape'});
assert.equal(fixture.unavailableModal.hidden, true, 'second Escape closes unavailable');
fixture.controller.open('a-youtube');
fixture.previewModal.dispatch('pointerdown', {target: fixture.previewModal});
assert.equal(fixture.previewModal.hidden, true, 'preview backdrop closes preview');
fixture.controller.openUnavailable();
fixture.unavailableModal.dispatch('pointerdown', {target: fixture.unavailableModal});
assert.equal(fixture.unavailableModal.hidden, true, 'unavailable backdrop closes it');

const rejected = Promise.reject(new Error('autoplay blocked'));
const rejectedFixture = harness(records, rejected);
rejectedFixture.controller.mount();
assert.equal(rejectedFixture.controller.open('a-youtube'), true);
setImmediate(() => {
  assert.equal(rejectedFixture.errors.length, 1, 'rejected play is reported safely');
  assert.equal(rejectedFixture.controller.unmount(), true);
  assert.equal(rejectedFixture.previewModal.hidden, true);
  assert.equal(rejectedFixture.unavailableModal.hidden, true);
  assert.equal(rejectedFixture.video.src, '');
  assert.equal(rejectedFixture.controller.unmount(), false);
  console.log('Step 5 calendar preview controller tests passed.');
});
