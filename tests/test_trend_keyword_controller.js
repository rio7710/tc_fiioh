const assert = require('node:assert/strict');
const TrendKeyword = require('../01_app/assets/steps/step02/trend-keyword-controller.js');

(async () => {
  function node() {
    const listeners = new Map();
    const classes = new Set();
    return {
      hidden:false, disabled:false, value:'', textContent:'', innerHTML:'', dataset:{}, attributes:{},
      classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)},
      setAttribute(name,value){this.attributes[name]=value;},
      addEventListener(type,fn){const list=listeners.get(type)||[];list.push(fn);listeners.set(type,list);},
      removeEventListener(type,fn){listeners.set(type,(listeners.get(type)||[]).filter(item=>item!==fn));},
      dispatch(type,target=this){const event={target,currentTarget:this};return (listeners.get(type)||[]).map(fn=>fn(event));},
      listenerCount:type=>(listeners.get(type)||[]).length
    };
  }

  function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};}
  function harness(overrides={}) {
    const ids=['trendKeywordOpen','trendKeywordModal','trendKeywordLoading','trendKeywordGrid','trendKeywordMessage','trendKeywordApply','trendKeywordClose','trendKeywordMonth','trendTokenUsage','tokenUsage','trendKeywordLimitModal','trendKeywordLimitClose','keywordMessage'];
    const nodes=Object.fromEntries(ids.map(id=>[id,node()]));
    nodes.trendKeywordModal.hidden=true;nodes.trendKeywordLimitModal.hidden=true;nodes.trendKeywordMonth.value='2030-05';
    const bodyClasses=new Set();
    const root={body:{classList:{add:name=>bodyClasses.add(name),remove:name=>bodyClasses.delete(name)}},querySelector:selector=>nodes[selector.slice(1)]||null};
    let projectId=overrides.projectId===undefined?'project-1':overrides.projectId;
    let locked=Boolean(overrides.locked);
    let selected=new Set(overrides.selected||['base-a']);
    let seasonal=new Set(overrides.seasonal||[]);
    let visible=(overrides.visible||['base-a','base-b','base-c','base-d','base-e','base-f','base-g','base-h']).slice();
    let keywords=(overrides.keywords||visible.map((id,index)=>({id,label:`Base ${index}`,description:'base'}))).map(item=>({...item}));
    const calls=[];
    const deps={
      getRoot:()=>root,
      request:async(...args)=>{calls.push(['request',...args]);return overrides.request?overrides.request(...args):{keywords:[{id:'spring',label:'봄 <행사>',description:'따뜻함',seasonal:true}],usage:{total_tokens:12,requests:1},source:'monthly_pool',month:'5월',pool_size:10,remaining:9,cycled:false};},
      getActiveProjectId:()=>projectId,isKeywordLocked:()=>locked,getSelectedKeywords:()=>selected,
      getSeasonalKeywordIds:()=>seasonal,setSeasonalKeywordIds:value=>{seasonal=value;calls.push(['seasonal',[...value]]);},
      getVisibleKeywordIds:()=>visible,setVisibleKeywordIds:value=>{visible=value;calls.push(['visible',value.slice()]);},
      getKeywords:()=>keywords,setKeywords:value=>{keywords=value;calls.push(['keywords',value.map(item=>item.id)]);},
      renderKeywords:()=>calls.push(['renderKeywords']),
      showTokenUsage:usage=>{calls.push(['usage',usage]);nodes.tokenUsage.textContent=`API ${usage.total_tokens} tokens · ${usage.requests}회`;},
      escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;')
    };
    return {controller:TrendKeyword.create(deps),nodes,root,bodyClasses,calls,get projectId(){return projectId},set projectId(value){projectId=value},set locked(value){locked=value},get selected(){return selected},get seasonal(){return seasonal},get visible(){return visible},get keywords(){return keywords}};
  }

  const valid={getRoot(){},request(){},getActiveProjectId(){},isKeywordLocked(){},getSelectedKeywords(){},getSeasonalKeywordIds(){},setSeasonalKeywordIds(){},getVisibleKeywordIds(){},setVisibleKeywordIds(){},getKeywords(){},setKeywords(){},renderKeywords(){},showTokenUsage(){},escapeHtml(){}};
  assert.throws(()=>TrendKeyword.create(),/requires getRoot/);
  for(const name of Object.keys(valid)){const deps={...valid};delete deps[name];assert.throws(()=>TrendKeyword.create(deps),new RegExp(`requires ${name}`));}

  let h=harness();assert.equal(Object.isFrozen(h.controller),true);assert.equal(h.controller.mount(h.root),true);assert.equal(h.controller.mount(h.root),true);assert.equal(h.nodes.trendKeywordOpen.listenerCount('click'),1);
  h.controller.unmount();assert.equal(h.nodes.trendKeywordOpen.listenerCount('click'),0);assert.equal(h.controller.unmount(),undefined);h.controller.mount(h.root);assert.equal(h.nodes.trendKeywordOpen.listenerCount('click'),1);
  const broken=harness();delete broken.nodes.trendKeywordApply;assert.throws(()=>broken.controller.mount(broken.root),/missing #trendKeywordApply/);broken.nodes.trendKeywordApply=node();assert.equal(broken.controller.mount(broken.root),true);

  h=harness({projectId:null});h.controller.mount(h.root);assert.equal(await h.controller.open(),undefined);assert.equal(h.nodes.keywordMessage.textContent,'키워드를 편집할 콘텐츠를 먼저 선택해 주세요.');assert.equal(h.calls.length,0);
  h=harness({locked:true});h.controller.mount(h.root);await h.controller.open();assert.equal(h.nodes.keywordMessage.textContent,'키워드를 편집할 콘텐츠를 먼저 선택해 주세요.');
  h=harness({selected:['1','2','3','4','5']});h.controller.mount(h.root);await h.controller.open();assert.equal(h.nodes.trendKeywordLimitModal.hidden,false);assert.equal(h.bodyClasses.has('modal-open'),true);assert.equal(h.calls.length,0);h.controller.closeLimit();assert.equal(h.nodes.trendKeywordLimitModal.hidden,true);assert.equal(h.bodyClasses.has('modal-open'),false);

  h=harness();h.controller.mount(h.root);assert.equal(await h.controller.open(),undefined);
  assert.deepEqual(h.calls[0],['request','/api/season-keywords',{method:'POST',body:JSON.stringify({project_id:'project-1',refresh:true,month:'2030-05'})}]);
  assert.match(h.nodes.trendKeywordGrid.innerHTML,/봄 &lt;행사>/);assert.equal(h.nodes.trendTokenUsage.textContent,'API 12 tokens · 1회');assert.match(h.nodes.trendKeywordMessage.textContent,/외부 API 호출 없음/);assert.equal(h.nodes.trendKeywordApply.disabled,false);assert.equal(h.nodes.trendKeywordLoading.hidden,true);assert.equal(h.nodes.trendKeywordGrid.attributes['aria-busy'],'false');assert.equal(h.nodes.trendKeywordOpen.textContent,'AI 트렌드 추천');

  h=harness({request:async()=>({keywords:[],usage:{total_tokens:2,requests:1},source:'api'})});h.controller.mount(h.root);await h.controller.open();assert.equal(h.nodes.trendKeywordMessage.textContent,'기존 추천과 다른 키워드를 실제 API로 받았습니다. 닫고 다시 추천하면 새로 요청합니다.');assert.match(h.nodes.trendKeywordGrid.innerHTML,/추천 키워드가 없습니다/);
  h=harness({request:async()=>{throw new Error('추천 실패')}});h.controller.mount(h.root);await h.controller.open();assert.equal(h.nodes.trendKeywordMessage.textContent,'추천 실패');assert.equal(h.nodes.trendKeywordOpen.disabled,false);

  const pending=deferred();h=harness({request:()=>pending.promise});h.controller.mount(h.root);const opening=h.controller.open();assert.equal(h.nodes.trendKeywordLoading.hidden,false);h.controller.close();pending.resolve({keywords:[{id:'late',label:'Late',description:'late'}],usage:{total_tokens:1,requests:1},source:'api'});await opening;assert.doesNotMatch(h.nodes.trendKeywordGrid.innerHTML,/Late/);assert.equal(h.nodes.trendKeywordModal.hidden,true);
  const switched=deferred();h=harness({request:()=>switched.promise});h.controller.mount(h.root);const switching=h.controller.open();h.projectId='project-2';switched.resolve({keywords:[{id:'stale',label:'Stale',description:'stale'}],usage:{},source:'api'});await switching;assert.doesNotMatch(h.nodes.trendKeywordGrid.innerHTML,/Stale/);

  h=harness({selected:['base-a','base-b','base-c','base-d'],request:async()=>({keywords:[{id:'spring',label:'봄',description:'봄',seasonal:true},{id:'summer',label:'여름',description:'여름',seasonal:true}],usage:{total_tokens:1,requests:1},source:'api'})});h.controller.mount(h.root);await h.controller.open();
  const spring={dataset:{trendKeyword:'spring'},closest:()=>spring};const summer={dataset:{trendKeyword:'summer'},closest:()=>summer};
  h.nodes.trendKeywordGrid.dispatch('click',spring);assert.match(h.nodes.trendKeywordGrid.innerHTML,/trend-keyword-card selected/);
  h.nodes.trendKeywordGrid.dispatch('click',summer);assert.equal(h.nodes.trendKeywordMessage.textContent,'기존 선택을 포함해 키워드는 최대 5개입니다.');
  h.nodes.trendKeywordGrid.dispatch('click',spring);assert.doesNotMatch(h.nodes.trendKeywordGrid.innerHTML,/trend-keyword-card selected/);

  h=harness({selected:['old-season','base-a'],seasonal:['old-season'],visible:['base-a','base-b','base-c','base-d','base-e','base-f','base-g','old-season'],keywords:[{id:'old-season',label:'Old',seasonal:true},...['base-a','base-b','base-c','base-d','base-e','base-f','base-g','base-h'].map(id=>({id,label:id}))]});h.controller.mount(h.root);await h.controller.open();
  const card={dataset:{trendKeyword:'spring'},closest:()=>card};h.nodes.trendKeywordGrid.dispatch('click',card);assert.equal(h.controller.apply(),undefined);
  assert.equal(h.selected.has('old-season'),false);assert.equal(h.selected.has('spring'),true);assert.deepEqual([...h.seasonal],['spring']);assert.equal(h.keywords.some(item=>item.id==='old-season'),false);assert.equal(h.keywords.some(item=>item.id==='spring'),true);assert.equal(h.visible.length,8);assert.equal(h.visible.at(-1),'spring');assert.equal(h.nodes.keywordMessage.textContent,'AI 추천 1개를 뒤쪽 카드에 반영했습니다.');assert.equal(h.nodes.trendKeywordModal.hidden,true);assert.equal(h.calls.at(-1)[0],'renderKeywords');

  h=harness();h.controller.mount(h.root);const opened=h.nodes.trendKeywordOpen.dispatch('click');await Promise.all(opened);assert.equal(h.nodes.trendKeywordModal.hidden,false);h.nodes.trendKeywordClose.dispatch('click');assert.equal(h.nodes.trendKeywordModal.hidden,true);
  console.log('Trend keyword controller tests passed');
})().catch(error=>{console.error(error);process.exitCode=1});
