const assert = require('node:assert/strict');
const fs = require('node:fs');

const shell = fs.readFileSync('01_app/P1_title_design_preview.html', 'utf8');
const partial = fs.readFileSync('01_app/pages/components/workflow-progress.html', 'utf8');
const controller = fs.readFileSync('01_app/assets/core/workflow-progress-controller.js', 'utf8');

for (const id of ['aiWorkflowModal', 'aiWorkflowKicker', 'aiWorkflowTitle', 'aiWorkflowSummary', 'aiNow', 'aiEngines', 'aiProgressBar', 'aiRoleList', 'aiFootStatus']) {
  assert.match(partial, new RegExp(`id="${id}"`), `${id} remains in workflow partial`);
  assert.doesNotMatch(shell, new RegExp(`id="${id}"`), `${id} is removed from P1 shell`);
}
assert.equal((partial.match(/id="aiWorkflowModal"/g) || []).length, 1);
assert.match(shell, /<div id="workflowProgressContainer"><\/div>/);
assert.match(shell, /container:'#workflowProgressContainer',path:'\/01_app\/pages\/components\/workflow-progress\.html'/);
assert.match(shell, /workflow-progress-controller\.js\?v=20261009_v77/);
assert.match(shell, /const workflowProgressController=ThinkCastWorkflowProgressController\.create/);
assert.match(shell, /function configureWorkflowModal\(type,configOverride=null\)\{\s*return workflowProgressController\.configure\(type,configOverride\);\s*\}/);
assert.doesNotMatch(shell, /const workflowConfigs=|aiWorkflowKicker'\)\.innerHTML|aiRoleList'\)\.innerHTML/);
assert.match(controller, /AI VIDEO & FINAL EXPORT TEAM/);
assert.match(shell, /function setupSceneProgressBadges/);

console.log('Workflow progress partial tests passed.');
