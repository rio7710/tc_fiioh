const assert = require('node:assert/strict');
const NarrationController = require('../01_app/assets/steps/step04/step04-narration-controller.js');

let enabled = true;
let active = -1;
let video = { paused: false };
function audio(duration, options = {}) {
  return {
    duration, currentTime: 0, paused: options.paused ?? true, pauseCount: 0, playCount: 0,
    pause() { this.paused = true; this.pauseCount += 1; },
    play() { this.paused = false; this.playCount += 1; return options.reject ? Promise.reject(new Error('blocked')) : Promise.resolve(); }
  };
}
const controller = NarrationController.create({
  isNarrationEnabled: () => enabled,
  getActiveNarration: () => active,
  setActiveNarration: value => { active = value; },
  getPreviewVideo: () => video
});
const first = audio(8);
const second = audio(4);
const cues = [{ start: 2, end: 6 }, { start: 6, end: 10 }];
controller.setTracks({ narrations: cues, narrationAudios: [first, second] });
cues[0].start = 99;

controller.sync(2);
assert.equal(active, 0, 'cue includes its start boundary and clones payload');
assert.equal(first.currentTime, 0, 'cue start maps to audio start');
controller.sync(4);
assert.equal(first.currentTime, 4, 'relative cue time maps proportionally to audio duration');
first.currentTime = 4.25;
controller.sync(4);
assert.equal(first.currentTime, 4.25, 'drift at exactly 0.25 seconds is preserved');
first.currentTime = 4.251;
controller.sync(4);
assert.equal(first.currentTime, 4, 'drift above 0.25 seconds is corrected');
controller.sync(5.999);
assert.equal(first.currentTime, 7.97, 'audio mapping preserves the 0.03 second end margin');

controller.sync(6);
assert.equal(active, 1, 'cue end is exclusive and next cue start is inclusive');
assert.ok(first.pauseCount >= 1, 'cue transition pauses prior audio');
assert.equal(second.currentTime, 0, 'new cue starts at its relative position');

video.paused = true;
controller.sync(7);
assert.equal(active, -1, 'paused preview stops narration');
enabled = false; video.paused = false;
controller.sync(7);
assert.equal(active, -1, 'disabled narration remains stopped');
enabled = true;
controller.setTracks({ narrations: [{ start: 0, end: 1 }], narrationAudios: [] });
controller.sync(0);
assert.equal(active, -1, 'missing audio safely stops');

const rejected = audio(1, { reject: true });
controller.setTracks({ narrations: [{ start: 0, end: 1 }], narrationAudios: [rejected] });
assert.doesNotThrow(() => controller.sync(0.5), 'rejected play promise is handled');

const dynamicAudios = Array.from({ length: 7 }, () => audio(2));
controller.setTracks({
  narrations: Array.from({ length: 7 }, (_, index) => ({ start: index * 2, end: index * 2 + 2 })),
  narrationAudios: dynamicAudios
});
controller.sync(12);
assert.equal(active, 6, 'dynamic cue counts are supported');
controller.setTracks({ narrations: [], narrationAudios: [] });
assert.equal(active, -1, 'track replacement clears the active cue');
assert.equal(dynamicAudios[6].pauseCount, 1, 'track replacement stops the active audio');
controller.reset();
controller.sync(0);
assert.equal(active, -1, 'reset leaves no playable cues');

const uiOrder = [];
let uiEnabled = false;
let uiActive = -1;
const uiAudio = audio(2);
uiAudio.play = function () { uiOrder.push('sync'); this.paused = false; return Promise.resolve(); };
uiAudio.pause = function () { uiOrder.push('stop'); this.paused = true; };
const narrationButton = { textContent: '', attrs: {}, classList: { active: false, toggle(_name, value) { this.active = value; } }, setAttribute(key, value) { this.attrs[key] = value; } };
const uiVideo = { currentTime: 1, paused: false };
const uiController = NarrationController.create({
  getRoot: () => ({ querySelector: selector => selector === '#narrationBtn' ? narrationButton : selector === '#video' ? uiVideo : null }),
  isNarrationEnabled: () => uiEnabled,
  setNarrationEnabled: value => { uiOrder.push(`state:${value}`); uiEnabled = value; },
  getActiveNarration: () => uiActive, setActiveNarration: value => { uiActive = value; },
  getPreviewVideo: () => uiVideo, saveEditorSettings: () => uiOrder.push('save')
});
uiController.setTracks({ narrations: [{ start: 0, end: 2 }], narrationAudios: [uiAudio] });
uiOrder.length = 0;
assert.equal(uiController.setEnabled('yes'), undefined, 'enable preserves the public undefined return');
assert.equal(uiEnabled, true, 'enable Boolean-coerces state');
assert.equal(narrationButton.classList.active, true);
assert.equal(narrationButton.attrs['aria-pressed'], 'true');
assert.equal(narrationButton.textContent, 'STT 내레이션 켬');
assert.deepEqual(uiOrder, ['state:true', 'sync', 'save'], 'enable updates state, syncs video, then saves');
uiOrder.length = 0;
assert.equal(uiController.setEnabled(0), undefined, 'disable preserves the public undefined return');
assert.equal(narrationButton.textContent, 'STT 내레이션 끔');
assert.deepEqual(uiOrder, ['state:false', 'stop', 'save'], 'disable updates state, stops audio, then saves');

let headlessSaves = 0;
const headlessController = NarrationController.create({ setNarrationEnabled: value => { uiEnabled = value; }, saveEditorSettings: () => { headlessSaves += 1; } });
assert.equal(headlessController.setEnabled([]), undefined);
assert.equal(uiEnabled, true); assert.equal(headlessSaves, 1, 'headless enable still saves once');
const missingControls = NarrationController.create({ root: { querySelector: () => null }, setNarrationEnabled() {}, saveEditorSettings: () => { headlessSaves += 1; } });
assert.doesNotThrow(() => missingControls.setEnabled(false), 'missing button and video are safe');

console.log('Step04 narration controller tests passed');
