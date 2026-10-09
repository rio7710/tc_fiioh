const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ContentIndexController = require('../01_app/assets/steps/step01/step01-content-index-controller.js');

(async () => {

const html = fs.readFileSync('01_app/P1_title_design_preview.html', 'utf8');
assert.match(html, /let demoData=\{state:\{\},timeline:\{scenes:\[\]\},keywords:\[\]\};/, 'project restore starts from a safe non-null demo state');
const resetStart = html.indexOf('function resetProjectScopedState()');
const resetEnd = html.indexOf('\nconst keywordTilts=', resetStart);
assert.ok(resetStart >= 0 && resetEnd > resetStart, 'project reset helper must exist');

const context = vm.createContext({
  timelineBridge: { reset() { context.timelineBridgeResetCount += 1; } },
  timelineBridgeResetCount: 0,
  window: { Step04VideoEditor: { setSceneCropPositions(value) { context.editorCropPositions = value; } } }
});
vm.runInContext(`
  let scenes=[{id:'old'}];
  let sceneCropPositions={old:{x:1}};
  let storedStoryboardImages=new Map([['old',{}]]);
  let storedStoryboardImageCandidates=new Map([['old',[{}]]]);
  let storedStoryboardVoiceClips=new Map([['old',{}]]);
  let storedStoryboardVideos=new Map([['old',{}]]);
  let storedStoryboardVideoCandidates=new Map([['old',[{}]]]);
  let selectedKeywords=new Set(['old']);
  let activeProjectId='old-project';
  ${html.slice(resetStart, resetEnd)}
  resetProjectScopedState();
`, context);

for (const expression of [
  'scenes.length',
  'Object.keys(sceneCropPositions).length',
  'storedStoryboardImages.size',
  'storedStoryboardImageCandidates.size',
  'storedStoryboardVoiceClips.size',
  'storedStoryboardVideos.size',
  'storedStoryboardVideoCandidates.size',
  'selectedKeywords.size'
]) assert.equal(vm.runInContext(expression,context),0,`${expression} must be cleared`);
assert.equal(vm.runInContext('activeProjectId',context),'old-project','helper must not clear project identity');
assert.equal(Object.keys(context.editorCropPositions).length,0,'Step 4 crop state must be cleared');
assert.equal(context.timelineBridgeResetCount,1,'Step 4 timeline bridge state must be reset exactly once');

const calls=[];
let active='old-project';
let request=async path=>path==='/api/projects'?{project:{project_id:'new-project'}}:{};
const controller=ContentIndexController.create({
  request:(...args)=>{calls.push(['api',args[0]]);return request(...args)},getProjects:()=>({'old-project':{title:'Old'}}),getActiveProjectId:()=>active,
  beginNav(){},setActiveProjectId(id){active=id;calls.push(['active',id])},showStep(step){calls.push(['show',step])},showBrandLibrary(){},navigateProjectStep:async()=>{},
  resetProjectScopedState(){calls.push(['reset'])},setKeywordStageLocked(){calls.push(['unlock'])},setVoiceProfile(){calls.push(['voice'])},getKeywords:()=>[],
  setVisibleKeywordIds(){calls.push(['keywords'])},renderKeywords(){calls.push(['render'])},refreshProjectIndex:async()=>calls.push(['refresh']),confirm:()=>true,alert(){calls.push(['alert'])},
  escapeHtml:String,projectCreatedDate:String
});
const eventNode={dataset:{},textContent:'',addEventListener(){},removeEventListener(){}};
controller.mount({querySelector:selector=>selector==='#projectDetailNote'?{textContent:''}:eventNode,querySelectorAll:()=>[]});
await controller.deleteProject({disabled:false});
assert.deepEqual(calls.map(item=>item[0]),['api','reset','active','unlock','refresh','show'],'delete resets once and only after API success');
calls.length=0;active='old-project';request=async()=>{throw new Error('failed')};
await controller.deleteProject({disabled:false});
assert.equal(calls.some(item=>item[0]==='reset'),false,'failed delete preserves project state');
calls.length=0;request=async()=>({project:{project_id:'new-project'}});
await controller.createProject({disabled:false});
assert.deepEqual(calls.slice(0,3),[['api','/api/projects'],['reset'],['active','new-project']],'create resets old state before adopting new project');
assert.equal(calls.filter(item=>item[0]==='reset').length,1,'create resets exactly once');
calls.length=0;request=async()=>{throw new Error('failed')};
await controller.createProject({disabled:false});
assert.equal(calls.some(item=>item[0]==='reset'),false,'failed create preserves project state');

console.log('PASS: project-scoped state reset and success-only delete/create wiring');
})().catch(error=>{console.error(error);process.exitCode=1});
