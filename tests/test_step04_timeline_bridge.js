const assert = require('node:assert/strict');
const Bridge = require('../01_app/assets/steps/step04/step04-timeline-bridge.js');

const created = [];
const editorTimelines = [];
const editorNarration = [];
const bridge = Bridge.create({
  createAudio(src) {
    const audio = { src, pausedCount: 0, pause() { this.pausedCount += 1; } };
    created.push(audio);
    return audio;
  },
  applyEditorTimeline: timeline => editorTimelines.push(timeline),
  setEditorNarrationTracks: payload => editorNarration.push(payload)
});

assert.equal(bridge.getNarrationTracks().length, 14, 'legacy 14-track fallback remains available');
const oldAudios = bridge.getNarrationAudios();
bridge.setNarrationTracks([{ rate: 1.25, src: '' }, { rate: 1, src: '/voice/2.mp3' }]);
assert.ok(oldAudios.every(audio => audio.pausedCount === 1), 'replacing tracks pauses previous audio');
assert.equal(bridge.getNarrationAudios()[0], null, 'empty source does not construct an Audio request');

bridge.applyTimeline({
  scenes: [
    { id: 'intro', start: 0, end: 2 },
    { id: 'a', start: 2, end: 5, cue_start: 2.2, cue_end: 4.8, script_line_index: 0 },
    { id: 'b', start: 5, end: 9, cue_start: 5.1, cue_end: 8.7, script_line_index: 1 },
    { id: 'outro', start: 9, end: 11 }
  ],
  narration_tracks: [{ src: '' }, { src: '/voice/b.mp3', rate: 1.1 }]
});
assert.deepEqual(bridge.getTitleSceneIndexes(), [1, 2], 'dynamic scenes derive narrated indexes from timeline scenes');
assert.equal(bridge.getNarrations().length, 2, 'cue count follows narrated timeline scenes');
assert.equal(editorTimelines.at(-1).scenes.length, 4, 'editor receives the dynamic scene count');
assert.equal(editorNarration.at(-1).narrations.length, 2, 'editor receives current narration cues');

bridge.applyScript({ lines: ['첫 문장'] });
assert.equal(bridge.getScenes()[1].text, '첫 문장', 'script text follows scriptLineIndex');
assert.equal(bridge.getScenes()[2].text, '', 'missing script lines become empty text');
assert.equal(bridge.getNarrations().length, 2, 'script updates do not change dynamic cue count');
assert.equal(editorTimelines.at(-1).scenes[1].text, '첫 문장', 'editor receives updated scene text');
assert.equal(editorTimelines.at(-1).scenes[2].text, '', 'editor receives empty text for a missing line');
const editorCopy = editorTimelines.at(-1).scenes;
editorCopy[1].text = 'outside mutation';
assert.equal(bridge.getScenes()[1].text, '첫 문장', 'editor payload cannot mutate bridge scene text');
bridge.applyScript({ lines: [] });
assert.equal(bridge.getScenes()[1].text, '', 'empty lines clear narrated scene text safely');

const snapshot = bridge.snapshot();
snapshot.scenes[0].id = 'mutated';
snapshot.narrationTracks[0].src = 'mutated';
assert.equal(bridge.getScenes()[0].id, 'intro', 'snapshots do not expose mutable scene state');
assert.notEqual(bridge.getNarrationTracks()[0].src, 'mutated', 'snapshots do not expose mutable track state');

const activeBeforeConfigure = bridge.getNarrationAudios();
bridge.configure({ applyEditorTimeline: timeline => editorTimelines.push(timeline) });
bridge.configure({ applyEditorTimeline: timeline => editorTimelines.push(timeline) });
assert.deepEqual(bridge.getNarrationAudios(), activeBeforeConfigure, 'repeated configure does not recreate media state');

const beforeReset = bridge.getNarrationAudios().filter(Boolean);
bridge.reset();
assert.ok(beforeReset.every(audio => audio.pausedCount === 1), 'project reset pauses prior project audio');
assert.equal(bridge.getScenes().length, 0, 'project reset clears timeline state');
assert.equal(bridge.getNarrationTracks().length, 14, 'project reset restores legacy fallback ownership');

console.log('Step04 timeline bridge tests passed');
