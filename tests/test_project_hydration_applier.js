const assert = require('node:assert/strict');
const Applier = require('../01_app/assets/core/project-hydration-applier.js');

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
      connectStoryboardAssetsToEditor: () => calls.push(['connect']), fillScript: record('fillScript'), applyScript: record('applyScript'),
      keywordHydrator:{applyContent:ids=>{calls.push(['keywordContent',ids||[]]);if(overrides.throwAt==='keywordContent')throw new Error('failed keywordContent');return ids||[]},restoreState:(state,seasonal)=>{calls.push(['keywordState',state,seasonal]);if(overrides.throwAt==='keywordState')throw new Error('failed keywordState');return state?.selected_keyword_ids||[]}},
      mediaHydrator:{contentProfile:value=>value.voice_profile||'warm_female',stateProfile:value=>value.content?.voice_profile||'warm_female',applyCropPositions:value=>{if(value.scene_crop_positions)record('crop')(value.scene_crop_positions)},applyMedia:(value,profile)=>{record('images')(new Map((value.storyboard_images||[]).map(item=>[item.scene_id,item])));record('imageCandidates')(value.storyboard_image_candidates||[]);record('voices')(new Map((value.storyboard_voice_clips||[]).filter(item=>!item.profile_id||item.profile_id===profile).map(item=>[item.scene_id,item])));record('videos')(new Map((value.storyboard_videos||[]).map(item=>[item.scene_id,item])));record('videoCandidates')(value.storyboard_video_candidates||[])},applyVoiceProfile:record('voiceProfile')},
      brandPlatformHydrator:{applyContent:value=>{record('brandHydrate')({assets:value.brand_assets||[],selections:value.brand_selections||[]});calls.push(['brandRender']);if(overrides.throwAt==='brandRender')throw new Error('failed brandRender');if(Array.isArray(value.automation_editor?.channels)){calls.push(['platformButtons']);const channels=value.automation_editor.channels.filter(channel=>buttons.some(button=>button.dataset.platform===channel));calls.push(['selectedPlatforms']);selectedPlatforms.clear();channels.forEach(channel=>selectedPlatforms.add(channel));buttons.forEach(button=>button.setAttribute('aria-pressed',String(selectedPlatforms.has(button.dataset.platform))));if(channels.length)record('platformPreview')(channels[0])}}},
      editorHydrator:{contentStart:value=>{record('timeline')(value.timeline);record('state')({script:value.script,selected_keywords:value.selected_keyword_ids||[]})},contentDocument:value=>{record('document')(value.document||null);record('lock')(Boolean(value.document))},contentEditor:value=>{record('applyTimeline')(value.timeline);calls.push(['connect']);record('fillScript')(value.script);record('applyScript')(value.script)},stateDocument:value=>{record('lock')(true);record('document')(value.document||null)},stateEditor:(value,ids)=>{record('timeline')(value.timeline);record('state')({script:value.script,selected_keywords:ids});record('applyTimeline')(value.timeline);record('fillScript')(value.script);record('applyScript')(value.script)},stateWithoutContent:()=>record('lock')(false)}
    };
    return {applier:Applier.create(deps),calls,result,selectedPlatforms,buttons};
  }

  assert.throws(() => Applier.create(), /requires keywordHydrator/);
  const required = {
    keywordHydrator:{applyContent(){},restoreState(){}},mediaHydrator:{contentProfile(){},stateProfile(){},applyCropPositions(){},applyMedia(){},applyVoiceProfile(){}},brandPlatformHydrator:{applyContent(){}},editorHydrator:{contentStart(){},contentDocument(){},contentEditor(){},stateDocument(){},stateEditor(){},stateWithoutContent(){}}
  };
  for (const name of Object.keys(required)) {
    const deps = {...required}; delete deps[name];
    assert.throws(() => Applier.create(deps), new RegExp(`requires ${name}`));
  }
  let h = harness();
  assert.equal(Object.isFrozen(h.applier), true);

  const returned = h.applier.applyContent(h.result);
  assert.equal(returned, h.result);
  assert.deepEqual(h.calls.map(call => call[0]), [
    'crop','timeline','state','keywordContent','document','lock','images','imageCandidates',
    'voices','videos','videoCandidates','voiceProfile','brandHydrate','brandRender','platformButtons',
    'selectedPlatforms','aria','aria','platformPreview','applyTimeline','connect','fillScript','applyScript'
  ]);
  assert.deepEqual(h.calls.find(call => call[0] === 'state')[1], {script: h.result.script, selected_keywords: ['k1']});
  assert.deepEqual(h.calls.find(call => call[0] === 'keywordContent')[1], ['k1']);
  assert.deepEqual([...h.calls.find(call => call[0] === 'images')[1].keys()], ['s1','s2']);
  assert.deepEqual([...h.calls.find(call => call[0] === 'voices')[1].keys()], ['s1','s2']);
  assert.deepEqual([...h.calls.find(call => call[0] === 'videos')[1].keys()], ['s2']);
  assert.deepEqual(h.calls.find(call => call[0] === 'brandHydrate')[1], {assets: h.result.brand_assets, selections: h.result.brand_selections});
  assert.deepEqual([...h.selectedPlatforms], ['instagram','youtube']);
  assert.deepEqual(h.calls.filter(call => call[0] === 'aria').map(call => [call[1],call[3]]), [['youtube','true'],['instagram','true']]);
  assert.deepEqual(h.calls.find(call => call[0] === 'platformPreview'), ['platformPreview','instagram']);

  const minimal = {timeline: {}, script: {}, selected_keyword_ids: null, document: null, automation_editor: {channels: []}};
  h = harness({result: minimal});
  h.applier.applyContent(h.result);
  assert.equal(h.calls.some(call => call[0] === 'crop'), false, 'missing crop preserves existing state');
  assert.deepEqual(h.calls.find(call => call[0] === 'state')[1].selected_keywords, []);
  assert.deepEqual([...h.calls.find(call => call[0] === 'images')[1], ...h.calls.find(call => call[0] === 'voices')[1], ...h.calls.find(call => call[0] === 'videos')[1]], []);
  assert.deepEqual(h.calls.find(call => call[0] === 'brandHydrate')[1], {assets: [], selections: []});
  assert.equal(h.calls.some(call => call[0] === 'platformPreview'), false, 'empty configured channels do not change preview');
  assert.deepEqual([...h.selectedPlatforms], [], 'empty configured channels still clear selection');
  assert.deepEqual(h.calls.find(call => call[0] === 'voiceProfile'), ['voiceProfile','warm_female']);

  h = harness({result: {...minimal, automation_editor: null}});
  h.applier.applyContent(h.result);
  assert.equal(h.calls.some(call => ['platformButtons','selectedPlatforms','aria','platformPreview'].includes(call[0])), false, 'missing channel array preserves platform state');
  assert.deepEqual([...h.selectedPlatforms], ['old']);

  h = harness({throwAt: 'brandRender'});
  assert.throws(()=>h.applier.applyContent(h.result),/failed brandRender/);
  assert.equal(h.calls.some(call => call[0] === 'brandHydrate'), true);
  assert.equal(h.calls.some(call => call[0] === 'platformButtons'), false);
  assert.equal(h.calls.some(call => call[0] === 'applyTimeline'), false, 'callback errors retain partial application and stop later work');

  const stateResult = {
    scene_crop_positions: {},
    storyboard_images: [{scene_id: 's1'}, {scene_id: 's2'}],
    storyboard_image_candidates: [{scene_id: 's1', candidate: 1}],
    storyboard_voice_clips: [
      {scene_id: 's1', profile_id: 'qwen_narrator'}, {scene_id: 's2'}, {scene_id: 's3', profile_id: 'warm_female'}
    ],
    storyboard_videos: [{scene_id: 's2'}], storyboard_video_candidates: [{scene_id: 's2', candidate: 1}],
    keywords: {selected_keyword_ids: ['base-2', 'ai-1', 'missing'], selected_keywords: ['기본', '계절', '복원']},
    seasonal_keywords: [{id: 'ai-1', label: '계절', seasonal: true}],
    content: {voice_profile: 'qwen_narrator', document: {production: {}}, timeline: {scenes: [{id: 's1'}]}, script: {lines: ['line']}}
  };
  h = harness({result: stateResult});
  assert.equal(h.applier.applyState(stateResult), stateResult);
  assert.deepEqual(h.calls.map(call => call[0]), [
    'crop','images','imageCandidates','voices','videos','videoCandidates','keywordState',
    'lock','document','voiceProfile','timeline','state','applyTimeline','fillScript','applyScript'
  ]);
  assert.deepEqual([...h.calls.find(call => call[0] === 'voices')[1].keys()], ['s1','s2'], 'state voice filter uses content voice profile');
  assert.deepEqual(h.calls.find(call=>call[0]==='keywordState').slice(1),[stateResult.keywords,stateResult.seasonal_keywords]);
  assert.deepEqual(h.calls.find(call => call[0] === 'state')[1], {script: stateResult.content.script, selected_keywords: ['base-2','ai-1','missing']});

  const stateWithoutContent = {
    keywords: null, seasonal_keywords: {}, storyboard_voice_clips: [{scene_id:'s1'},{scene_id:'s2',profile_id:'other'}]
  };
  h = harness({result: stateWithoutContent});
  h.applier.applyState(h.result);
  assert.equal(h.calls.some(call => call[0] === 'crop'), false, 'missing state crop preserves existing crop');
  assert.deepEqual([...h.calls.find(call => call[0] === 'voices')[1].keys()], ['s1'], 'missing content uses warm_female default filter');
  assert.deepEqual(h.calls.at(-1), ['lock', false]);
  assert.equal(h.calls.some(call => ['document','voiceProfile','timeline','state','applyTimeline','fillScript','applyScript'].includes(call[0])), false, 'content-falsy state only unlocks after keyword render');

  h = harness({result: stateResult, throwAt: 'keywordState'});
  assert.throws(()=>h.applier.applyState(h.result),/failed keywordState/);
  assert.equal(h.calls.some(call => call[0] === 'keywordState'), true);
  assert.equal(h.calls.some(call => call[0] === 'lock'), false, 'callback failure preserves partial state and stops later work');

  console.log('Project hydration applier tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
