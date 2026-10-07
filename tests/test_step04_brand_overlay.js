const assert = require('node:assert/strict');
const BrandOverlayController = require('../01_app/assets/steps/step04/step04-brand-overlay.js');
const Step04BrandState = require('../01_app/assets/steps/step04/step04-brand-state.js');

function node(extra = {}) {
  const listeners = new Map();
  return Object.assign({
    hidden: true, disabled: false, checked: false, value: '', textContent: '', innerHTML: '', dataset: {},
    style: {}, classList: {add() {}, remove() {}},
    setAttribute(name, value) { this[name] = value; },
    addEventListener(type, handler) { const list = listeners.get(type) || []; list.push(handler); listeners.set(type, list); },
    removeEventListener(type, handler) { listeners.set(type, (listeners.get(type) || []).filter(item => item !== handler)); },
    dispatch(type, values = {}) { const event = Object.assign({target: this, currentTarget: this}, values); (listeners.get(type) || []).slice().forEach(handler => handler(event)); },
    listenerCount() { return [...listeners.values()].reduce((total, list) => total + list.length, 0); }
  }, extra);
}

function fixture() {
  const selectors = [
    '#watermarkPreviewClose', '#watermarkPreviewSave', '#watermarkPreviewPrev', '#watermarkPreviewNext', '#watermarkSizeRange', '#watermarkPreviewModal', '#watermarkPreviewName', '#watermarkPreviewGrid', '#watermarkSizeLabel', '#brandWatermarkVersion', '#brandWatermarkEnabled',
    '#outroPreviewClose', '#outroPreviewSave', '#outroPreviewPrev', '#outroPreviewNext', '#outroSizeRange', '#outroPreviewModal', '#outroPreviewName', '#outroPreviewGrid', '#outroSizeLabel', '#outroBackgroundOpacity', '#outroBackgroundOpacityLabel', '#brandOutroVersion', '#brandOutroEnabled'
  ];
  const nodes = Object.fromEntries(selectors.map(selector => [selector, node()]));
  const watermarkPositions = [node({dataset: {watermarkPosition: 'top-left'}}), node({dataset: {watermarkPosition: 'bottom-right'}})];
  const outroPositions = [node({dataset: {outroPosition: 'center-center'}}), node({dataset: {outroPosition: 'bottom-center'}})];
  const outroBackgrounds = [node({dataset: {outroBackground: 'none'}}), node({dataset: {outroBackground: 'black'}})];
  const generated = {
    '#watermarkPreviewGrid .watermark-demo-mark': node(),
    '#outroPreviewGrid .outro-preview-background': node(),
    '#outroPreviewGrid .outro-preview-asset': node()
  };
  const root = {
    body: {classList: {add() {}, remove() {}}},
    querySelector(selector) { return nodes[selector] || generated[selector] || null; },
    querySelectorAll(selector) {
      if (selector === '[data-watermark-position]') return watermarkPositions;
      if (selector === '[data-outro-position]') return outroPositions;
      if (selector === '[data-outro-background]') return outroBackgrounds;
      return [];
    }
  };
  return {root, nodes, watermarkPositions, outroPositions, outroBackgrounds};
}

(async () => {
  const state = Step04BrandState.create({
    watermark: {profiles: {'16x9': {width_ratio: 0.1}, '9x16': {width_ratio: 0.2}, '4x5': {width_ratio: 0.3}, '1x1': {width_ratio: 0.4}}},
    outro: {profiles: {
      '16x9': {width_ratio: 0.1, version_id: 'outro-169'},
      '9x16': {width_ratio: 0.2, version_id: 'outro-916'},
      '4x5': {width_ratio: 0.3, version_id: 'outro-45'},
      '1x1': {width_ratio: 0.4, version_id: 'outro-11'}
    }}
  });
  const assets = [
    {role: 'watermark', version_id: 'watermark-1', name: 'Mark', version: 1, media_type: 'image'},
    {role: 'outro', version_id: 'outro-main', name: 'Outro', version: 4, media_type: 'image'},
    ...['169', '916', '45', '11'].map(id => ({role: 'outro', version_id: `outro-${id}`, media_type: id === '916' ? 'video' : 'image'}))
  ];
  const errors = [];
  let saves = 0;
  let watermarkRefreshes = 0;
  let outroRefreshes = 0;
  const ui = fixture();
  const controller = BrandOverlayController.create({
    state,
    getBrandAssets: () => assets,
    saveSelection: async () => { saves += 1; },
    applyPosition: (element, position) => { element.position = position; },
    backgroundColor: profile => `${profile.background}:${profile.background_opacity}`,
    updateWatermarkPreview: () => { watermarkRefreshes += 1; },
    updateOutroPreview: () => { outroRefreshes += 1; },
    onError: (feature, error) => errors.push({feature, error})
  });

  const mounted = controller.mount(ui.root);
  assert.equal(mounted.mounted, true);
  assert.equal(mounted.watermark.ok, true);
  assert.equal(mounted.outro.ok, true);
  assert.deepEqual(controller.mount(ui.root), {mounted: false, reason: 'already-mounted'}, 'mount is idempotent');

  controller.openOutroPreview('outro-main');
  const widths = [state.snapshot().outroWidthRatio];
  for (let index = 0; index < 3; index += 1) {
    ui.nodes['#outroPreviewNext'].dispatch('click');
    widths.push(state.snapshot().outroWidthRatio);
  }
  assert.deepEqual(widths, [0.1, 0.2, 0.3, 0.4], 'four ratio profiles navigate independently');
  const markup = ui.nodes['#outroPreviewGrid'].innerHTML;
  assert.ok(markup.indexOf('outro-preview-background') < markup.indexOf('outro-preview-asset'), 'background layer precedes transparent PNG/MP4');

  const beforeCancel = state.snapshot();
  controller.openWatermarkPreview('watermark-1');
  ui.nodes['#watermarkSizeRange'].value = '85';
  ui.nodes['#watermarkSizeRange'].dispatch('input');
  assert.equal(state.snapshot().watermarkWidthRatio, 0.85);
  ui.nodes['#watermarkPreviewClose'].dispatch('click');
  assert.deepEqual(state.snapshot(), beforeCancel, 'cancel restores the full snapshot');
  assert.ok(watermarkRefreshes > 0);

  controller.openOutroPreview('outro-main');
  ui.nodes['#outroSizeRange'].value = '65';
  ui.nodes['#outroSizeRange'].dispatch('input');
  ui.nodes['#outroPreviewSave'].dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(saves, 1);
  assert.equal(state.snapshot().outroWidthRatio, 0.65, 'save retains edited state');
  assert.equal(ui.nodes['#brandOutroVersion'].value, 'outro-main');
  assert.equal(ui.nodes['#brandOutroEnabled'].checked, true);
  assert.equal(outroRefreshes, 1);

  const refreshController = BrandOverlayController.create({
    state, getBrandAssets: () => assets, saveSelection: async () => {}, applyPosition() {}, backgroundColor: () => 'transparent',
    updateWatermarkPreview() { throw new Error('watermark failed'); },
    updateOutroPreview() { outroRefreshes += 1; },
    onError: (feature, error) => errors.push({feature, error})
  });
  const refreshed = refreshController.refresh();
  assert.equal(refreshed.watermark.ok, false);
  assert.equal(refreshed.outro.ok, true, 'watermark failure does not block outro refresh');
  assert.equal(errors.at(-1).feature, 'watermark');

  const incompleteUi = fixture();
  delete incompleteUi.nodes['#watermarkPreviewSave'];
  const incompleteController = BrandOverlayController.create({
    state, getBrandAssets: () => assets, saveSelection: async () => {}, applyPosition() {}, backgroundColor: () => 'transparent',
    updateWatermarkPreview() {}, updateOutroPreview() {}, onError: (feature, error) => errors.push({feature, error})
  });
  const incompleteMount = incompleteController.mount(incompleteUi.root);
  assert.equal(incompleteMount.watermark.ok, false, 'missing watermark DOM is reported explicitly');
  assert.equal(incompleteMount.outro.ok, true, 'missing watermark DOM does not block outro bindings');
  incompleteController.unmount();

  const listenerCount = Object.values(ui.nodes).reduce((total, item) => total + item.listenerCount(), 0)
    + ui.watermarkPositions.reduce((total, item) => total + item.listenerCount(), 0)
    + ui.outroPositions.reduce((total, item) => total + item.listenerCount(), 0)
    + ui.outroBackgrounds.reduce((total, item) => total + item.listenerCount(), 0);
  assert.ok(listenerCount > 0);
  assert.deepEqual(controller.unmount(), {unmounted: true});
  const afterUnmount = Object.values(ui.nodes).reduce((total, item) => total + item.listenerCount(), 0)
    + ui.watermarkPositions.reduce((total, item) => total + item.listenerCount(), 0)
    + ui.outroPositions.reduce((total, item) => total + item.listenerCount(), 0)
    + ui.outroBackgrounds.reduce((total, item) => total + item.listenerCount(), 0);
  assert.equal(afterUnmount, 0, 'unmount removes every registered listener');

  console.log('Step 4 brand overlay controller tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
