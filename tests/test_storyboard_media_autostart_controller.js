const assert=require('node:assert/strict');
const Autostart=require('../01_app/assets/steps/step03/storyboard-media-autostart-controller.js');

(async()=>{
  function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
  function harness(options={}){let project=options.project===undefined?'p1':options.project;const calls=[],voice=options.voice||(()=>{calls.push('voice')}),image=options.image||(()=>{calls.push('image')});const controller=Autostart.create({getActiveProjectId:()=>project,generateMissingVoices:voice,generateMissingImages:image,setStatus:value=>calls.push(['status',value]),onError:(kind,error)=>calls.push(['error',kind,error.message])});return {controller,calls,setProject:value=>{project=value}}}
  const valid={getActiveProjectId(){},generateMissingVoices(){},generateMissingImages(){},setStatus(){},onError(){}};
  assert.throws(()=>Autostart.create(),/requires getActiveProjectId/);for(const name of Object.keys(valid)){const copy={...valid};delete copy[name];assert.throws(()=>Autostart.create(copy),new RegExp(`requires ${name}`))}
  let h=harness();assert.equal(Object.isFrozen(h.controller),true);const result=await h.controller.start();assert.equal(result.every(item=>item.status==='fulfilled'),true);assert.deepEqual(h.calls.slice(0,3),[['status','미생성 음성과 이미지를 자동으로 확인하고 생성합니다.'],'voice','image']);assert.deepEqual(h.calls.at(-1),['status','미생성 음성과 이미지 자동 생성을 완료했습니다.']);assert.equal(h.controller.isRunning(),false);
  const gate=deferred();h=harness({voice:()=>gate.promise,image:()=>gate.promise});const first=h.controller.start(),second=h.controller.start();assert.strictEqual(first,second);assert.equal(h.controller.isRunning('p1'),true);gate.resolve();await first;assert.equal(h.controller.isRunning('p1'),false);
  h=harness({voice:async()=>{throw new Error('voice failed')}});const failed=await h.controller.start();assert.equal(failed[0].status,'rejected');assert.deepEqual(h.calls.find(item=>Array.isArray(item)&&item[0]==='error'),['error','voice','voice failed']);assert.match(h.calls.at(-1)[1],/1개 작업/);
  h=harness({project:null});assert.equal(await h.controller.start(),false);assert.deepEqual(h.calls,[]);
  const stale=deferred();h=harness({voice:()=>stale.promise,image:()=>stale.promise});const staleRun=h.controller.start();h.setProject('p2');stale.resolve();await staleRun;assert.equal(h.calls.filter(item=>Array.isArray(item)&&item[0]==='status').length,1,'old project completion does not overwrite the new project status');
  console.log('Storyboard media autostart controller tests passed');
})().catch(error=>{console.error(error);process.exitCode=1});
