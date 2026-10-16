const assert = require('node:assert/strict');
const RenderController = require('../01_app/assets/steps/step04/step04-render-controller.js');
const RenderJobClient = require('../01_app/assets/steps/step04/step04-render-job-client.js');

function classes() { const set = new Set(); return { add: (...v) => v.forEach(x => set.add(x)), remove: (...v) => v.forEach(x => set.delete(x)), toggle: (v, on) => on ? set.add(v) : set.delete(v), contains: v => set.has(v) }; }
function element() { return { textContent: '', innerHTML: '', hidden: true, disabled: false, style: {}, dataset: {}, classList: classes(), attrs: {}, setAttribute(k,v){this.attrs[k]=v;}, removeAttribute(k){delete this.attrs[k];}, addEventListener(){}, append(){}, querySelector(){return element();}, querySelectorAll(){return [];} }; }
function fixture(overrides = {}) {
  const captionBadges = [element(), element()];
  const roles = Array.from({length:4}, () => { const role=element(); const state=element(); role.querySelector=s=>s==='.ai-role-state'?state:element(); role.querySelectorAll=s=>s==='.scene-conversion-badge'?captionBadges:[]; return role; });
  const modal=element(); modal.querySelectorAll=()=>roles;
  const nodes = Object.fromEntries(['#renderStatus','#renderBtn','#aiProgressBar','#aiFootStatus','#aiWorkflowSummary','#aiNow'].map(id=>[id,element()]));
  const root={body:{classList:classes()},querySelector:s=>nodes[s]||null,createElement:()=>element()};
  let clears=0, intervalDelay=0, intervalFn=null, fetchBody=null, productions=0, shown=0, pending=null;
  const deps={
    root,getLocation:()=>({protocol:'https:'}),ensureStepApiReady:async()=>true,saveBrandSelections:async()=>{},pausePreview(){},
    resolveRenderResponse:options=>RenderJobClient.resolve(options),
    getActiveProjectId:()=> 'p',getPendingRenderJob:()=>pending,setPendingRenderJob:value=>{pending=value;},clearPendingRenderJob:()=>{pending=null;},
    getRenderButton:()=>nodes['#renderBtn'],getRenderStatus:()=>nodes['#renderStatus'],configureWorkflowModal:()=>modal,
    setupCaptionProgressBadges(){},setupCompositeFormatBadges(){},setupSceneProgressBadges(){},
    applySequentialCaptionProgress(_r,n){captionBadges.forEach((b,i)=>b.dataset.status=i<n?'succeeded':'queued');},applyCompositeFormatProgress(){},applySequentialSceneProgress(){},
    getScenes:()=>[{id:'s1',end:5}],hasMissingNarrationVoice:()=>false,timelineDuration:()=>5,getPayload:id=>({job_id:id,project_id:'p',narration:true,scene_crop_positions:{},scene_videos:[]}),
    fetch:async(_url,options)=>{fetchBody=JSON.parse(options.body);return {ok:true,json:async()=>({exports:[{filename:'<one>.mp4',url:'/one',platforms:['youtube']} ]})};},
    api:async()=>({phase:'captions'}),sleep:async()=>{},recordCurrentProduction(){productions++;},showLatestExport(){},showStep(step){shown=step;},
    platformLabels:{youtube:'유튜브'},escapeHtml:value=>String(value).replaceAll('<','&lt;').replaceAll('>','&gt;'),now:()=>123,random:()=>.5,
    setInterval(fn,delay){intervalFn=fn;intervalDelay=delay;return 9;},clearInterval(){clears++;},onError(){},...overrides
  };
  return {controller:RenderController.create(deps),nodes,modal,get:()=>({clears,intervalDelay,intervalFn,fetchBody,productions,shown,pending}),setPending:value=>{pending=value;}};
}

(async()=>{
  const file=fixture({getLocation:()=>({protocol:'file:'})}); await file.controller.start();
  assert.match(file.nodes['#renderStatus'].textContent,/bat/);
  const apiEarly=fixture({ensureStepApiReady:async()=>false}); await apiEarly.controller.start(); assert.equal(apiEarly.get().fetchBody,null);
  const brandEarly=fixture({saveBrandSelections:async()=>{throw new Error('brand');}}); await brandEarly.controller.start(); assert.equal(brandEarly.nodes['#renderStatus'].textContent,'브랜드 설정 저장 오류: brand');
  const payloadEarly=fixture({getPayload:()=>{throw new Error('payload state');}}); await payloadEarly.controller.start(); assert.equal(payloadEarly.get().fetchBody,null); assert.equal(payloadEarly.nodes['#renderStatus'].textContent,'영상 제작 준비 오류: payload state'); assert.equal(payloadEarly.nodes['#renderBtn'].disabled,false);
  const modalEarly=fixture({configureWorkflowModal:()=>{throw new Error('modal state');}}); await modalEarly.controller.start(); assert.equal(modalEarly.get().fetchBody,null); assert.equal(modalEarly.nodes['#renderStatus'].textContent,'영상 제작 준비 오류: modal state'); assert.equal(modalEarly.nodes['#renderBtn'].disabled,false);

  const success=fixture(); const result=await success.controller.start();
  assert.equal(success.get().intervalDelay,500); assert.equal(success.get().clears,1); assert.equal(success.get().fetchBody.project_id,'p');
  assert.match(success.get().fetchBody.job_id,/^render-123-/); assert.equal(success.get().productions,1); assert.equal(success.get().shown,5);
  assert.match(success.nodes['#renderStatus'].innerHTML,/유튜브/); assert.match(success.nodes['#renderStatus'].innerHTML,/&lt;one&gt;\.mp4/);
  assert.equal(success.nodes['#renderBtn'].disabled,false); assert.equal(success.nodes['#renderBtn'].textContent,'최종 영상 제작'); assert.ok(result.exports);
  assert.match(success.nodes['#aiNow'].textContent,/완료/);
  assert.equal(success.get().pending,null);

  const resumed=fixture({api:async()=>({status:'succeeded',response:{filename:'resume.mp4',url:'/resume'}})});
  resumed.setPending({job_id:'remembered-job',project_id:'p'});
  const resumedResult=await resumed.controller.resumePending();
  assert.equal(resumedResult.filename,'resume.mp4'); assert.equal(resumed.get().fetchBody,null); assert.equal(resumed.get().pending,null);

  let releaseMissing, releaseMissingDelay;
  const missingVoice=fixture({hasMissingNarrationVoice:()=>true,fetch:()=>new Promise(resolve=>{releaseMissing=resolve;}),sleep:ms=>ms===700&&!releaseMissingDelay?new Promise(resolve=>{releaseMissingDelay=resolve;}):Promise.resolve()});
  const missingPending=missingVoice.controller.start();
  while(!releaseMissing||!releaseMissingDelay) await Promise.resolve();
  assert.equal(missingVoice.nodes['#aiNow'].textContent,'모든 씬에 음성이 생성되지 않았습니다. 자동 검증·보완 중입니다.');
  releaseMissingDelay();
  releaseMissing({ok:true,json:async()=>({filename:'voice-ready.mp4',url:'/voice-ready'})});
  await missingPending;

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
  let releaseQueued;
  const queued=fixture({fetch:()=>new Promise(resolve=>{releaseQueued=resolve;}),api:async()=>({status:'queued',queue_position:3})});
  const queuedPending=queued.controller.start(); while(!queued.get().intervalFn) await Promise.resolve(); await queued.get().intervalFn();
  assert.equal(queued.nodes['#aiNow'].textContent,'최종 영상 작업 대기열 · 3번째');
  releaseQueued({ok:true,json:async()=>({filename:'queued.mp4',url:'/queued'})}); await queuedPending;
  let timeoutSleeps=0;
  const timeout=fixture({fetch:async()=>{throw new Error('drop');},api:async()=>{throw new Error('찾을 수 없습니다');},sleep:async ms=>{if(ms===500)timeoutSleeps++;}});
  await timeout.controller.start(); assert.equal(timeoutSleeps,1200); assert.equal(timeout.nodes['#renderStatus'].textContent,'오류: drop');
  assert.equal(RenderController.create({getLocation:()=>({protocol:'file:'})}).isRunning(),false,'optional DOM construction is safe');
  console.log('Step04 render controller tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
