const assert = require('node:assert/strict');
const Library = require('../01_app/assets/steps/step04/step04-brand-library-controller.js');

(async () => {
  function node(extra = {}) {
    const listeners = new Map();
    return Object.assign({
      hidden: false, textContent: '', innerHTML: '', value: '', files: [], dataset: {},
      classList: {values: new Set(), toggle(name, enabled) { enabled ? this.values.add(name) : this.values.delete(name); }},
      addEventListener(type, listener) { const list = listeners.get(type) || []; list.push(listener); listeners.set(type, list); },
      removeEventListener(type, listener) { listeners.set(type, (listeners.get(type) || []).filter(item => item !== listener)); },
      listeners,
      fire(type, event = {target: {closest: () => null}}) { return Promise.all((listeners.get(type) || []).map(listener => listener(event))); }
    }, extra);
  }

  const nodes = {
    '#contentIndex': node(), '#brandLibraryPanel': node({hidden: true}), '#brandLibraryOpen': node(),
    '#brandLibraryClose': node(), '#brandLibraryList': node(), '#brandUploadButton': node(),
    '#brandVersionCount': node(), '#brandLibraryMessage': node(), '#brandUploadFile': node(),
    '#brandUploadRole': node({value: 'watermark'}), '#brandUploadName': node({value: 'My <Mark>'})
  };
  const root = {querySelector: selector => nodes[selector] || null};
  let assets = [];
  let response = {assets: [], selections: []};
  let requestError = null;
  let requestHook = null;
  let readError = null;
  let requestCalls = [];
  const calls = [];
  const selectionController = {
    hydrate(value) { calls.push(['hydrate', value]); assets = JSON.parse(JSON.stringify(value.assets)); },
    getAssets() { calls.push(['getAssets']); return JSON.parse(JSON.stringify(assets)); },
    renderChoices() { calls.push(['renderChoices']); }
  };
  const controller = Library.create({
    request: async (...args) => { requestCalls.push(args); if (requestHook) return requestHook(...args); if (requestError) throw requestError; return response; },
    selectionController,
    isOutroRatioCompanion: item => item.companion === true,
    openWatermarkPreview: id => calls.push(['watermark', id]),
    openOutroPreview: id => calls.push(['outro', id]),
    readFileAsDataUrl: async file => { calls.push(['read', file]); if (readError) throw readError; return 'data:image/png;base64,AA'; },
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
  });

  assert.equal(Object.isFrozen(controller), true);
  assert.throws(() => Library.create(), /requires request/);
  assert.throws(() => Library.create({request() {}, isOutroRatioCompanion() {}, openWatermarkPreview() {}, openOutroPreview() {}, readFileAsDataUrl() {}, escapeHtml() {}}), /requires selectionController/);
  assert.throws(() => controller.mount({}), /mount requires root/);

  assert.equal(controller.mount(root), true);
  assert.equal(controller.mount(root), true, 'mount is idempotent');
  assert.equal(nodes['#brandLibraryOpen'].listeners.get('click').length, 1);

  response = {assets: [
    {role: 'intro', active: false, version_id: 'intro/a', name: 'Intro', version: 1, media_type: 'image'},
    {role: 'watermark', active: true, version_id: 'wm&1', name: '<Logo>', version: 2, media_type: 'image'},
    {role: 'outro', active: true, version_id: 'outro 1', name: 'Outro', version: 3, media_type: 'video'},
    {role: 'outro', active: true, version_id: 'companion', name: 'Hidden', version: 3, media_type: 'image', companion: true}
  ], selections: [{role: 'intro'}]};
  calls.length = 0;
  await controller.refresh();
  assert.deepEqual(requestCalls.at(-1), ['/api/brand-assets']);
  assert.deepEqual(calls.map(item => item[0]), ['hydrate', 'getAssets', 'renderChoices']);
  assert.equal(nodes['#brandVersionCount'].textContent, '03');
  assert.match(nodes['#brandLibraryList'].innerHTML, /intro%2Fa/);
  assert.match(nodes['#brandLibraryList'].innerHTML, /&lt;Logo>/);
  assert.match(nodes['#brandLibraryList'].innerHTML, /data-watermark-preview="wm&amp;1"/);
  assert.match(nodes['#brandLibraryList'].innerHTML, /data-outro-preview="outro 1"/);
  assert.match(nodes['#brandLibraryList'].innerHTML, /v3 · 영상/);
  assert.doesNotMatch(nodes['#brandLibraryList'].innerHTML, /Hidden/);
  assert.match(nodes['#brandLibraryList'].innerHTML, /Intro/, 'inactive assets remain visible in the library');

  response = {};
  await controller.refresh();
  assert.equal(nodes['#brandVersionCount'].textContent, '00');
  assert.equal(nodes['#brandLibraryList'].innerHTML, '<p class="flow-desc">등록된 개인 브랜드 리소스가 없습니다.</p>');

  controller.show(true);
  assert.equal(nodes['#contentIndex'].hidden, true);
  assert.equal(nodes['#brandLibraryPanel'].hidden, false);
  assert.equal(nodes['#brandLibraryOpen'].classList.values.has('active'), true);
  controller.show(false);
  assert.equal(nodes['#contentIndex'].hidden, false);
  assert.equal(nodes['#brandLibraryPanel'].hidden, true);

  response = {assets: [], selections: []};
  await nodes['#brandLibraryOpen'].fire('click');
  assert.equal(nodes['#brandLibraryPanel'].hidden, false, 'open shows before/while refreshing');
  await nodes['#brandLibraryClose'].fire('click');
  assert.equal(nodes['#brandLibraryPanel'].hidden, true);
  await nodes['#brandLibraryList'].fire('click', {target: {closest: selector => selector.includes('watermark') ? {dataset: {watermarkPreview: 'wm-1'}} : {dataset: {outroPreview: 'must-not-run'}}}});
  assert.deepEqual(calls.at(-1), ['watermark', 'wm-1']);
  await nodes['#brandLibraryList'].fire('click', {target: {closest: selector => selector.includes('outro') ? {dataset: {outroPreview: 'outro-1'}} : null}});
  assert.deepEqual(calls.at(-1), ['outro', 'outro-1']);

  nodes['#brandUploadFile'].files = [];
  const callCount = requestCalls.length;
  await controller.upload();
  assert.equal(nodes['#brandLibraryMessage'].textContent, '등록할 파일을 선택해 주세요.');
  assert.equal(requestCalls.length, callCount);

  const file = {name: 'logo.png'};
  nodes['#brandUploadFile'].files = [file]; nodes['#brandUploadFile'].value = 'logo.png';
  response = {assets: [], selections: []};
  await controller.upload();
  const uploadCall = requestCalls.find(call => call[0] === '/api/brand-assets/upload');
  assert.equal(uploadCall[1].method, 'POST');
  assert.deepEqual(JSON.parse(uploadCall[1].body), {role: 'watermark', name: 'My <Mark>', data_url: 'data:image/png;base64,AA'});
  assert.equal(nodes['#brandUploadFile'].value, '');
  assert.equal(nodes['#brandUploadRole'].value, 'watermark');
  assert.equal(nodes['#brandUploadName'].value, 'My <Mark>');
  assert.equal(nodes['#brandLibraryMessage'].textContent, '새 버전을 등록했습니다.');
  assert.equal(requestCalls.at(-1)[0], '/api/brand-assets', 'success refreshes after upload');

  readError = new Error('read failed');
  await controller.upload();
  assert.equal(nodes['#brandLibraryMessage'].textContent, 'read failed');
  readError = null; requestError = new Error('request failed');
  await controller.upload();
  assert.equal(nodes['#brandLibraryMessage'].textContent, 'request failed');
  requestError = null;
  requestHook = async path => {
    if (path === '/api/brand-assets') throw new Error('refresh failed');
    return {};
  };
  await controller.upload();
  assert.equal(nodes['#brandLibraryMessage'].textContent, 'refresh failed');
  assert.equal(nodes['#brandUploadFile'].value, '', 'refresh failure occurs after the existing file-only reset');
  requestHook = null;

  controller.unmount();
  assert.equal(nodes['#brandLibraryOpen'].listeners.get('click').length, 0);
  assert.throws(() => controller.show(true), /not mounted/);
  assert.equal(controller.mount(root), true, 'controller remounts after unmount');
  assert.equal(nodes['#brandLibraryOpen'].listeners.get('click').length, 1);
  controller.unmount();

  const missing = Object.assign({}, root, {querySelector: selector => selector === '#brandUploadButton' ? null : nodes[selector]});
  assert.throws(() => controller.mount(missing), /missing #brandUploadButton/);
  assert.equal(controller.mount(root), true, 'failed mount rolls back for retry');
  controller.unmount();

  console.log('Step04 brand library controller tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
