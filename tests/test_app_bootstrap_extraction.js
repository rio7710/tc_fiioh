const assert = require('node:assert/strict');
const fs = require('node:fs');

const shell = fs.readFileSync('01_app/P1_title_design_preview.html', 'utf8');
const bootstrapPath = '01_app/assets/core/app-bootstrap.js';
const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');

assert.ok(shell.split(/\r?\n/).length <= 400, 'P1 remains a compact root shell of at most 400 lines');
assert.equal((shell.match(/<style\b/gi) || []).length, 0, 'P1 has no inline style blocks');
assert.equal((shell.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || []).length, 0, 'P1 has no inline executable script');
assert.equal((shell.match(/app-shell\.css\?v=20261009_v75/g) || []).length, 1, 'P1 loads app shell CSS once');
assert.equal((shell.match(/app-bootstrap\.js\?v=20261010_v1/g) || []).length, 1, 'P1 loads one cache-busted bootstrap asset');
assert.match(shell, /<script src="\/01_app\/assets\/core\/app-bootstrap\.js\?v=20261010_v1"><\/script>/);
assert.match(shell, /<script src="\/01_app\/assets\/core\/app-bootstrap\.js\?v=20261010_v1"><\/script>\s*<\/body>/, 'bootstrap is the final shell executable entrypoint');

const requiredMountPoints = [
  'step01LoginContainer',
  'step01IndexContainer',
  'step01ProjectContainer',
  'step02Container',
  'step03Container',
  'step031Container',
  'step4Container',
  'step05Container',
  'userSettingsContainer',
  'workflowProgressContainer'
];
const sharedModalRoots = [
  'watermarkPreviewModal',
  'outroPreviewModal',
  'platformGuideModal',
  'trendKeywordModal',
  'trendKeywordLimitModal',
  'promptLabModal',
  'apiSettingsModal'
];
for (const id of [...requiredMountPoints, ...sharedModalRoots]) {
  assert.equal((shell.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `root shell preserves one #${id}`);
}
assert.match(shell, /<thinkcast-top-nav\b[^>]*mode="workflow"[^>]*><\/thinkcast-top-nav>/, 'root shell preserves shared navigation');
const shellIds = [...shell.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(shellIds).size, shellIds.length, 'root shell IDs remain unique');

assert.match(bootstrap, /^\(async\(\)=>\{/);
assert.match(bootstrap, /async function boot\(\)\{await ensureStepPartialsLoaded\(\);await ensureStep4Loaded\(\);await initDemo\(\);await restoreLoginSession\(\)\}\s*boot\(\);/);
assert.match(bootstrap, /\}\)\(\)\.catch\(error=>\{/);
assert.match(bootstrap, /const stepPartialDefinitions=\[/);
assert.match(bootstrap, /const workflowProgressController=ThinkCastWorkflowProgressController\.create/);
assert.match(bootstrap, /const userSettingsController=ThinkCastUserSettingsController\.create/);

for (const marker of ['(async()=>', 'let demoData=', 'const stepPartialDefinitions=', 'function configureWorkflowModal(', 'async function boot()', 'Controller.create(', 'addEventListener(', '/api/']) {
  assert.equal(shell.includes(marker), false, `P1 shell excludes bootstrap state/composition marker: ${marker}`);
}

console.log('App bootstrap extraction tests passed.');
