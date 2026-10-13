const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');

const shellPath = '01_app/P1_title_design_preview.html';
const cssPath = '01_app/assets/core/app-shell.css';
assert.ok(fs.existsSync(cssPath), 'extracted app shell stylesheet must exist');

const shell = fs.readFileSync(shellPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');
assert.equal((shell.match(/<style\b/g) || []).length, 0, 'P1 contains no inline style opening tag');
assert.equal((shell.match(/<\/style>/g) || []).length, 0, 'P1 contains no inline style closing tag');
assert.equal((shell.match(/app-shell\.css\?v=20261012_v79/g) || []).length, 1, 'P1 loads app shell CSS exactly once at v79');
assert.ok(
  shell.indexOf('step05-calendar.css?v=20261007_v2') < shell.indexOf('app-shell.css?v=20261012_v79'),
  'extracted CSS retains the original cascade position after feature stylesheets'
);
assert.equal(css.split('\n').length - 1, 883, 'all 883 current CSS lines are preserved');
assert.equal(
  crypto.createHash('sha256').update(css).digest('hex'),
  '786bc1fbacacb7e2bb38fe06781393a0f4c23f6180a6f5c6153aa74e6d2bce40',
  'extracted CSS matches the current reviewed baseline'
);

[
  ':root{',
  '.binder-cover{',
  '.binder-cover .form-grid{',
  '.api-settings-modal{',
  '.ai-modal{',
  '.ai-dialog-head{',
  '.calendar-settings-modal{',
  '.user-settings-dialog::backdrop{',
  '.image-regeneration-modal{',
  '@media(max-width:980px)',
  '@media(max-width:600px)',
  '@media(max-width:560px)',
  '@media(max-width:480px)'
].forEach(marker => assert.ok(css.includes(marker), `app shell CSS preserves ${marker}`));

console.log('App shell CSS extraction tests passed.');
