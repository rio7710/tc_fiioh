const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('01_app/P1_title_design_preview.html', 'utf8');
const resetStart = html.indexOf('function resetProjectScopedState()');
const resetEnd = html.indexOf('\nconst keywordTilts=', resetStart);
assert.ok(resetStart >= 0 && resetEnd > resetStart, 'project reset helper must exist');

const context = vm.createContext({window:{Step04VideoEditor:{setSceneCropPositions(value){context.editorCropPositions=value;}}}});
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

const deleteStart = html.indexOf("document.querySelector('#projectDeleteButton')");
const deleteEnd = html.indexOf("document.querySelector('#createProjectButton')",deleteStart);
const deleteHandler = html.slice(deleteStart,deleteEnd);
const deleteApi = deleteHandler.indexOf("await api('/api/project/delete'");
const deleteReset = deleteHandler.indexOf('resetProjectScopedState()');
assert.ok(deleteApi >= 0 && deleteReset > deleteApi,'delete must reset only after the API succeeds');
assert.equal((deleteHandler.match(/resetProjectScopedState\(\)/g)||[]).length,1,'delete reset must have one success-path call');

const createStart = deleteEnd;
const createEnd = html.indexOf('\nlet trendRequestVersion=',createStart);
const createHandler = html.slice(createStart,createEnd);
const createApi = createHandler.indexOf("await api('/api/projects'");
const createReset = createHandler.indexOf('resetProjectScopedState()');
const assignNewProject = createHandler.indexOf('activeProjectId=result.project.project_id');
assert.ok(createApi >= 0 && createReset > createApi,'create must preserve state when the API fails');
assert.ok(assignNewProject > createReset,'create must reset old state before adopting the new project');
assert.equal((createHandler.match(/resetProjectScopedState\(\)/g)||[]).length,1,'create reset must have one success-path call');

console.log('PASS: project-scoped state reset and success-only delete/create wiring');
