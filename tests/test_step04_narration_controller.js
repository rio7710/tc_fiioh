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

console.log('Step04 narration controller tests passed');
