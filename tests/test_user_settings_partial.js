const assert = require('node:assert/strict');
const fs = require('node:fs');

const shell = fs.readFileSync('01_app/P1_title_design_preview.html', 'utf8');
const bootstrap = fs.readFileSync('01_app/assets/core/app-bootstrap.js', 'utf8');
const partial = fs.readFileSync('01_app/pages/components/user-settings.html', 'utf8');
const indexPartial = fs.readFileSync('01_app/pages/steps/step01-content-index.html', 'utf8');
const controller = fs.readFileSync('01_app/assets/core/user-settings-controller.js', 'utf8');

assert.match(partial, /id="userSettingsDialog"/);
assert.match(partial, /id="userChannelKeyDialog"/);
for (const id of ['userAutomationRange','userStageOptionsForm','userSettingsSave','userVoicePreview','userChannelKeyInput']) {
  assert.match(partial, new RegExp(`id="${id}"`), `partial preserves #${id}`);
}
for (const id of ['userAutomationToggle','userAutomationCurrentStage','userAutomationProgressBar','userAutomationRuns']) {
  assert.match(indexPartial, new RegExp(`id="${id}"`), `production index owns #${id}`);
  assert.doesNotMatch(partial, new RegExp(`id="${id}"`), `settings dialog does not duplicate #${id}`);
}
const ids = [...partial.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'user settings partial contains no duplicate ids');
assert.doesNotMatch(shell, /id="userSettingsDialog"|id="userChannelKeyDialog"/);
assert.match(shell, /<div id="userSettingsContainer"><\/div>/);
assert.match(bootstrap, /container:'#userSettingsContainer',path:'\/01_app\/pages\/components\/user-settings\.html'/);
assert.match(shell, /automation-progress-model\.js\?v=20261014_v2/);
assert.match(shell, /automation-control-panel\.js\?v=20261014_v2/);
assert.match(shell, /user-settings-controller\.js\?v=20261014_v81/);
assert.match(bootstrap, /ThinkCastUserSettingsController\.create\(/);
assert.match(bootstrap, /ThinkCastAutomationControlPanel\.create\(/);
assert.match(bootstrap, /userSettingsController\.mount\(\)/);
assert.doesNotMatch(`${shell}\n${bootstrap}`, /Server-owned automation settings|function collectAutomationConfig|function mutateAutomation|keywordRequestGeneration/);
assert.match(controller, /function collectAutomationConfig/);
assert.match(controller, /async function mutateAutomation/);

console.log('User settings partial extraction tests passed.');
