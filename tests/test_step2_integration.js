const assert = require('node:assert/strict');
const fs = require('node:fs');

const partialPath = '01_app/pages/steps/step02-keyword.html';
const cssPath = '01_app/assets/steps/step02/step02-keyword.css';
const jsPath = '01_app/assets/steps/step02/step02-keyword.js';
const trendControllerPath = '01_app/assets/steps/step02/trend-keyword-controller.js';

for (const path of [partialPath, cssPath, jsPath, trendControllerPath]) assert.ok(fs.existsSync(path), `${path} must exist`);

const html = fs.readFileSync(partialPath, 'utf8');
const ids = ['step2', 'keywordGrid', 'trendKeywordMonth', 'selectionCount', 'trendKeywordOpen', 'tokenUsage', 'keywordRefresh', 'keywordMessage', 'keywordNext'];
for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), `partial preserves #${id}`);
assert.match(html, /data-go="index"/, 'back-navigation contract is preserved');
assert.match(html, /role="status" aria-live="polite"/, 'save errors remain accessible');

const source = fs.readFileSync(jsPath, 'utf8');
const trendSource = fs.readFileSync(trendControllerPath, 'utf8');
assert.match(source, /root\.Step02Keyword = factory\(\)/, 'browser global adapter is exported');
assert.match(source, /['"]\/api\/keywords['"]/, 'existing keyword save endpoint is preserved');
assert.doesNotMatch(source, /greenhill-demo-v1/, 'project identity is never hardcoded');
assert.doesNotMatch(source, /const\s+keywords\s*=\s*\[/, 'keyword content is supplied by the shell');
assert.doesNotMatch(html, /value="20\d\d-\d\d"/, 'available keyword months are supplied by configuration');
assert.match(trendSource, /root\.Step02TrendKeywordController = api/, 'trend keyword browser controller is exported');
assert.match(trendSource, /['"]\/api\/season-keywords['"]/, 'trend keyword endpoint is owned by its controller');
assert.doesNotMatch(trendSource, /document\.|window\./, 'trend controller has no direct browser global dependency');

const Step02Keyword = require('../01_app/assets/steps/step02/step02-keyword.js');
assert.equal(Step02Keyword.MAX_SELECTION, 5);
assert.equal(Step02Keyword.escapeHtml('<script>"x"</script>'), '&lt;script&gt;&quot;x&quot;&lt;/script&gt;');

function node(id) {
  return {
    id, innerHTML: '', textContent: '', disabled: false, dataset: {}, listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    closest() { return null; }
  };
}
const nodes = Object.fromEntries(ids.slice(1).map(id => [id, node(id)]));
const root = {
  querySelector(selector) { return nodes[selector.slice(1)] || null; },
  contains() { return true; }
};
let selected = new Set(['care']);
let request = null;
let destination = null;
const adapter = {
  getKeywords: () => [
    { id: 'care', label: '<돌봄>', description: '안전 & 신뢰', image: 'care' },
    { id: 'family', label: '가족', description: '함께', image: 'family', seasonal: true }
  ],
  getVisibleKeywordIds: () => ['care', 'family'],
  getKeywordMonths: () => [{ value: '2030-01', label: '2030년 1월' }],
  getSelectedKeywords: () => selected,
  setSelectedKeywords: value => { selected = value; },
  getActiveProjectId: () => 'project-42',
  api: async (path, options) => { request = { path, options }; return { ok: true }; },
  goToStep: async step => { destination = step; }
};

assert.equal(Step02Keyword.init({ root, adapter }), true);
assert.match(nodes.keywordGrid.innerHTML, /&lt;돌봄&gt;/, 'labels are escaped');
assert.match(nodes.keywordGrid.innerHTML, /안전 &amp; 신뢰/, 'descriptions are escaped');
assert.match(nodes.keywordGrid.innerHTML, /keyword-ai-badge/, 'seasonal keyword badge is retained');
assert.equal(nodes.selectionCount.textContent, '1 / 5 선택 · 전체 2개');
assert.match(nodes.trendKeywordMonth.innerHTML, /value="2030-01"/, 'month configuration is rendered by the adapter');

(async () => {
  await Step02Keyword.saveAndContinue();
  assert.equal(request.path, '/api/keywords');
  assert.deepEqual(JSON.parse(request.options.body), { project_id: 'project-42', selected: ['care'] });
  assert.equal(destination, 3);
  Step02Keyword.setKeywordStageLocked(true);
  assert.equal(nodes.trendKeywordOpen.disabled, true);
  assert.equal(nodes.keywordRefresh.disabled, true);
  assert.equal(nodes.keywordNext.textContent, '저장된 대본 보기');
  console.log('Step 2 extraction contract tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
