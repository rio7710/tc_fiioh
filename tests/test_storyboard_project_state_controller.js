const assert = require('node:assert/strict');
const Controller = require('../01_app/assets/steps/step03/storyboard-project-state-controller.js');

function harness(options = {}) {
  const calls = [];
  const video = {currentTime: 9};
  let scenes = options.scenes || [{id: 's1'}];
  let currentScene = 2;
  let timeline = {scenes: [{id: 'old'}]};
  let crops = {s1: {x: 1}};
  let images = new Map([['s1', {}]]), imageCandidates = new Map([['s1', [{}]]]);
  let voices = new Map([['s1', {}]]), videos = new Map([['s1', {}]]), videoCandidates = new Map([['s1', [{}]]]);
  let keywords = new Set(['old']), document = {production: {timeline: {scenes: [{id: 'old'}]}}};
  const editor = options.editor === undefined ? {sync: () => calls.push('editor-sync')} : options.editor;
  const deps = {
    getRoot: () => ({querySelector: selector => selector === '#video' ? video : null}),
    getScenes: () => scenes, setScenes: value => {calls.push('scenes'); scenes = value;},
    setCurrentScene: value => {calls.push('current'); currentScene = value;},
    connectTimeline: value => {calls.push(['connect', value]); return {scenes: value.map(scene => ({...scene, connected: true}))};},
    resetTimeline: () => calls.push('timeline-reset'), setDemoTimeline: value => {calls.push('demo-timeline'); timeline = value;},
    setCropPositions: value => {calls.push('crops'); crops = value;}, setImages: value => {calls.push('images'); images = value;},
    setImageCandidates: value => {calls.push('image-candidates'); imageCandidates = value;}, setVoiceClips: value => {calls.push('voices'); voices = value;},
    setVideos: value => {calls.push('videos'); videos = value;}, setVideoCandidates: value => {calls.push('video-candidates'); videoCandidates = value;},
    clearKeywords: () => {calls.push('keywords'); keywords.clear();}, setActiveStoryboardDocument: value => {calls.push('document'); document = value;},
    resetEditorCrops: value => calls.push(['editor-crops', value]), getStep04VideoEditor: () => editor,
    getFallbackSync: () => options.fallback || (() => calls.push('fallback-sync')),
    resetProjectStore: () => calls.push('project-store')
  };
  return {controller: Controller.create(deps), deps, calls, video,
    state: () => ({scenes, currentScene, timeline, crops, images, imageCandidates, voices, videos, videoCandidates, keywords, document})};
}

(() => {
  const valid = harness().deps;
  assert.equal(Object.isFrozen(Controller), true);
  assert.equal(Object.isFrozen(Controller.create(valid)), true);
  for (const name of Object.keys(valid)) {
    const copy = {...valid}; delete copy[name];
    assert.throws(() => Controller.create(copy), new RegExp(`requires ${name}`));
  }

  let h = harness();
  const first = {scene_id: 's1', uri: 'a'}, second = {scene_id: 's2', uri: 'b'}, third = {scene_id: 's1', uri: 'c'};
  const input = [first, second, third], snapshot = JSON.stringify(input);
  const imageMap1 = h.controller.setImageCandidates(input);
  assert.deepEqual([...imageMap1.keys()], ['s1', 's2']);
  assert.deepEqual(imageMap1.get('s1'), [first, third]);
  assert.equal(JSON.stringify(input), snapshot, 'candidate input remains unchanged');
  const imageMap2 = h.controller.setImageCandidates(input);
  assert.notEqual(imageMap1, imageMap2, 'each image grouping replaces Map identity');
  const videoMap = h.controller.setVideoCandidates([third, first]);
  assert.deepEqual(videoMap.get('s1'), [third, first]);
  assert.notEqual(videoMap, imageMap2, 'image and video candidate state stay separate');
  assert.throws(() => h.controller.setImageCandidates(null), /array/);
  assert.throws(() => h.controller.setVideoCandidates([{}]), /scene_id/);

  h = harness({scenes: [{id: 'a'}, {id: 'b'}]});
  const connected = h.controller.connect();
  assert.deepEqual(connected, [{id: 'a', connected: true}, {id: 'b', connected: true}]);
  assert.equal(h.state().currentScene, -1);
  assert.equal(h.video.currentTime, 0);
  assert.deepEqual(h.calls.slice(0, 4).map(item => Array.isArray(item) ? item[0] : item), ['connect', 'scenes', 'current', 'editor-sync']);
  assert.equal(h.calls.filter(item => item === 'editor-sync').length, 1);
  assert.equal(h.calls.filter(item => item === 'fallback-sync').length, 0);
  h = harness({editor: null}); h.controller.connect();
  assert.equal(h.calls.filter(item => item === 'fallback-sync').length, 1);

  h = harness();
  const old = h.state();
  h.controller.reset();
  const reset = h.state();
  assert.equal(reset.scenes.length, 0); assert.equal(reset.currentScene, -1);
  assert.deepEqual(reset.timeline, {scenes: []}); assert.deepEqual(reset.crops, {});
  for (const key of ['images', 'imageCandidates', 'voices', 'videos', 'videoCandidates']) {
    assert.equal(reset[key].size, 0); assert.notEqual(reset[key], old[key], `${key} Map identity is replaced`);
  }
  assert.equal(reset.keywords.size, 0); assert.equal(reset.document, null, 'old storyboard document is project-scoped');
  assert.equal(h.calls.filter(item => item === 'timeline-reset').length, 1);
  assert.equal(h.calls.filter(item => Array.isArray(item) && item[0] === 'editor-crops').length, 1);
  assert.equal(h.calls.filter(item => item === 'project-store').length, 1);
  const firstResetMaps = h.state(); h.controller.reset(); const secondResetMaps = h.state();
  assert.notEqual(firstResetMaps.images, secondResetMaps.images, 'consecutive reset creates fresh project Maps');
  assert.equal(h.calls.filter(item => item === 'timeline-reset').length, 2);
  assert.equal(h.calls.filter(item => item === 'project-store').length, 2);

  h = harness();
  h.controller.setImageCandidates([{scene_id: 'a-scene', uri: 'a.jpg'}]);
  h.controller.reset();
  h.controller.setImageCandidates([{scene_id: 'b-scene', uri: 'b.jpg'}]);
  h.controller.reset();
  const aAgain = h.controller.setImageCandidates([{scene_id: 'a-scene', uri: 'a-new.jpg'}]);
  assert.deepEqual([...aAgain.keys()], ['a-scene'], 'A to B to A hydration does not retain B candidate groups');
  assert.equal(aAgain.has('b-scene'), false, 'project B candidates never leak back into project A');

  console.log('Storyboard project state controller tests passed');
})();
