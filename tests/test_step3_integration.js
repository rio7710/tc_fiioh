const assert = require('node:assert/strict');
const fs = require('node:fs');

const scriptPath = '01_app/pages/steps/step03-script.html';
const storyboardPath = '01_app/pages/steps/step03-storyboard.html';
const cssPath = '01_app/assets/steps/step03/step03-flow.css';
const jsPath = '01_app/assets/steps/step03/step03-flow.js';
const editorPath = '01_app/assets/steps/step03/step03-script-editor-controller.js';
const flowControllerPath = '01_app/assets/steps/step03/storyboard-flow-controller.js';

[scriptPath, storyboardPath, cssPath, jsPath, editorPath, flowControllerPath].forEach(file => {
  assert.ok(fs.existsSync(file), `${file} must exist`);
});

const scriptHtml = fs.readFileSync(scriptPath, 'utf8');
const storyboardHtml = fs.readFileSync(storyboardPath, 'utf8');
const shellMarkup = fs.readFileSync('01_app/P1_title_design_preview.html', 'utf8');
const appBootstrap = fs.readFileSync('01_app/assets/core/app-bootstrap.js', 'utf8');
const shellHtml = `${shellMarkup}\n${appBootstrap}`;

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
assert.match(shellHtml, /step03-flow\.js\?v=20261009_v52/, 'shell cache-busts the Step 3 flow helper');
assert.match(shellHtml, /step03-script-editor-controller\.js\?v=20261009_v38/, 'shell cache-busts the Step 3 script editor controller');
assert.match(shellHtml, /storyboard-flow-controller\.js\?v=20261009_v53/, 'shell cache-busts the storyboard flow controller');
assert.match(shellHtml, /const scriptEditorController=Step03ScriptEditorController\.create\(/, 'shell wires the Step 3 script editor controller');
assert.match(shellHtml, /scriptEditorController\.mount\(document\)/, 'shell mounts Step 3 script editor interactions');
for(const [name,method] of [['fillScript','fill'],['currentScriptPayload','payload'],['updateScriptDiff','updateDiff'],['loadSavedScript','loadSaved'],['saveScriptLocally','saveLocal'],['saveScriptChanges','save']]) assert.match(shellHtml,new RegExp(`function ${name}\\([^)]*\\)\\{\\s*return scriptEditorController\\.${method}\\(`),`${name} remains a thin wrapper`);
assert.doesNotMatch(shellHtml, /let scriptBaselineLines=|document\.querySelector\('#scriptLines'\)\.addEventListener|document\.querySelector\('#scriptSaveBtn'\)\.addEventListener|\/api\/script\/save/, 'shell removes duplicate script editor state and handlers');
assert.match(shellHtml, /const storyboardFlowController=Step03StoryboardFlowController\.create\(/, 'shell wires storyboard flow transitions');
assert.match(shellHtml, /storyboardFlowController\.mount\(document\)/, 'shell mounts storyboard flow transitions');
assert.doesNotMatch(shellHtml, /document\.querySelector\('#scriptNext'\)\.addEventListener|document\.querySelector\('#storyboardNext'\)\.addEventListener|document\.querySelector\('#storyboardLookToolbar'\)\.addEventListener/, 'shell removes inline Step 3 transition listeners');

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

assert.equal('setLook' in Step03Flow, false, 'storyboard look state is not duplicated in Step03Flow');

console.log('Step 3 fragment and data-driven behavior tests passed.');
