const assert = require('node:assert/strict');
const Panel = require('../01_app/assets/core/automation-control-panel.js');
const Model = require('../01_app/assets/core/automation-progress-model.js');

function element(){
  const listeners=new Map();
  return {listeners,children:[],dataset:{},style:{width:''},checked:false,disabled:false,textContent:'',
    addEventListener(type,fn){listeners.set(type,fn)},removeEventListener(type){listeners.delete(type)},
    setAttribute(name,value){this[name]=value},replaceChildren(...items){this.children=items},append(...items){this.children.push(...items)},
    async emit(type){return listeners.get(type)?.({target:this,currentTarget:this})}};
}
const ids=['userAutomationToggle','userAutomationSwitchText','userAutomationStateBadge','userAutomationPercent','userAutomationProgressBar','userAutomationCurrentStage','userAutomationCurrentDetail','userAutomationProgressSteps','userAutomationServerStatus','userAutomationRuns'];
const nodes=Object.fromEntries(ids.map(id=>[id,element()]));
nodes.userAutomationProgressBar.parentElement=element();
const root={querySelector:selector=>nodes[selector.slice(1)]||null,createElement:()=>element()};
const toggles=[],actions=[];
const panel=Panel.create({getRoot:()=>root,model:Model.view,onToggle:async value=>{toggles.push(value);return true},onRunAction:(action,run)=>actions.push([action,run])});
(async()=>{
  assert.equal(panel.mount(),true);assert.equal(panel.mount(),true);
  panel.render({settings:{enabled:0,config:{endpoint:'4'}},runs:[]});
  assert.deepEqual(nodes.userAutomationProgressSteps.children.map(item=>item.className),['configured','configured','configured','configured','configured','configured','pending']);
  panel.render({settings:{enabled:1,next_run_at:'2030-01-01T00:00:00Z'},runs:[{status:'running',stage:'image_scene-01',attempt:1,created_at:'2030-01-01T00:00:00Z'}]});
  assert.equal(nodes.userAutomationToggle.checked,true);
  assert.equal(nodes.userAutomationPercent.textContent,'62%');
  assert.equal(nodes.userAutomationProgressBar.style.width,'62%');
  assert.equal(nodes.userAutomationCurrentStage.textContent,'장면 이미지 생성');
  assert.equal(panel.setNotice('설정을 확인해 주세요.','failed'),true);
  assert.equal(nodes.userAutomationCurrentDetail.textContent,'설정을 확인해 주세요.');
  assert.equal(nodes.userAutomationStateBadge.dataset.state,'failed');
  nodes.userAutomationToggle.checked=false;await nodes.userAutomationToggle.emit('change');assert.deepEqual(toggles,[false]);
  assert.equal(panel.unmount(),true);assert.equal(panel.unmount(),false);
  console.log('Automation control panel tests passed');
})().catch(error=>{console.error(error);process.exitCode=1});
