const assert = require('node:assert/strict');
const fs = require('node:fs');

const scriptPath = '01_app/pages/steps/step03-script.html';
const storyboardPath = '01_app/pages/steps/step03-storyboard.html';
const cssPath = '01_app/assets/steps/step03/step03-flow.css';
const jsPath = '01_app/assets/steps/step03/step03-flow.js';

[scriptPath, storyboardPath, cssPath, jsPath].forEach(file => {
  assert.ok(fs.existsSync(file), `${file} must exist`);
});

const scriptHtml = fs.readFileSync(scriptPath, 'utf8');
const storyboardHtml = fs.readFileSync(storyboardPath, 'utf8');
const shellHtml = fs.readFileSync('01_app/P1_title_design_preview.html', 'utf8');

['step3', 'scriptHeadline', 'scriptConcept', 'scriptLines', 'scriptSaveBar', 'scriptSaveBtn', 'voiceSampleAudio', 'scriptMessage', 'scriptNext'].forEach(id => {
  assert.match(scriptHtml, new RegExp(`id="${id}"`), `script fragment preserves #${id}`);
});

['step31', 'storyboardModel', 'storyboardBulkGenerate', 'storyboardVoiceBulkGenerate', 'storyboardVideoBulkGenerate', 'storyboardLookToolbar', 'storyboardGrid', 'storyboardVoiceAudio', 'storyboardMessage', 'storyboardNext'].forEach(id => {
  assert.match(storyboardHtml, new RegExp(`id="${id}"`), `storyboard fragment preserves #${id}`);
});

assert.match(shellHtml, /id="step03Container"/, 'shell mounts the script fragment');
assert.match(shellHtml, /id="step031Container"/, 'shell mounts the storyboard fragment');
assert.match(shellHtml, /step03-script\.html/, 'shell loads the script fragment');
assert.match(shellHtml, /step03-storyboard\.html/, 'shell loads the storyboard fragment');
assert.doesNotMatch(shellHtml, /id="step3"|id="step31"/, 'step 3 markup is not duplicated inline');

assert.doesNotMatch(scriptHtml + storyboardHtml, /<script\b|onclick=/i, 'fragments are safe to inject and do not duplicate script execution');

const Step03Flow = require('../01_app/assets/steps/step03/step03-flow.js');
const timeline = { scenes: [
  { id: 'opening', start: 0, end: 2.75, script_line_index: 0 },
  { id: 'visual-only', start: 2.75, end: 7.5 },
  { id: 'close', start: 7.5, end: 13.25, scriptLineIndex: 1 }
] };

assert.deepEqual(Step03Flow.storyboardRows(timeline).map(scene => scene.id), ['opening', 'visual-only', 'close']);
assert.deepEqual(Step03Flow.scriptRows(timeline).map(scene => scene.id), ['opening', 'close']);
assert.equal(Step03Flow.duration(timeline), 13.25, 'duration is read from the final timeline scene');
assert.equal(Step03Flow.storyboardRows({ scenes: [] }).length, 0, 'scene count is data-driven');
assert.equal(Step03Flow.duration({ scenes: [] }), 0, 'empty timeline has no invented timing');

const buttons = ['original', 'warm', 'cool', 'realistic'].map(look => ({ dataset: { look }, pressed: '', setAttribute(name, value) { if (name === 'aria-pressed') this.pressed = value; } }));
const grid = { dataset: {} };
const root = { querySelector: selector => selector === '#storyboardGrid' ? grid : null, querySelectorAll: () => buttons };
assert.equal(Step03Flow.setLook(root, 'cool'), 'cool');
assert.equal(grid.dataset.look, 'cool');
assert.equal(buttons.find(button => button.dataset.look === 'cool').pressed, 'true');
assert.equal(Step03Flow.setLook(root, 'unknown'), 'original', 'invalid looks use the existing original default');

console.log('Step 3 fragment and data-driven behavior tests passed.');
