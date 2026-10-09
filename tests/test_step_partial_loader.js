const assert = require('node:assert/strict');
const fs = require('node:fs');

const loaderPath = '01_app/assets/steps/step-partial-loader.js';
const shellPath = '01_app/P1_title_design_preview.html';
const StepPartialLoader = require(`../${loaderPath}`);
const shell = fs.readFileSync(shellPath, 'utf8');

const partials = [
  ['userSettingsContainer', '01_app/pages/components/user-settings.html'],
  ['workflowProgressContainer', '01_app/pages/components/workflow-progress.html'],
  ['step01LoginContainer', '01_app/pages/steps/step01-login.html'],
  ['step01IndexContainer', '01_app/pages/steps/step01-content-index.html'],
  ['step01ProjectContainer', '01_app/pages/steps/step01-project.html'],
  ['step02Container', '01_app/pages/steps/step02-keyword.html'],
  ['step03Container', '01_app/pages/steps/step03-script.html'],
  ['step031Container', '01_app/pages/steps/step03-storyboard.html']
];

partials.forEach(([container, path]) => {
  assert.match(shell, new RegExp(`id="${container}"`), `${container} is present`);
  assert.match(shell, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${path} is loaded`);
});
assert.match(shell, /await ensureStepPartialsLoaded\(\);[\s\S]*await ensureStep4Loaded\(\);[\s\S]*await initDemo\(\);[\s\S]*await restoreLoginSession\(\)/, 'partials and demo initialize before session route restoration');
assert.ok(shell.indexOf('await ensureStepPartialsLoaded();') < shell.indexOf('authUIController.mount(document)'), 'auth UI mounts after step partials load');

const nodes = Object.fromEntries(partials.map(([id]) => [id, { innerHTML: '' }]));
const root = { querySelector: selector => nodes[selector.slice(1)] || null };

(async () => {
  const count = await StepPartialLoader.load(root, partials.map(([container, path]) => ({ container: `#${container}`, path })), {
    fetchImpl: null,
    readFile: path => fs.readFileSync(path, 'utf8')
  });
  assert.equal(count, partials.length);
  assert.match(nodes.step01LoginContainer.innerHTML, /id="step1"/);
  assert.match(nodes.step031Container.innerHTML, /id="step31"/);
  assert.match(nodes.userSettingsContainer.innerHTML, /id="userSettingsDialog"/);
  assert.match(nodes.workflowProgressContainer.innerHTML, /id="aiWorkflowModal"/);
  const combined = Object.values(nodes).map(node => node.innerHTML).join('');
  const ids = [...combined.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'loaded partials do not introduce duplicate ids');
  console.log('Step partial loader integration tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
