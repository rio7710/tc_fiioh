const assert = require('node:assert/strict');
const LatestExport = require('../01_app/assets/steps/step05/step05-latest-export-controller.js');

function element(tag) {
  const children = [];
  const listeners = new Map();
  const classes = new Set();
  let className = '';
  return {
    tag,
    children,
    hidden: true,
    get className() { return className; },
    set className(value) {
      className = value;
      classes.clear();
      String(value).split(/\s+/).filter(Boolean).forEach(item => classes.add(item));
    },
    classList: {
      add(value) { classes.add(value); className = [...classes].join(' '); },
      remove(...values) { values.forEach(value => classes.delete(value)); className = [...classes].join(' '); },
      contains(value) { return classes.has(value); }
    },
    append(...nodes) { children.push(...nodes); },
    replaceChildren(...nodes) { children.splice(0, children.length, ...nodes); },
    addEventListener(type, listener, options) { listeners.set(type, {listener, options}); },
    dispatch(type) {
      const registration = listeners.get(type);
      if (!registration) return;
      registration.listener();
      if (registration.options?.once) listeners.delete(type);
    },
    listener: type => listeners.get(type)
  };
}

function harness(options = {}) {
  const section = element('section');
  const list = element('list');
  const created = [];
  const errors = [];
  const saved = [];
  const storage = {
    getItem() {
      if (options.readError) throw options.readError;
      return options.stored === undefined ? null : options.stored;
    },
    setItem(key, value) {
      if (options.writeError) throw options.writeError;
      saved.push([key, value]);
    }
  };
  const now = new Date('2026-10-09T01:02:03.000Z');
  const controller = LatestExport.create({
    section,
    list,
    storage,
    storageKey: 'latest-export',
    platformLabels: {youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook'},
    platformFormats: {
      youtube: {className: 'preview-landscape'},
      instagram: {className: 'preview-portrait'},
      facebook: {className: 'preview-feed'}
    },
    createElement(tag) { const node = element(tag); created.push(node); return node; },
    now: () => now,
    onError(feature, error) { errors.push([feature, error]); }
  });
  return {controller, section, list, created, errors, saved, now};
}

assert.throws(() => LatestExport.create({}), /requires section/);

const ratios = harness().controller;
assert.equal(ratios.previewClass({width: 1920, height: 1080}), 'preview-landscape');
assert.equal(ratios.previewClass({width: 1080, height: 1920}), 'preview-portrait');
assert.equal(ratios.previewClass({width: 1080, height: 1350}), 'preview-feed');
assert.equal(ratios.previewClass({width: 1080, height: 1080}), 'preview-square');
assert.equal(ratios.previewClass({platform: 'instagram'}), 'preview-portrait');
assert.equal(ratios.previewClass({platform: 'unknown'}), 'preview-landscape');

const empty = harness();
empty.list.append(element('sentinel'));
assert.deepEqual(empty.controller.show({exports: []}), {shown: false, exports: [], error: null});
assert.equal(empty.list.children.length, 1, 'empty result leaves DOM unchanged');
assert.equal(empty.saved.length, 0);

const plural = harness();
const exportItems = [
  {url: '/wide.mp4', filename: 'wide.mp4', platforms: ['youtube', 'instagram'], width: 1920, height: 1080},
  {url: '/feed.mp4', platform: 'facebook'}
];
const shown = plural.controller.show({exports: exportItems});
assert.equal(shown.shown, true);
assert.equal(shown.exports, exportItems, 'plural export array identity is retained');
assert.equal(plural.list.children.length, 2);
const firstArticle = plural.list.children[0];
const firstVideo = firstArticle.children[0];
const firstCopy = firstArticle.children[1];
assert.equal(firstArticle.className, 'latest-export-item preview-landscape');
assert.equal(firstVideo.controls, true);
assert.equal(firstVideo.playsInline, true);
assert.equal(firstVideo.preload, 'metadata');
assert.equal(firstVideo.src, '/wide.mp4');
assert.equal(firstVideo.listener('loadedmetadata').options.once, true);
assert.equal(firstCopy.children[0].textContent, 'YouTube · Instagram');
assert.equal(firstCopy.children[1].textContent, 'wide.mp4');
const firstLink = firstCopy.children[2].children[0];
assert.equal(firstLink.href, '/wide.mp4');
assert.equal(firstLink.download, 'wide.mp4');
assert.equal(firstLink.textContent, 'MP4 다운로드');
assert.equal(plural.list.children[1].children[1].children[1].textContent, '최종 변환 영상.mp4');
assert.equal(plural.section.hidden, false);
assert.deepEqual(JSON.parse(plural.saved[0][1]), {exports: exportItems, savedAt: plural.now.toISOString()});

firstVideo.videoWidth = 1080;
firstVideo.videoHeight = 1920;
firstVideo.dispatch('loadedmetadata');
assert.equal(firstArticle.classList.contains('preview-portrait'), true);
assert.equal(firstVideo.listener('loadedmetadata'), undefined, 'metadata correction listener is once-only');

const single = harness();
const singleResult = single.controller.show({url: '/single.mp4', filename: 'single.mp4', platform: 'youtube'});
assert.equal(singleResult.exports.length, 1);
assert.equal(single.list.children[0].children[0].src, '/single.mp4');

const storedPayload = {exports: [{url: '/stored.mp4', filename: 'stored.mp4', platform: 'instagram'}], savedAt: 'old'};
const restored = harness({stored: JSON.stringify(storedPayload)});
assert.equal(restored.controller.load().shown, true);
assert.equal(restored.list.children[0].children[0].src, '/stored.mp4');

const parseError = harness({stored: '{bad json'});
const parseResult = parseError.controller.load();
assert.equal(parseResult.shown, false);
assert.ok(parseResult.error instanceof SyntaxError);
assert.equal(parseError.errors[0][0], 'load');

const readFailure = new Error('read failed');
const readError = harness({readError: readFailure});
assert.equal(readError.controller.load().error, readFailure);
assert.deepEqual(readError.errors, [['load', readFailure]]);

const writeFailure = new Error('write failed');
const writeError = harness({writeError: writeFailure});
const writeResult = writeError.controller.show({url: '/still-visible.mp4'});
assert.equal(writeResult.shown, true);
assert.equal(writeResult.error, writeFailure);
assert.equal(writeError.section.hidden, false, 'write failure does not break rendered UI');
assert.equal(writeError.list.children.length, 1);
assert.deepEqual(writeError.errors, [['save', writeFailure]]);

console.log('Step 5 latest export controller tests passed.');
