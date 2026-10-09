const assert = require('node:assert/strict');
const fs = require('node:fs');
const Step02Keyword = require('../01_app/assets/steps/step02/step02-keyword.js');

(async () => {
  const partialPath='01_app/pages/steps/step02-keyword.html';
  const cssPath='01_app/assets/steps/step02/step02-keyword.css';
  const jsPath='01_app/assets/steps/step02/step02-keyword.js';
  const trendPath='01_app/assets/steps/step02/trend-keyword-controller.js';
  for(const path of [partialPath,cssPath,jsPath,trendPath])assert.ok(fs.existsSync(path),`${path} must exist`);
  const partial=fs.readFileSync(partialPath,'utf8');
  for(const id of ['step2','keywordGrid','trendKeywordMonth','selectionCount','trendKeywordOpen','tokenUsage','keywordRefresh','keywordMessage','keywordNext'])assert.match(partial,new RegExp(`id="${id}"`),`partial preserves #${id}`);
  assert.match(partial,/data-go="index"/);assert.match(partial,/role="status" aria-live="polite"/);
  const source=fs.readFileSync(jsPath,'utf8');const trendSource=fs.readFileSync(trendPath,'utf8');
  assert.match(source,/root\.Step02Keyword = api/);assert.match(source,/['"]\/api\/keywords['"]/);assert.doesNotMatch(source,/greenhill-demo-v1|const\s+keywords\s*=\s*\[/);assert.doesNotMatch(partial,/value="20\d\d-\d\d"/);
  assert.match(trendSource,/root\.Step02TrendKeywordController = api/);assert.match(trendSource,/['"]\/api\/season-keywords['"]/);assert.doesNotMatch(trendSource,/document\.|window\./);
  assert.equal(Step02Keyword.MAX_SELECTION,5);assert.equal(Step02Keyword.escapeHtml('<script>"x"</script>'),'&lt;script&gt;&quot;x&quot;&lt;/script&gt;');

  function node(){const listeners=new Map();return {innerHTML:'',textContent:'',disabled:false,dataset:{},attributes:{},addEventListener(type,fn){const list=listeners.get(type)||[];list.push(fn);listeners.set(type,list)},removeEventListener(type,fn){listeners.set(type,(listeners.get(type)||[]).filter(item=>item!==fn))},dispatch(type,target=this){const event={target,prevented:false,preventDefault(){this.prevented=true}};return {event,results:(listeners.get(type)||[]).map(fn=>fn(event))}},listenerCount:type=>(listeners.get(type)||[]).length,setAttribute(name,value){this.attributes[name]=value},removeAttribute(name){delete this.attributes[name]}}}
  function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
  function harness(overrides={}){
    const ids=['keywordGrid','selectionCount','keywordRefresh','keywordMessage','keywordNext'];const nodes=Object.fromEntries(ids.map(id=>[id,node()]));
    const root={querySelector:selector=>nodes[selector.slice(1)]||null,contains:()=>true};
    let keywords=(overrides.keywords||[{id:'care',label:'<돌봄>',description:'안전 & 신뢰',image:'care'},{id:'family',label:'가족',description:'함께',image:'family',seasonal:true},{id:'health',label:'건강',description:'건강'},{id:'meal',label:'식사',description:'식사'}]).map(item=>({...item}));
    let visible=(overrides.visible||['care','family']).slice();let selected=new Set(overrides.selected||['care']);let projectId=overrides.projectId===undefined?'project-42':overrides.projectId;let stale=Boolean(overrides.stale);const calls=[];
    const deps={getRoot:()=>root,getKeywords:()=>keywords,getVisibleKeywordIds:()=>visible,setVisibleKeywordIds:value=>{visible=value;calls.push(['visible',value.slice()])},getSelectedKeywords:()=>selected,getActiveProjectId:()=>projectId,beginNav:()=>{calls.push(['begin']);return 7},isStaleNav:token=>{calls.push(['stale',token]);return stale},loadProjectContent:async(...args)=>{calls.push(['load',...args]);if(overrides.loadError)throw overrides.loadError},showStep:step=>calls.push(['show',step]),ensureStepApiReady:async step=>{calls.push(['ensure',step]);return overrides.ensureReady!==false},request:async(...args)=>{calls.push(['request',...args]);if(overrides.request)return overrides.request(...args);if(overrides.requestError)throw overrides.requestError;return overrides.requestResult||{state:{saved:true}}},setDemoState:state=>calls.push(['state',state]),runAiWorkflow:async()=>{calls.push(['workflow']);if(overrides.workflowError)throw overrides.workflowError},random:()=>overrides.random===undefined?.75:overrides.random};
    return {controller:Step02Keyword.create(deps),nodes,root,calls,get selected(){return selected},get visible(){return visible},set stale(value){stale=value}};
  }
  const valid={getRoot(){},getKeywords(){},getVisibleKeywordIds(){},setVisibleKeywordIds(){},getSelectedKeywords(){},getActiveProjectId(){},beginNav(){},isStaleNav(){},loadProjectContent(){},showStep(){},ensureStepApiReady(){},request(){},setDemoState(){},runAiWorkflow(){},random(){}};
  assert.throws(()=>Step02Keyword.create(),/requires getRoot/);for(const name of Object.keys(valid)){const copy={...valid};delete copy[name];assert.throws(()=>Step02Keyword.create(copy),new RegExp(`requires ${name}`))}

  let h=harness();assert.equal(Object.isFrozen(h.controller),true);assert.equal(h.controller.mount(h.root),true);assert.equal(h.controller.mount(h.root),true);assert.equal(h.nodes.keywordGrid.listenerCount('click'),1);assert.equal(h.nodes.keywordRefresh.listenerCount('click'),1);assert.equal(h.nodes.keywordNext.listenerCount('click'),1);assert.match(h.nodes.keywordGrid.innerHTML,/&lt;돌봄&gt;/);assert.match(h.nodes.keywordGrid.innerHTML,/안전 &amp; 신뢰/);assert.match(h.nodes.keywordGrid.innerHTML,/keyword-ai-badge/);assert.equal(h.nodes.selectionCount.textContent,'1 / 5 선택 · 전체 4개');
  h.controller.unmount();assert.equal(h.nodes.keywordGrid.listenerCount('click'),0);assert.equal(h.controller.unmount(),undefined);h.controller.mount(h.root);assert.equal(h.nodes.keywordGrid.listenerCount('click'),1);
  const broken=harness();delete broken.nodes.keywordMessage;assert.throws(()=>broken.controller.mount(broken.root),/missing #keywordMessage/);broken.nodes.keywordMessage=node();assert.equal(broken.controller.mount(broken.root),true);

  const family={dataset:{keyword:'family'},closest:()=>family};let result=h.nodes.keywordGrid.dispatch('click',family);assert.equal(result.event.prevented,true);assert.equal(h.selected.has('family'),true);h.nodes.keywordGrid.dispatch('click',family);assert.equal(h.selected.has('family'),false);
  h=harness({selected:['care','family','health','meal','fifth']});h.controller.mount(h.root);const sixth={dataset:{keyword:'sixth'},closest:()=>sixth};h.nodes.keywordGrid.dispatch('click',sixth);assert.equal(h.nodes.keywordMessage.textContent,'키워드는 최대 5개까지 선택할 수 있습니다.');assert.equal(h.selected.size,5);

  h=harness({keywords:[{id:'selected'},{id:'old-a'},{id:'old-b'},{id:'new-a'},{id:'season',seasonal:true},{id:'new-b'}],visible:['selected','old-a','old-b'],selected:['selected'],random:.9});h.controller.mount(h.root);h.controller.refresh();assert.equal(h.visible[0],'selected');assert.equal(h.visible.includes('season'),false);assert.equal(h.visible.some(id=>id==='new-a'||id==='new-b'),true);
  h=harness();h.controller.mount(h.root);assert.equal(h.controller.setLocked(true),undefined);assert.equal(h.controller.isLocked(),true);assert.equal(h.nodes.keywordRefresh.disabled,true);assert.equal(h.nodes.keywordNext.textContent,'저장된 대본 보기');assert.match(h.nodes.keywordGrid.innerHTML,/locked/);h.nodes.keywordGrid.dispatch('click',family);assert.equal(h.nodes.keywordMessage.textContent,'대본이 확정된 콘텐츠의 키워드는 수정할 수 없습니다.');

  await h.controller.saveAndContinue();assert.deepEqual(h.calls.filter(call=>['begin','load','show'].includes(call[0])),[['begin'],['load','project-42',7],['show',3]]);assert.equal(h.nodes.keywordNext.disabled,false);assert.equal(h.nodes.keywordNext.attributes['aria-busy'],undefined);
  h=harness();h.controller.mount(h.root);h.controller.setLocked(true);h.stale=true;await h.controller.saveAndContinue();assert.equal(h.calls.some(call=>call[0]==='show'),false);
  h=harness({loadError:new Error('load failed')});h.controller.mount(h.root);h.controller.setLocked(true);await h.controller.saveAndContinue();assert.equal(h.nodes.keywordMessage.textContent,'load failed');
  h=harness({projectId:null});h.controller.mount(h.root);await h.controller.saveAndContinue();assert.equal(h.nodes.keywordMessage.textContent,'키워드를 편집할 콘텐츠를 먼저 선택해 주세요.');assert.equal(h.calls.length,0);
  h=harness({selected:[]});h.controller.mount(h.root);await h.controller.saveAndContinue();assert.equal(h.nodes.keywordMessage.textContent,'키워드를 1개 이상 선택해 주세요.');
  h=harness({ensureReady:false});h.controller.mount(h.root);await h.controller.saveAndContinue();assert.deepEqual(h.calls,[['ensure',2]]);assert.equal(h.nodes.keywordNext.disabled,false);
  h=harness();h.controller.mount(h.root);const saved=await h.controller.saveAndContinue();assert.deepEqual(saved,{state:{saved:true}});assert.deepEqual(h.calls,[['ensure',2],['request','/api/keywords',{method:'POST',body:JSON.stringify({project_id:'project-42',selected:['care']})}],['state',{saved:true}],['workflow']]);
  h=harness({requestError:new Error('save failed')});h.controller.mount(h.root);await h.controller.saveAndContinue();assert.equal(h.nodes.keywordMessage.textContent,'save failed');assert.equal(h.nodes.keywordNext.disabled,false);assert.equal(h.controller.isBusy(),false);
  const pending=deferred();h=harness({request:()=>pending.promise});h.controller.mount(h.root);const saving=h.controller.saveAndContinue();assert.equal(h.controller.isBusy(),true);assert.equal(h.nodes.keywordNext.disabled,true);assert.equal(h.nodes.keywordNext.attributes['aria-busy'],'true');assert.equal(await h.controller.saveAndContinue(),undefined);assert.equal(h.calls.filter(call=>call[0]==='request').length,1);pending.resolve({state:{saved:true}});await saving;assert.equal(h.controller.isBusy(),false);

  console.log('Step 2 keyword controller tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
