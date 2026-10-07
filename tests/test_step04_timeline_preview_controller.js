const assert = require('node:assert/strict');
const PreviewController = require('../01_app/assets/steps/step04/step04-timeline-preview-controller.js');
const SceneNav = require('../01_app/assets/video-editor/scene-navigation.js');

function element(classes = []) {
  const names = new Set(classes);
  return {
    hidden: false, src: '', alt: '', textContent: '',
    style: { width: '', values: {}, setProperty(key, value) { this.values[key] = value; } },
    classList: {
      toggle(name, force) { force ? names.add(name) : names.delete(name); },
      contains(name) { return names.has(name); }
    }
  };
}

for (const count of [1, 3, 7]) {
  const nodes = {
    '#stage': element(['preview-landscape', 'preview-portrait', 'preview-feed', 'preview-square']),
    '#sceneImage': element(), '#brandOutroPreview': element(), '#titleText': element(),
    '#progressFill': element(), '#clock': element(), '#sceneTimelineSummary': element()
  };
  const scenes = Array.from({ length: count }, (_, index) => ({
    id: `s${index}`, name: index === 1 ? '' : `Scene ${index}`, image: `/s${index}.jpg`, text: index === 1 ? '' : `Caption ${index}`,
    start: index * 4, end: (index + 1) * 4
  }));
  let currentScene = -1;
  let cropCalls = 0;
  const navigationViews = [];
  const controller = PreviewController.create({
    root: { querySelector: selector => nodes[selector] || null }, SceneNav,
    formatTime: value => `T${Math.floor(value)}`, getScenes: () => scenes,
    getCurrentScene: () => currentScene, setCurrentScene: value => { currentScene = value; },
    getDissolveSeconds: () => .75, applyStoredSceneCrop: () => { cropCalls += 1; },
    syncNavigation: view => navigationViews.push(view)
  });
  let view = controller.sync(0);
  assert.equal(view.currentScene, 0, `${count} scenes select the start boundary`);
  assert.equal(nodes['#sceneImage'].src, '/s0.jpg');
  assert.equal(nodes['#sceneImage'].alt, 'Scene 0 장면 이미지');
  assert.equal(cropCalls, 1, 'initial scene applies crop once');
  controller.sync(1);
  assert.equal(cropCalls, 1, 'same scene does not update image or crop');
  if (count > 1) {
    view = controller.sync(4);
    assert.equal(view.currentScene, 1, 'scene end is exclusive and next start inclusive');
    assert.equal(cropCalls, 2, 'scene change reapplies crop once');
    assert.equal(nodes['#stage'].classList.contains('has-title'), false, 'empty caption hides title');
  }
  view = controller.sync(count * 2);
  assert.equal(nodes['#progressFill'].style.width, '50%', 'middle progress is rendered');
  controller.sync(-10);
  assert.equal(nodes['#progressFill'].style.width, '0%', 'progress clamps below zero');
  view = controller.sync(count * 4 + 10);
  assert.equal(nodes['#progressFill'].style.width, '100%', 'progress clamps above the end');
  assert.equal(view.showOutro, true, 'timeline end activates OUT preview');
  assert.equal(nodes['#brandOutroPreview'].hidden, false);
  assert.equal(nodes['#stage'].classList.contains('has-outro-preview'), true);
  assert.equal(nodes['#stage'].classList.contains('has-title'), false, 'OUT hides caption styling');
  assert.equal(nodes['#clock'].textContent, `T${count * 4 + 10} / T${count * 4}`);
  assert.deepEqual(navigationViews.at(-1), view, 'navigation receives the returned view state');
  assert.equal(nodes['#stage'].style.values['--scene-dissolve-seconds'], '0.75s');
  for (const aspect of ['preview-landscape', 'preview-portrait', 'preview-feed', 'preview-square']) {
    assert.equal(nodes['#stage'].classList.contains(aspect), true, `preview sync preserves ${aspect}`);
  }
  assert.deepEqual(controller.updateSummary(), { count, duration: count * 4 });
  assert.equal(nodes['#sceneTimelineSummary'].textContent, `타임라인 기준 · 총 ${count}장면 · ${count * 4}초`);
}

const emptyViews = [];
const empty = PreviewController.create({
  root: { querySelector: () => null }, SceneNav, getScenes: () => [],
  syncNavigation: view => emptyViews.push(view)
});
assert.doesNotThrow(() => empty.sync(2), 'empty scenes and missing optional DOM are safe');
assert.deepEqual(emptyViews[0], { currentScene: -1, showOutro: false, time: 2, duration: 0 });

console.log('Step04 timeline preview controller tests passed');
