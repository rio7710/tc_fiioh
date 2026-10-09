const assert = require('node:assert/strict');
const Renderer = require('../01_app/assets/steps/step03/storyboard-grid-renderer.js');

function harness(options = {}) {
  const order = [];
  const grid = {_html: '', set innerHTML(value) { this._html = value; order.push('html'); }, get innerHTML() { return this._html; }};
  const deps = {
    getRoot: () => ({querySelector: selector => selector === '#storyboardGrid' ? grid : null}), restoreStoryboardLook: () => order.push('look'),
    getStoryboardDocument: () => options.document || {production: {timeline: {scenes: []}}}, getCurrentScriptLines: () => options.lines || [],
    getImages: () => options.images || new Map(), getImageCandidates: () => options.imageCandidates || new Map(),
    getVoiceContext: id => (options.voices || {})[id] || {voice: null}, getVideos: () => options.videos || new Map(),
    getVideoCandidates: () => options.videoCandidates || new Map(),
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    updateVoiceControls: () => order.push('voice'), resumePendingVideos: () => order.push('resume')
  };
  return {renderer: Renderer.create(deps), grid, order};
}

(() => {
  const valid = {getRoot() {}, restoreStoryboardLook() {}, getStoryboardDocument() {}, getCurrentScriptLines() {}, getImages() {}, getImageCandidates() {}, getVoiceContext() {}, getVideos() {}, getVideoCandidates() {}, escapeHtml() {}, updateVoiceControls() {}, resumePendingVideos() {}};
  assert.throws(() => Renderer.create(), /requires getRoot/);
  for (const name of Object.keys(valid)) { const copy = {...valid}; delete copy[name]; assert.throws(() => Renderer.create(copy), new RegExp(`requires ${name}`, 'i')); }
  let h = harness(); assert.equal(Object.isFrozen(h.renderer), true); assert.throws(() => h.renderer.render(), /저장된 씬별 콘티/); assert.deepEqual(h.order, ['look']);
  const scenes = [{id: 's<1', title: '제목 <A>', narration_cue_ids: ['c1'], image_prompt: {text: 'prompt <one>'}, motion_prompt: {text: 'move <one>'}}, {id: 's2', title: '둘', narration_cue_ids: ['c2'], image_prompt: {text: 'prompt two'}}, {id: 's3', title: '셋', narration_cue_ids: ['missing'], narration: {text: 'scene <three>'}}];
  const document = {production: {timeline: {scenes}, narration_cues: [{id: 'c1', narration: {text: 'cue one'}}, {id: 'c2', narration: {text: 'cue <two>'}}], global_prompts: {negative: {text: 'negative <x>'}}}};
  h = harness({document, lines: ['line <script>', ''], images: new Map([['s<1', {uri: '/img?<x>', model: 'model<x>', usage: {total_tokens: 12, input_tokens: 5, output_tokens: 7}}]]), imageCandidates: new Map([['s<1', [{uri: '/old'}, {uri: '/img?<x>'}]]]), videos: new Map([['s2', {artifact_id: 'v2', uri: '/video?<x>'}]]), videoCandidates: new Map([['s2', [{artifact_id: 'v1', uri: '/v1'}, {artifact_id: 'v2', uri: '/video?<x>'}]]]), voices: {'s<1': {voice: {usage: {total_tokens: 8, input_tokens: 3, output_tokens: 5}}}}});
  const html = h.renderer.render(); assert.equal((html.match(/class="storyboard-card"/g) || []).length, 3); assert.match(html, /data-scene="s&lt;1"/);
  for (const pattern of [/line &lt;script&gt;/, /cue &lt;two&gt;/, /scene &lt;three&gt;/, /prompt &lt;one&gt;/, /negative &lt;x&gt;/, /후보 2\/2/, /사용 토큰 12/, /storyboard-candidate-nav prev/, /storyboard-speaker has-audio/, /음성 사용 토큰 8/, /src="\/video\?&lt;x&gt;"/, /영상 후보 2\/2/, /storyboard-video-candidate-nav next/, /Kling 영상 생성 완료/, /이미지 생성/]) assert.match(html, pattern);
  assert.deepEqual(h.order, ['look', 'html', 'voice', 'resume']);
  h = harness({document: {production: {timeline: {scenes: [{id: 'only'}]}, narration_cues: []}}}); assert.match(h.renderer.render(), /순간 이동, 공중 부양/); assert.match(h.grid.innerHTML, /storyboard-result" hidden/); assert.doesNotMatch(h.grid.innerHTML, /storyboard-video-preview/);
  h = harness({document: {production: {timeline: {scenes: [{id: 'uri-only'}]}, narration_cues: []}}, videos: new Map([['uri-only', {uri: '/second.mp4'}]]), videoCandidates: new Map([['uri-only', [{uri: '/first.mp4'}, {uri: '/second.mp4'}]]])}); assert.match(h.renderer.render(), /영상 후보 2\/2/);
  console.log('Storyboard grid renderer tests passed');
})();
