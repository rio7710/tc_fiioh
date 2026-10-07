const assert = require('node:assert/strict');
const Step04 = require('../01_app/assets/steps/step04/step04-video.js');

const scenes = [
  { id: 'one', name: 'One', start: 0, end: 5, cueStart: 0.5, text: 'one' },
  { id: 'two', name: 'Two', start: 5, end: 12, cueStart: 5.5, text: 'two' }
];

Step04.applyTimeline({ scenes });

const video = { currentTime: 0, paused: true };
const sceneList = { innerHTML: '' };
const mobileSelect = { innerHTML: '', value: '' };
const originalDocument = global.document;
global.document = {
  querySelector(selector) {
    if (selector === '#video') return video;
    if (selector === '#sceneList') return sceneList;
    if (selector === '#mobileSceneSelect') return mobileSelect;
    return null;
  },
  querySelectorAll() { return []; }
};

try {
  Step04.renderSceneList();
  assert.match(sceneList.innerHTML, /data-index="0"/);
  assert.match(sceneList.innerHTML, /data-index="1"/);
  assert.match(sceneList.innerHTML, /data-outro="true"/);
  assert.match(mobileSelect.innerHTML, /value="outro"/);

  let state = Step04.navigatePreview('NEXT_SCENE');
  assert.equal(state.currentSceneIndex, 1);
  assert.equal(state.isOutro, false);
  assert.equal(video.currentTime, 5.55);

  state = Step04.navigatePreview('NEXT_SCENE');
  assert.equal(state.isOutro, true, 'last scene next enters OUT');
  assert.equal(video.currentTime, 11.95);

  state = Step04.navigatePreview('PREV_SCENE');
  assert.equal(state.isOutro, false, 'OUT previous returns to last scene');
  assert.equal(state.currentSceneIndex, 1);
  assert.equal(video.currentTime, 5.55);

  state = Step04.navigatePreview({ type: 'SEEK_OUTRO' });
  assert.equal(state.isOutro, true, 'scene can return directly to OUT');
  assert.equal(video.currentTime, 11.95);
} finally {
  global.document = originalDocument;
}

console.log('Step 4 preview navigation integration passed');
