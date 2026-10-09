const assert = require('node:assert/strict');
const fs = require('node:fs');
const ContentIndexController = require('../01_app/assets/steps/step01/step01-content-index-controller.js');
const StoryboardProjectStateController = require('../01_app/assets/steps/step03/storyboard-project-state-controller.js');

(async () => {

const shell = fs.readFileSync('01_app/P1_title_design_preview.html', 'utf8');
const bootstrap = fs.readFileSync('01_app/assets/core/app-bootstrap.js', 'utf8');
const html = `${shell}\n${bootstrap}`;
assert.match(html, /let demoData=\{state:\{\},timeline:\{scenes:\[\]\},keywords:\[\]\};/, 'project restore starts from a safe non-null demo state');
assert.match(html, /function resetProjectScopedState\(\)\{\s*return storyboardProjectStateController\.reset\(\);\s*\}/, 'P1 reset is a thin controller wrapper');
let scenes=[{id:'old'}],currentScene=4,timeline={scenes:[{id:'old'}]},crops={old:{x:1}};
let images=new Map([['old',{}]]),imageCandidates=new Map([['old',[{}]]]);
let voices=new Map([['old',{}]]),videos=new Map([['old',{}]]),videoCandidates=new Map([['old',[{}]]]);
let keywords=new Set(['old']),documentState={old:true};
let timelineBridgeResetCount=0,editorCropResetCount=0,projectStoreResetCount=0;
const projectIdentity='old-project';
const stateController=StoryboardProjectStateController.create({
  getRoot:()=>({querySelector:()=>null}),getScenes:()=>scenes,setScenes:value=>{scenes=value},setCurrentScene:value=>{currentScene=value},
  connectTimeline:value=>({scenes:value}),resetTimeline:()=>{timelineBridgeResetCount+=1},setDemoTimeline:value=>{timeline=value},setCropPositions:value=>{crops=value},
  setImages:value=>{images=value},setImageCandidates:value=>{imageCandidates=value},setVoiceClips:value=>{voices=value},setVideos:value=>{videos=value},setVideoCandidates:value=>{videoCandidates=value},
  clearKeywords:()=>keywords.clear(),setActiveStoryboardDocument:value=>{documentState=value},resetEditorCrops:value=>{editorCropResetCount+=1;assert.deepEqual(value,{})},
  getStep04VideoEditor:()=>null,getFallbackSync:()=>null,resetProjectStore:()=>{projectStoreResetCount+=1}
});
stateController.reset();
assert.equal(scenes.length,0);assert.equal(currentScene,-1);assert.deepEqual(timeline,{scenes:[]});assert.deepEqual(crops,{});
for(const state of [images,imageCandidates,voices,videos,videoCandidates])assert.equal(state.size,0);
assert.equal(keywords.size,0);assert.equal(documentState,null);assert.equal(projectIdentity,'old-project','helper must not clear project identity');
assert.equal(editorCropResetCount,1,'Step 4 crop state must be reset exactly once');
assert.equal(timelineBridgeResetCount,1,'Step 4 timeline bridge state must be reset exactly once');
assert.equal(projectStoreResetCount,1,'project store state must be reset exactly once');

const calls=[];
let active='old-project';
let request=async path=>path==='/api/projects'?{project:{project_id:'new-project'}}:{};
const controller=ContentIndexController.create({
  view:{mount(){},unmount(){},renderDetail(){},applyFilter(){},setNote(){},setBusy(){}},
  request:(...args)=>{calls.push(['api',args[0]]);return request(...args)},getProjects:()=>({'old-project':{title:'Old'}}),getActiveProjectId:()=>active,
  beginNav(){},setActiveProjectId(id){active=id;calls.push(['active',id])},showStep(step){calls.push(['show',step])},showBrandLibrary(){},navigateProjectStep:async()=>{},
  resetProjectScopedState(){calls.push(['reset'])},setKeywordStageLocked(){calls.push(['unlock'])},setVoiceProfile(){calls.push(['voice'])},getKeywords:()=>[],
  setVisibleKeywordIds(){calls.push(['keywords'])},renderKeywords(){calls.push(['render'])},refreshProjectIndex:async()=>calls.push(['refresh']),confirm:()=>true,alert(){calls.push(['alert'])},
});
const eventNode={dataset:{},textContent:'',addEventListener(){},removeEventListener(){}};
controller.mount({querySelector:selector=>selector==='#projectDetailNote'?{textContent:''}:eventNode,querySelectorAll:()=>[]});
await controller.deleteProject();
assert.deepEqual(calls.map(item=>item[0]),['api','reset','active','unlock','refresh','show'],'delete resets once and only after API success');
calls.length=0;active='old-project';request=async()=>{throw new Error('failed')};
await controller.deleteProject();
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
