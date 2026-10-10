const assert = require('node:assert/strict');
const Controller = require('../01_app/assets/core/provider-usage-controller.js');

function node() { return {textContent: '', dataset: {}}; }
const nodes = Object.fromEntries(['providerUsageStrip', 'gptUsageMonth', 'gptUsageTotal', 'klingVideoUsage', 'klingImageUsage'].map(id => [id, node()]));
const root = {querySelector: selector => nodes[selector.slice(1)] || null};
const controller = Controller.create({
  request: async path => {
    assert.equal(path, '/api/provider-usage');
    return {openai: {month: {total_tokens: 1234}, total: {total_tokens: 5678, requests: 9}}, kling: {available: true, summary: {video: {used: 12, total: 100}, image: {used: 3.5, total: 20}}}};
  },
  onError: error => { throw error; }
});
assert.equal(controller.mount(root), true);
controller.refresh().then(() => {
  assert.equal(nodes.gptUsageMonth.textContent, '1,234 tokens');
  assert.equal(nodes.gptUsageTotal.textContent, '누적 5,678 · 9회');
  assert.equal(nodes.klingVideoUsage.textContent, '영상 12 / 100 U');
  assert.equal(nodes.klingImageUsage.textContent, '이미지 3.5 / 20 U');
  assert.equal(nodes.providerUsageStrip.dataset.state, 'ready');
  console.log('Provider usage controller tests passed');
});
