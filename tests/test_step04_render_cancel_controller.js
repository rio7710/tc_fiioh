const assert = require('assert');
const controller = require('../01_app/assets/steps/step04/step04-render-cancel-controller.js');

function button() {
  const listeners = new Map();
  return {
    hidden: true, disabled: false,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => {
      if (listeners.get(name) === callback) listeners.delete(name);
    },
    click: () => listeners.get('click')?.()
  };
}

(async () => {
  const node = button();
  const messages = [];
  const requests = [];
  const release = controller.bind({
    button: node, confirm: () => true, getJobId: () => 'render-job-1',
    onStatus: message => messages.push(message),
    api: async (path, options) => {
      requests.push([path, JSON.parse(options.body)]);
      return { status: 'running' };
    }
  });
  assert.equal(node.hidden, false);
  node.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(requests, [['/api/render/cancel', { job_id: 'render-job-1' }]]);
  assert.match(messages.at(-1), /안전하게 종료/);
  release();
  assert.equal(node.hidden, true);
  console.log('Step04 render cancel controller tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
