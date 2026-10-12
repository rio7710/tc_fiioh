const assert=require('node:assert/strict');
const View=require('../01_app/assets/steps/step01/step01-content-index-view.js');

function classes(){return {active:false,toggle(name,on){if(name==='active')this.active=on}}}
function element(extra={}){const listeners=new Map();return Object.assign({textContent:'',innerHTML:'',hidden:false,disabled:false,title:'',dataset:{},classList:classes(),attributes:{},setAttribute(name,value){this.attributes[name]=value},addEventListener(type,fn){const list=listeners.get(type)||[];list.push(fn);listeners.set(type,list)},removeEventListener(type,fn){listeners.set(type,(listeners.get(type)||[]).filter(item=>item!==fn))},fire(type,target){return Promise.all((listeners.get(type)||[]).map(fn=>fn({target:target||this,currentTarget:this})))},listeners},extra)}
function harness(rowCount=12){
  const all=element({dataset:{indexFilter:'all'}}),progress=element({dataset:{indexFilter:'progress'}}),completed=element({dataset:{indexFilter:'completed'}}),scheduled=element({dataset:{indexFilter:'scheduled'}});
  const rows=Array.from({length:rowCount},(_,index)=>element({dataset:{projectId:`P${index+1}`,state:index<7?'progress':'completed',scheduled:index===1||index===7?'true':'false'}}));
  const nodes={'#contentIndex':element(),'#contentIndexPagination':element({hidden:true}),'#projectDetailContinue':element(),'#projectDeleteButton':element(),'#createProjectButton':element(),'#projectDetailKicker':element(),'#projectDetailTitle':element(),'#projectDetailSummary':element(),'#projectDetailStatus':element(),'#projectDetailNote':element(),'#projectDetailSteps':element()};
  const root={querySelector:selector=>nodes[selector]||null,querySelectorAll(selector){if(selector==='[data-index-filter]')return[all,progress,completed,scheduled];if(selector==='.content-index-row[data-project-id]')return rows;if(selector==='.project-detail-actions [data-go]')return[];return[]}};
  const calls=[],handlers={openProject:value=>calls.push(['open',value]),applyFilter:value=>calls.push(['filter',value]),continueProject:value=>calls.push(['continue',value]),deleteProject:()=>calls.push(['delete']),createProject:()=>calls.push(['create'])};
  const view=View.create({escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;'),projectCreatedDate:value=>`DATE:${value}`});
  return {view,root,nodes,rows,filters:{all,progress,completed,scheduled},calls,handlers};
}

(()=>{
  assert.throws(()=>View.create(),/requires escapeHtml/);
  const invalid=harness(0);delete invalid.nodes['#contentIndexPagination'];assert.throws(()=>invalid.view.mount(invalid.root,invalid.handlers),/missing #contentIndexPagination/);
  const h=harness();assert.equal(Object.isFrozen(h.view),true);h.view.mount(h.root,h.handlers);h.view.mount(h.root,h.handlers);
  assert.equal(h.nodes['#contentIndex'].listeners.get('click').length,1);
  assert.deepEqual(h.rows.map(row=>!row.hidden),[true,true,true,true,true,false,false,false,false,false,false,false]);
  assert.equal(h.nodes['#contentIndexPagination'].hidden,false);assert.match(h.nodes['#contentIndexPagination'].innerHTML,/data-page="3"/);assert.match(h.nodes['#contentIndexPagination'].innerHTML,/aria-current="page"/);
  h.nodes['#contentIndexPagination'].fire('click',{closest:()=>({dataset:{page:'2'},disabled:false})});
  assert.deepEqual(h.rows.map(row=>!row.hidden),[false,false,false,false,false,true,true,true,true,true,false,false]);
  let state=h.view.applyFilter('progress');assert.deepEqual(state,{filter:'progress',page:1,pageCount:2,total:7});assert.equal(h.rows.filter(row=>!row.hidden).length,5);
  state=h.view.applyFilter('scheduled');assert.deepEqual(state,{filter:'scheduled',page:1,pageCount:1,total:2});assert.deepEqual(h.rows.filter(row=>!row.hidden).map(row=>row.dataset.projectId),['P2','P8']);assert.equal(h.nodes['#contentIndexPagination'].hidden,true);
  const project={title:'<Alpha>',summary:'Summary',currentStep:'3',note:'Note',created_at:'2026',selected_keywords:['one','<two>'],steps:[{key:'1',label:'Create'},{key:'2',label:'<Keywords>'},{key:'3',label:'Script'},{key:'4',label:'Video'}]};
  h.view.renderDetail('A',project);assert.equal(h.nodes['#projectDetailKicker'].textContent,'PROJECT · A');assert.equal(h.nodes['#projectDetailStatus'].textContent,'2 / 4 제작 항목 완료 · STEP 03 진행 중');assert.match(h.nodes['#projectDetailSteps'].innerHTML,/&lt;Keywords>/);assert.equal(h.nodes['#projectDetailContinue'].dataset.targetStep,'3');
  h.view.setNote('error');assert.equal(h.nodes['#projectDetailNote'].textContent,'error');h.view.setBusy('delete',true);h.view.setBusy('create',true);assert.equal(h.nodes['#projectDeleteButton'].disabled,true);assert.throws(()=>h.view.setBusy('bad',true),/Unknown action role/);
  h.nodes['#contentIndex'].fire('click',{closest:()=>({dataset:{projectId:'A'}})});h.filters.progress.fire('click');h.nodes['#projectDetailContinue'].fire('click');h.nodes['#projectDeleteButton'].fire('click');h.nodes['#createProjectButton'].fire('click');assert.deepEqual(h.calls,[['open','A'],['filter','progress'],['continue','3'],['delete'],['create']]);
  h.view.unmount();assert.equal(h.nodes['#contentIndex'].listeners.get('click').length,0);assert.throws(()=>h.view.renderDetail('A',project),/not mounted/);
  console.log('Step01 content index view tests passed');
})();
