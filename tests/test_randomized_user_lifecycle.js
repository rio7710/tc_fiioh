const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ThinkCastContentRoute = require('../01_app/assets/core/content-route.js');
const ThinkCastProjectStore = require('../01_app/assets/core/project-store.js');
const ThinkCastShellNavigationController = require('../01_app/assets/core/shell-navigation-controller.js');

const html = fs.readFileSync('01_app/P1_title_design_preview.html', 'utf8');

function sourceBetween(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `missing source block: ${start}`);
  return html.slice(from, to);
}

function functionSource(signature) {
  const start = html.indexOf(signature);
  assert.ok(start >= 0, `missing function: ${signature}`);
  const bodyStart = html.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    if (html[index] === '}' && --depth === 0) return html.slice(start, index + 1);
  }
  assert.fail(`incomplete function: ${signature}`);
}

const resetSource = functionSource('function resetProjectScopedState()');

function mulberry32(seed) {
  return function random() {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function lifecycle(seed) {
  const projects = new Set();
  let current = new URL('https://tc.test/app.html#index');
  const entries = [current.href];
  let position = 0;
  const storage = new Map();
  const views = ['stepIndex', 'stepProject', 'step1', 'step2', 'step3', 'step31', 'step4', 'step5']
    .map(id => ({id, hidden: true}));
  const elements = {};
  const cropCalls = [];
  let timelineResetCalls = 0;
  let expectedProjectResets = 0;
  const context = vm.createContext({
    ThinkCastContentRoute, ThinkCastProjectStore,
    timelineBridge: {reset() { timelineResetCalls += 1; }},
    URL,
    console,
    isLoggedIn: true,
    userSettings: {voice: 'warm_female', watermark: 'user-logo'},
    window: {
      scrollTo() {},
      addEventListener() {},
      removeEventListener() {},
      Step04VideoEditor: {setSceneCropPositions(value) { cropCalls.push(value); }}
    },
    document: {
      addEventListener() {}, removeEventListener() {},
      querySelectorAll() { return views; },
      querySelector(selector) {
        if (selector === 'thinkcast-top-nav') return {setActive() {},addEventListener() {},removeEventListener() {}};
        return elements[selector] ||= {textContent: '', hidden: true};
      }
    },
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    history: {
      pushState(_state, _title, href) {
        current = new URL(href); entries.splice(++position); entries.push(current.href);
      },
      replaceState(_state, _title, href) { current = new URL(href); entries[position] = current.href; }
    },
    video: {pause() {}},
    updateContentUuidLabels() {},
    refreshProjectIndex: async () => {},
    loadProjectState: async id => ({content: projects.has(id)}),
    loadProjectContent: async () => ({}),
    renderStoryboardGrid() {},
    connectStoryboardAssetsToEditor() {}
  });
  Object.defineProperty(context, 'location', {get: () => current});
  vm.runInContext(`
    let scenes=[];
    let sceneCropPositions={};
    let storedStoryboardImages=new Map();
    let storedStoryboardImageCandidates=new Map();
    let storedStoryboardVoiceClips=new Map();
    let storedStoryboardVideos=new Map();
    let storedStoryboardVideoCandidates=new Map();
    let selectedKeywords=new Set();
    ${resetSource}
    const ACTIVE_PROJECT_STORAGE_KEY='thinkcast-active-project-v1';
    let activeProjectId=null;
    const projectStore=ThinkCastProjectStore.createProjectStore({activeProjectId:null});
    function setActiveProjectId(id){activeProjectId=id;if(id)localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY,id);else localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);projectStore.setActiveProject(id)}
    const indexProjects={};
    function readContentRoute(){return shellNavigationController.readRoute()}
    function writeContentRoute(step,mode='push'){return shellNavigationController.writeRoute(step,mode)}
    function selectRouteProject(route){return shellNavigationController.selectRouteProject(route)}
    function restoreContentRoute(){return shellNavigationController.restoreRoute()}
    function showStep(step,mode='push'){return shellNavigationController.showStep(step,mode)}
    function prepareRestoredStep(step){return shellNavigationController.prepareStep(step)}
    function navigateProjectStep(step,options){return shellNavigationController.navigate(step,options)}
    function beginNav(){return shellNavigationController.begin()}
    function isStaleNav(token){return shellNavigationController.isStale(token)}
  `, context);
  vm.runInContext(`function openIndexProject(id,mode='push'){
    if(!indexProjects[id])return;beginNav();activeProjectId=id;
    localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY,id);showStep('project',mode);
  }`, context);
  context.shellNavigationController=ThinkCastShellNavigationController.create({
    contentRoute:ThinkCastContentRoute,getLocation:()=>context.location,getHistory:()=>context.history,getWindow:()=>context.window,
    isLoggedIn:()=>context.isLoggedIn,getActiveProjectId:()=>vm.runInContext('activeProjectId',context),setActiveProjectId:id=>context.setActiveProjectId(id),
    getProjects:()=>vm.runInContext('indexProjects',context),refreshProjectIndex:context.refreshProjectIndex,
    loadProjectState:(...args)=>context.loadProjectState(...args),loadProjectContent:(...args)=>context.loadProjectContent(...args),openIndexProject:(...args)=>context.openIndexProject(...args),
    updateContentUuidLabels:context.updateContentUuidLabels,getPreviewVideo:()=>context.video,scrollTo:options=>context.window.scrollTo(options),
    renderStoryboardGrid:context.renderStoryboardGrid,connectStoryboardAssetsToEditor:context.connectStoryboardAssetsToEditor,
    setContentIndexError:(_key,message)=>{context.document.querySelector('#contentIndexMessage').textContent=message},onError(){}
  });
  context.shellNavigationController.mount(context.document);

  let nextId = seed * 1000;
  const random = mulberry32(seed);
  const scopedSizes = () => ({...vm.runInContext(`({
    scenes:scenes.length,crops:Object.keys(sceneCropPositions).length,images:storedStoryboardImages.size,
    imageCandidates:storedStoryboardImageCandidates.size,voices:storedStoryboardVoiceClips.size,
    videos:storedStoryboardVideos.size,videoCandidates:storedStoryboardVideoCandidates.size,
    keywords:selectedKeywords.size
  })`, context)});
  const dirtyScoped = () => vm.runInContext(`
    scenes=[{id:'dirty'}];sceneCropPositions={dirty:{x:1}};
    storedStoryboardImages=new Map([['dirty',{}]]);storedStoryboardImageCandidates=new Map([['dirty',[{}]]]);
    storedStoryboardVoiceClips=new Map([['dirty',{}]]);storedStoryboardVideos=new Map([['dirty',{}]]);
    storedStoryboardVideoCandidates=new Map([['dirty',[{}]]]);selectedKeywords=new Set(['dirty']);
  `, context);
  const syncProjects = () => {
    vm.runInContext('Object.keys(indexProjects).forEach(key=>delete indexProjects[key])', context);
    for (const id of projects) vm.runInContext(`indexProjects[${JSON.stringify(id)}]={}`, context);
  };
  const active = () => vm.runInContext('activeProjectId', context);
  const route = () => ({href: current.href, active: active(), visible: views.find(view => !view.hidden)?.id});
  const resetWasComplete = () => assert.deepEqual(scopedSizes(), {
    scenes: 0, crops: 0, images: 0, imageCandidates: 0, voices: 0, videos: 0, videoCandidates: 0, keywords: 0
  });
  const assertResetCount = () => assert.equal(timelineResetCalls, expectedProjectResets, 'timeline reset count follows successful create/delete resets');

  return {
    random,
    projects,
    async create(succeed) {
      dirtyScoped(); const before = scopedSizes();
      if (!succeed) { assert.deepEqual(scopedSizes(), before); assertResetCount(); return; }
      const id = `p-${++nextId}`; projects.add(id); syncProjects();
      expectedProjectResets += 1; context.resetProjectScopedState(); assertResetCount(); vm.runInContext(`activeProjectId=${JSON.stringify(id)}`, context);
      storage.set('thinkcast-active-project-v1', id); vm.runInContext("showStep('2')", context); resetWasComplete();
      assert.deepEqual(context.userSettings, {voice: 'warm_female', watermark: 'user-logo'});
    },
    async select() {
      if (!projects.size) return;
      const ids = [...projects]; const id = ids[Math.floor(random() * ids.length)];
      vm.runInContext(`activeProjectId=${JSON.stringify(id)};localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY,activeProjectId);showStep('project')`, context);
      assert.equal(new URL(current).searchParams.get('project_id'), id);
    },
    async navigate() {
      if (!active()) return;
      const steps = ['2', '3', '3-1', '4', '5'];
      const step = steps[Math.floor(random() * steps.length)];
      await context.navigateProjectStep(step);
      assert.equal(new URL(current).searchParams.get('project_id'), active());
    },
    async travel() {
      if (entries.length < 2) return;
      const delta = position > 0 && (position === entries.length - 1 || random() < .5) ? -1 : 1;
      position += delta; current = new URL(entries[position]); await context.restoreContentRoute();
      const parsed = new URL(current);
      if (parsed.searchParams.has('project_id')) assert.equal(active(), parsed.searchParams.get('project_id'));
    },
    async reconnect() {
      const before = route();
      const beforeUrl = new URL(before.href);
      const expectedProject = beforeUrl.searchParams.get('project_id') || before.active;
      vm.runInContext("restoredRouteUrl=''", context); await context.restoreContentRoute();
      const after = route();
      assert.equal(after.active, expectedProject); assert.equal(new URL(after.href).hash, beforeUrl.hash);
      assert.equal(new URL(after.href).searchParams.get('project_id'), after.active);
      assert.equal(after.visible, before.visible);
    },
    async remove(succeed) {
      const id = active(); if (!id) return;
      dirtyScoped(); const before = scopedSizes();
      if (!succeed) { assert.ok(projects.has(id)); assert.equal(active(), id); assert.deepEqual(scopedSizes(), before); assertResetCount(); return; }
      projects.delete(id); syncProjects(); expectedProjectResets += 1; context.resetProjectScopedState(); assertResetCount(); storage.delete('thinkcast-active-project-v1');
      vm.runInContext("activeProjectId=null;showStep('index')", context); resetWasComplete();
      assert.ok(!projects.has(id)); assert.equal(new URL(current).searchParams.has('project_id'), false);
      assert.deepEqual(context.userSettings, {voice: 'warm_female', watermark: 'user-logo'});
    }
  };
}

(async () => {
  const seeds = 128;
  const randomSteps = 72;
  let actionCount = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const app = lifecycle(seed);
    const required = [
      ['create-failure', () => app.create(false)], ['create-success', () => app.create(true)],
      ['select', () => app.select()], ['navigate', () => app.navigate()],
      ['reconnect', () => app.reconnect()], ['back-forward', () => app.travel()],
      ['delete-failure', () => app.remove(false)], ['delete-success', () => app.remove(true)]
    ];
    const randomActions = [
      ['create-success', () => app.create(true)], ['create-failure', () => app.create(false)],
      ['select', () => app.select()], ['navigate', () => app.navigate()], ['back-forward', () => app.travel()],
      ['reconnect', () => app.reconnect()], ['delete-success', () => app.remove(true)], ['delete-failure', () => app.remove(false)]
    ];
    const actions = required.concat(Array.from({length: randomSteps}, () => randomActions[Math.floor(app.random() * randomActions.length)]));
    for (let step = 0; step < actions.length; step++) {
      const [name, run] = actions[step];
      try { await run(); actionCount++; }
      catch (error) { console.error(`FAIL seed=${seed} step=${step} action=${name}`); throw error; }
    }
  }
  console.log(`PASS: randomized frontend lifecycle seeds=${seeds} actions=${actionCount}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
