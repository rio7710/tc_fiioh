const assert = require('node:assert/strict');
const WorkflowProgress = require('../01_app/assets/core/workflow-progress-controller.js');

function node(tag = 'div') {
  return {
    tag,
    className: '',
    textContent: '',
    dataset: {},
    children: [],
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; }
  };
}

function harness(missing) {
  const ids = ['aiWorkflowModal', 'aiWorkflowKicker', 'aiWorkflowTitle', 'aiWorkflowSummary', 'aiEngines', 'aiRoleList'];
  const nodes = Object.fromEntries(ids.map(id => [id, node()]));
  if (missing) delete nodes[missing];
  const root = {
    querySelector(selector) { return nodes[selector.slice(1)] || null; },
    createElement: tag => node(tag),
    createTextNode: text => ({tag: '#text', textContent: text})
  };
  return {nodes, root, controller: WorkflowProgress.create({getRoot: () => root})};
}

assert.throws(() => WorkflowProgress.create({}), /requires getRoot/);
assert.equal(Object.isFrozen(WorkflowProgress.create({getRoot() {}})), true);

let fixture = harness();
assert.throws(() => fixture.controller.configure('export'), /not mounted/);
assert.equal(fixture.controller.mount(), true);
assert.equal(fixture.controller.mount(), true, 'mount is idempotent');
const modal = fixture.controller.configure('export');
assert.equal(modal, fixture.nodes.aiWorkflowModal);
assert.equal(modal.dataset.workflow, 'export');
assert.equal(fixture.nodes.aiWorkflowTitle.textContent, '최종 영상 제작 중');
assert.equal(fixture.nodes.aiEngines.children.length, 3);
assert.equal(fixture.nodes.aiRoleList.children.length, 4);
assert.equal(fixture.nodes.aiRoleList.children[0].children[0].textContent, '01');
assert.equal(fixture.nodes.aiRoleList.children[0].children[2].textContent, '대기');

const unsafe = '<img src=x onerror=alert(1)>';
fixture.controller.configure('custom', {
  kicker: unsafe,
  title: unsafe,
  summary: unsafe,
  engines: [{mark: unsafe, kind: 'safe', name: unsafe, status: unsafe}],
  roles: [{name: unsafe, description: unsafe, engine: unsafe}]
});
assert.equal(fixture.nodes.aiWorkflowTitle.textContent, unsafe);
assert.equal(fixture.nodes.aiWorkflowKicker.children[1].textContent, unsafe);
assert.equal(fixture.nodes.aiEngines.children[0].children[0].textContent, unsafe);
assert.equal(fixture.nodes.aiRoleList.children[0].children[1].children[0].textContent, unsafe);
assert.equal('innerHTML' in fixture.nodes.aiRoleList, false, 'controller builds external text without innerHTML');

assert.throws(() => fixture.controller.configure('missing'), /Workflow config is required/);
assert.throws(() => fixture.controller.configure('bad', {kicker: 'k', title: 't', summary: 's', engines: [], roles: []}), /requires engines/);
assert.equal(fixture.controller.unmount(), true);
assert.equal(fixture.controller.unmount(), false);
assert.equal(fixture.controller.mount(), true, 'controller remounts safely');

fixture = harness('aiRoleList');
assert.throws(() => fixture.controller.mount(), /#aiRoleList/);
assert.equal(fixture.controller.unmount(), false, 'failed mount does not mark controller mounted');

console.log('Workflow progress controller tests passed.');
