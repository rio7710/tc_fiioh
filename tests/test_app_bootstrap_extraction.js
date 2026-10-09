const assert = require('node:assert/strict');
const fs = require('node:fs');

const shell = fs.readFileSync('01_app/P1_title_design_preview.html', 'utf8');
const bootstrapPath = '01_app/assets/core/app-bootstrap.js';
const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');

assert.equal((shell.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || []).length, 0, 'P1 has no inline executable script');
assert.equal((shell.match(/app-bootstrap\.js\?v=20261009_v78/g) || []).length, 1, 'P1 loads one cache-busted bootstrap asset');
assert.match(shell, /<script src="\/01_app\/assets\/core\/app-bootstrap\.js\?v=20261009_v78"><\/script>/);
assert.match(bootstrap, /^\(async\(\)=>\{/);
assert.match(bootstrap, /async function boot\(\)\{await ensureStepPartialsLoaded\(\);await ensureStep4Loaded\(\);await initDemo\(\);await restoreLoginSession\(\)\}\s*boot\(\);/);
assert.match(bootstrap, /\}\)\(\)\.catch\(error=>\{/);
assert.match(bootstrap, /const stepPartialDefinitions=\[/);
assert.match(bootstrap, /const workflowProgressController=ThinkCastWorkflowProgressController\.create/);
assert.match(bootstrap, /const userSettingsController=ThinkCastUserSettingsController\.create/);

for (const marker of ['let demoData=', 'const stepPartialDefinitions=', 'function configureWorkflowModal(', 'async function boot()', 'const userSettingsController=']) {
  assert.equal(shell.includes(marker), false, `P1 shell excludes bootstrap state/composition marker: ${marker}`);
}

console.log('App bootstrap extraction tests passed.');
