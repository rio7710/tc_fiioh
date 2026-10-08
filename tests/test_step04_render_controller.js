const assert = require('node:assert/strict');
const RenderController = require('../01_app/assets/steps/step04/step04-render-controller.js');

function classes() { const set = new Set(); return { add: (...v) => v.forEach(x => set.add(x)), remove: (...v) => v.forEach(x => set.delete(x)), toggle: (v, on) => on ? set.add(v) : set.delete(v), contains: v => set.has(v) }; }
function element() { return { textContent: '', innerHTML: '', hidden: true, disabled: false, style: {}, dataset: {}, classList: classes(), attrs: {}, setAttribute(k,v){this.attrs[k]=v;}, removeAttribute(k){delete this.attrs[k];}, addEventListener(){}, append(){}, querySelector(){return element();}, querySelectorAll(){return [];} }; }
function fixture(overrides = {}) {
  const captionBadges = [element(), element()];
  const roles = Array.from({length:4}, () => { const role=element(); const state=element(); role.querySelector=s=>s==='.ai-role-state'?state:element(); role.querySelectorAll=s=>s==='.scene-conversion-badge'?captionBadges:[]; return role; });
  const modal=element(); modal.querySelectorAll=()=>roles;
  const nodes = Object.fromEntries(['#renderStatus','#renderBtn','#aiProgressBar','#aiFootStatus','#aiWorkflowSummary','#aiNow'].map(id=>[id,element()]));
  const root={body:{classList:classes()},querySelector:s=>nodes[s]||null,createElement:()=>element()};
  let clears=0, intervalDelay=0, fetchBody=null, productions=0, shown=0;
  const deps={
    root,getLocation:()=>({protocol:'https:'}),ensureStepApiReady:async()=>true,saveBrandSelections:async()=>{},pausePreview(){},
    getRenderButton:()=>nodes['#renderBtn'],getRenderStatus:()=>nodes['#renderStatus'],configureWorkflowModal:()=>modal,
    setupCaptionProgressBadges(){},setupCompositeFormatBadges(){},setupSceneProgressBadges(){},
    applySequentialCaptionProgress(_r,n){captionBadges.forEach((b,i)=>b.dataset.status=i<n?'succeeded':'queued');},applyCompositeFormatProgress(){},applySequentialSceneProgress(){},
    getScenes:()=>[{id:'s1',end:5}],timelineDuration:()=>5,getPayload:id=>({job_id:id,project_id:'p',scene_crop_positions:{},scene_videos:[]}),
    fetch:async(_url,options)=>{fetchBody=JSON.parse(options.body);return {ok:true,json:async()=>({exports:[{filename:'<one>.mp4',url:'/one',platforms:['youtube']} ]})};},
    api:async()=>({phase:'captions'}),sleep:async()=>{},recordCurrentProduction(){productions++;},showLatestExport(){},showStep(step){shown=step;},
    platformLabels:{youtube:'유튜브'},escapeHtml:value=>String(value).replaceAll('<','&lt;').replaceAll('>','&gt;'),now:()=>123,random:()=>.5,
    setInterval(_fn,delay){intervalDelay=delay;return 9;},clearInterval(){clears++;},onError(){},...overrides
  };
  return {controller:RenderController.create(deps),nodes,modal,get:()=>({clears,intervalDelay,fetchBody,productions,shown})};
}

(async()=>{
  const file=fixture({getLocation:()=>({protocol:'file:'})}); await file.controller.start();
  assert.match(file.nodes['#renderStatus'].textContent,/bat/);
  const apiEarly=fixture({ensureStepApiReady:async()=>false}); await apiEarly.controller.start(); assert.equal(apiEarly.get().fetchBody,null);
  const brandEarly=fixture({saveBrandSelections:async()=>{throw new Error('brand');}}); await brandEarly.controller.start(); assert.equal(brandEarly.nodes['#renderStatus'].textContent,'브랜드 설정 저장 오류: brand');

  const success=fixture(); const result=await success.controller.start();
  assert.equal(success.get().intervalDelay,500); assert.equal(success.get().clears,1); assert.equal(success.get().fetchBody.project_id,'p');
  assert.match(success.get().fetchBody.job_id,/^render-123-/); assert.equal(success.get().productions,1); assert.equal(success.get().shown,5);
  assert.match(success.nodes['#renderStatus'].innerHTML,/유튜브/); assert.match(success.nodes['#renderStatus'].innerHTML,/&lt;one&gt;\.mp4/);
  assert.equal(success.nodes['#renderBtn'].disabled,false); assert.equal(success.nodes['#renderBtn'].textContent,'최종 영상 제작'); assert.ok(result.exports);

  let release; const duplicate=fixture({fetch:()=>new Promise(resolve=>{release=resolve;})});
  const first=duplicate.controller.start(); const second=await duplicate.controller.start(); assert.equal(second,undefined);
  while(!release) await Promise.resolve();
  release({ok:true,json:async()=>({filename:'x',url:'/x'})}); await first;

  let recoveryCalls=0;
  const recovered=fixture({fetch:async()=>{throw new Error('drop');},api:async()=>{recoveryCalls++;return {status:'succeeded',response:{filename:'r.mp4',url:'/r'}};}});
  await recovered.controller.start(); assert.equal(recoveryCalls,1); assert.equal(recovered.get().clears,1);
  const failed=fixture({fetch:async()=>{throw new Error('drop');},api:async()=>({status:'failed',detail:'worker failed'})});
  await failed.controller.start(); assert.equal(failed.nodes['#renderStatus'].textContent,'오류: worker failed'); assert.equal(failed.nodes['#renderBtn'].disabled,false);
  const nonOk=fixture({fetch:async()=>({ok:false,json:async()=>({error:'bad response'})})}); await nonOk.controller.start(); assert.equal(nonOk.nodes['#renderStatus'].textContent,'오류: bad response');
  let timeoutSleeps=0;
  const timeout=fixture({fetch:async()=>{throw new Error('drop');},api:async()=>{throw new Error('찾을 수 없습니다');},sleep:async ms=>{if(ms===500)timeoutSleeps++;}});
  await timeout.controller.start(); assert.equal(timeoutSleeps,1200); assert.equal(timeout.nodes['#renderStatus'].textContent,'오류: drop');
  assert.equal(RenderController.create({getLocation:()=>({protocol:'file:'})}).isRunning(),false,'optional DOM construction is safe');
  console.log('Step04 render controller tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
