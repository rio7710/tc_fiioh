const assert = require('node:assert/strict');
const fs = require('node:fs');

const fragments = {
  login: fs.readFileSync('01_app/pages/steps/step01-login.html', 'utf8'),
  index: fs.readFileSync('01_app/pages/steps/step01-content-index.html', 'utf8'),
  project: fs.readFileSync('01_app/pages/steps/step01-project.html', 'utf8')
};

function ids(markup) {
  return [...markup.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
}

assert.match(fragments.login, /id="step1"/);
['loginForm', 'registerForm', 'loggedInPanel', 'logoutButton'].forEach(id => {
  assert.match(fragments.login, new RegExp(`id="${id}"`), `login contract keeps #${id}`);
});

assert.match(fragments.index, /id="stepIndex"/);
['contentIndex', 'contentIndexMessage', 'createProjectButton', 'brandLibraryPanel'].forEach(id => {
  assert.match(fragments.index, new RegExp(`id="${id}"`), `index contract keeps #${id}`);
});
assert.match(fragments.index, /data-index-filter="all"/);
assert.match(fragments.index, /data-index-filter="progress"/);
assert.match(fragments.index, /data-index-filter="completed"/);

assert.match(fragments.project, /id="stepProject"/);
['projectDetailTitle', 'projectDetailSteps', 'projectDeleteButton', 'projectDetailContinue'].forEach(id => {
  assert.match(fragments.project, new RegExp(`id="${id}"`), `project contract keeps #${id}`);
});
['2', '3', '3-1', '4', '5', 'index'].forEach(destination => {
  assert.match(fragments.project, new RegExp(`data-go="${destination}"`));
});

const allIds = Object.values(fragments).flatMap(ids);
assert.equal(new Set(allIds).size, allIds.length, 'Step 1 fragments must not duplicate DOM ids');
Object.values(fragments).forEach(markup => {
  assert.doesNotMatch(markup, /<script\b|<style\b/i, 'partials must not carry inline behavior or styling');
});

console.log('Step 1 fragment contracts passed');
