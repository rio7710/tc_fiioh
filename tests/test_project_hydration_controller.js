const assert=require('node:assert/strict');
const Hydration=require('../01_app/assets/core/project-hydration-controller.js');

(async()=>{
  const valid={request(){},isStale(){},getActiveProjectId(){},applier:{applyContent(){},applyState(){}}};
  assert.throws(()=>Hydration.create(),/requires request/);
  for(const name of Object.keys(valid)){const deps={...valid};delete deps[name];assert.throws(()=>Hydration.create(deps),new RegExp(`requires ${name}`))}
  let active='project / 한글',stale=false,result={identity:true},requestError=null;const calls=[];
  const applier={applyContent:value=>calls.push(['content',value]),applyState:value=>calls.push(['state',value])};
  const controller=Hydration.create({request:async url=>{calls.push(['request',url]);if(requestError)throw requestError;return result},isStale:token=>{calls.push(['stale',token]);return stale},getActiveProjectId:()=>active,applier});
  assert.equal(Object.isFrozen(controller),true);
  let returned=await controller.loadContent('project / 한글',7);assert.equal(returned,result);assert.deepEqual(calls,[['request','/api/project-content?project_id=project%20%2F%20%ED%95%9C%EA%B8%80'],['stale',7],['content',result]]);
  calls.length=0;returned=await controller.loadState('project / 한글',8);assert.equal(returned,result);assert.deepEqual(calls,[['request','/api/project-state?project_id=project%20%2F%20%ED%95%9C%EA%B8%80'],['stale',8],['state',result]]);
  for(const mode of ['stale','mismatch']){calls.length=0;stale=mode==='stale';active=mode==='mismatch'?'other':'project / 한글';returned=await controller.loadContent('project / 한글',9);assert.equal(returned,result);assert.equal(calls.some(call=>call[0]==='content'||call[0]==='state'),false,`${mode} skips applier`)}
  stale=false;active='project / 한글';calls.length=0;requestError=new Error('offline');await assert.rejects(()=>controller.loadState('project / 한글',10),/offline/);assert.deepEqual(calls,[['request','/api/project-state?project_id=project%20%2F%20%ED%95%9C%EA%B8%80']]);
  const source=require('node:fs').readFileSync('01_app/assets/core/project-hydration-controller.js','utf8');assert.doesNotMatch(source,/setSceneCropPositions|setDemoTimeline|setSelectedKeywords/);
  console.log('Project hydration controller tests passed');
})().catch(error=>{console.error(error);process.exitCode=1});
