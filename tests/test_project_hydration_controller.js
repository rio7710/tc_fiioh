const assert = require('node:assert/strict');
const Hydration = require('../01_app/assets/core/project-hydration-controller.js');

(async () => {
  function harness(overrides = {}) {
    const calls = [];
    const selectedPlatforms = new Set(['old']);
    const buttons = (overrides.platforms || ['youtube', 'instagram']).map(platform => ({
      dataset: {platform},
      setAttribute(name, value) { calls.push(['aria', platform, name, value]); }
    }));
    const result = overrides.result || {
      timeline: {scenes: [{id: 's1'}]}, script: {headline: 'title', lines: ['line']},
      selected_keyword_ids: ['k1'], document: {production: {}}, scene_crop_positions: {s1: {x: 20}},
      storyboard_images: [{scene_id: 's1', uri: 'one'}, {scene_id: 's2', uri: 'two'}],
      storyboard_image_candidates: [{scene_id: 's1', uri: 'candidate'}],
      storyboard_voice_clips: [
        {scene_id: 's1', profile_id: 'warm_female'}, {scene_id: 's2'}, {scene_id: 's3', profile_id: 'other'}
      ],
      storyboard_videos: [{scene_id: 's2', uri: 'video'}],
      storyboard_video_candidates: [{scene_id: 's2', uri: 'video-candidate'}],
      voice_profile: 'warm_female', brand_assets: [{id: 'asset'}], brand_selections: [{role: 'watermark'}],
      automation_editor: {channels: ['instagram', 'missing', 'youtube']}
    };
    const record = name => value => { calls.push([name, value]); if (overrides.throwAt === name) throw new Error(`failed ${name}`); };
    const deps = {
      request: async (...args) => { calls.push(['request', ...args]); if (overrides.requestError) throw overrides.requestError; return result; },
      isStale: token => { calls.push(['stale', token]); return Boolean(overrides.stale); },
      getActiveProjectId: () => overrides.activeProjectId === undefined ? 'project / 한글' : overrides.activeProjectId,
      setSceneCropPositions: record('crop'), setDemoTimeline: record('timeline'), mergeDemoState: record('state'),
      setSelectedKeywords: record('keywords'), setActiveStoryboardDocument: record('document'),
      setKeywordStageLocked: record('lock'), setStoryboardImages: record('images'),
      setStoryboardImageCandidates: record('imageCandidates'), setStoryboardVoiceClips: record('voices'),
      setStoryboardVideos: record('videos'), setStoryboardVideoCandidates: record('videoCandidates'),
      setVoiceProfile: record('voiceProfile'), hydrateBrandSelections: record('brandHydrate'),
      renderBrandChoices: () => { calls.push(['brandRender']); if (overrides.throwAt === 'brandRender') throw new Error('failed brandRender'); },
      getPlatformButtons: () => { calls.push(['platformButtons']); return buttons; },
      getSelectedPlatforms: () => { calls.push(['selectedPlatforms']); return selectedPlatforms; },
      setPlatformPreview: record('platformPreview'), applyTimeline: record('applyTimeline'),
      connectStoryboardAssetsToEditor: () => calls.push(['connect']), fillScript: record('fillScript'), applyScript: record('applyScript')
    };
    return {controller: Hydration.create(deps), calls, result, selectedPlatforms, buttons};
  }

  assert.throws(() => Hydration.create(), /requires request/);
  const required = {
    request() {}, isStale() {}, getActiveProjectId() {}, setSceneCropPositions() {}, setDemoTimeline() {},
    mergeDemoState() {}, setSelectedKeywords() {}, setActiveStoryboardDocument() {}, setKeywordStageLocked() {},
    setStoryboardImages() {}, setStoryboardImageCandidates() {}, setStoryboardVoiceClips() {}, setStoryboardVideos() {},
    setStoryboardVideoCandidates() {}, setVoiceProfile() {}, hydrateBrandSelections() {}, renderBrandChoices() {},
    getPlatformButtons() {}, getSelectedPlatforms() {}, setPlatformPreview() {}, applyTimeline() {},
    connectStoryboardAssetsToEditor() {}, fillScript() {}, applyScript() {}
  };
  for (const name of Object.keys(required)) {
    const deps = {...required}; delete deps[name];
    assert.throws(() => Hydration.create(deps), new RegExp(`requires ${name}`));
  }
  let h = harness();
  assert.equal(Object.isFrozen(h.controller), true);

  const returned = await h.controller.loadContent('project / 한글', 7);
  assert.equal(returned, h.result);
  assert.deepEqual(h.calls[0], ['request', '/api/project-content?project_id=project%20%2F%20%ED%95%9C%EA%B8%80']);
  assert.deepEqual(h.calls.map(call => call[0]), [
    'request','stale','crop','timeline','state','keywords','document','lock','images','imageCandidates',
    'voices','videos','videoCandidates','voiceProfile','brandHydrate','brandRender','platformButtons',
    'selectedPlatforms','aria','aria','platformPreview','applyTimeline','connect','fillScript','applyScript'
  ]);
  assert.deepEqual(h.calls.find(call => call[0] === 'state')[1], {script: h.result.script, selected_keywords: ['k1']});
  assert.deepEqual([...h.calls.find(call => call[0] === 'keywords')[1]], ['k1']);
  assert.deepEqual([...h.calls.find(call => call[0] === 'images')[1].keys()], ['s1','s2']);
  assert.deepEqual([...h.calls.find(call => call[0] === 'voices')[1].keys()], ['s1','s2']);
  assert.deepEqual([...h.calls.find(call => call[0] === 'videos')[1].keys()], ['s2']);
  assert.deepEqual(h.calls.find(call => call[0] === 'brandHydrate')[1], {assets: h.result.brand_assets, selections: h.result.brand_selections});
  assert.deepEqual([...h.selectedPlatforms], ['instagram','youtube']);
  assert.deepEqual(h.calls.filter(call => call[0] === 'aria').map(call => [call[1],call[3]]), [['youtube','true'],['instagram','true']]);
  assert.deepEqual(h.calls.find(call => call[0] === 'platformPreview'), ['platformPreview','instagram']);

  for (const options of [{stale: true}, {activeProjectId: 'other'}]) {
    h = harness(options);
    assert.equal(await h.controller.loadContent('project / 한글', 4), h.result);
    assert.deepEqual(h.calls.map(call => call[0]), ['request','stale'], 'stale or switched project has no hydration side effects');
  }

  h = harness({requestError: new Error('offline')});
  await assert.rejects(h.controller.loadContent('project / 한글', 1), /offline/);
  assert.deepEqual(h.calls.map(call => call[0]), ['request']);

  const minimal = {timeline: {}, script: {}, selected_keyword_ids: null, document: null, automation_editor: {channels: []}};
  h = harness({result: minimal});
  await h.controller.loadContent('project / 한글', 2);
  assert.equal(h.calls.some(call => call[0] === 'crop'), false, 'missing crop preserves existing state');
  assert.deepEqual(h.calls.find(call => call[0] === 'state')[1].selected_keywords, []);
  assert.deepEqual([...h.calls.find(call => call[0] === 'images')[1], ...h.calls.find(call => call[0] === 'voices')[1], ...h.calls.find(call => call[0] === 'videos')[1]], []);
  assert.deepEqual(h.calls.find(call => call[0] === 'brandHydrate')[1], {assets: [], selections: []});
  assert.equal(h.calls.some(call => call[0] === 'platformPreview'), false, 'empty configured channels do not change preview');
  assert.deepEqual([...h.selectedPlatforms], [], 'empty configured channels still clear selection');
  assert.deepEqual(h.calls.find(call => call[0] === 'voiceProfile'), ['voiceProfile','warm_female']);

  h = harness({result: {...minimal, automation_editor: null}});
  await h.controller.loadContent('project / 한글', 2);
  assert.equal(h.calls.some(call => ['platformButtons','selectedPlatforms','aria','platformPreview'].includes(call[0])), false, 'missing channel array preserves platform state');
  assert.deepEqual([...h.selectedPlatforms], ['old']);

  h = harness({throwAt: 'brandRender'});
  await assert.rejects(h.controller.loadContent('project / 한글', 3), /failed brandRender/);
  assert.equal(h.calls.some(call => call[0] === 'brandHydrate'), true);
  assert.equal(h.calls.some(call => call[0] === 'platformButtons'), false);
  assert.equal(h.calls.some(call => call[0] === 'applyTimeline'), false, 'callback errors retain partial application and stop later work');

  console.log('Project hydration controller tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
