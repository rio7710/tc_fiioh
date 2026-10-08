const assert = require('node:assert/strict');
const StyleController = require('../01_app/assets/steps/step04/step04-style-controller.js');

function node(classes=[]) { const set=new Set(classes); return {dataset:{},attrs:{},disabled:false,textContent:'',style:{values:{},setProperty(k,v){this.values[k]=v;}},classList:{add:(...v)=>v.forEach(x=>set.add(x)),remove:(...v)=>v.forEach(x=>set.delete(x)),toggle:(v,on)=>on?set.add(v):set.delete(v),contains:v=>set.has(v)},setAttribute(k,v){this.attrs[k]=v;}}; }
const stage=node(['type-card']); const value=node(),down=node(),up=node();
const buttons=['card','minimal','custom'].map(type=>Object.assign(node(),{dataset:{type}}));
const nodes={'#stage':stage,'#captionSizeValue':value,'#captionSizeDown':down,'#captionSizeUp':up};
const root={querySelector:s=>nodes[s]||null,querySelectorAll:s=>s==='.type-btn'?buttons:[]};
const state={};let saves=0;let catalog=null;
const controller=StyleController.create({root,setState:(k,v)=>{state[k]=v;},getCatalog:()=>catalog,saveEditorSettings:()=>{saves++;}});

assert.equal(controller.setSceneDissolveSeconds('2.5'),undefined);assert.equal(state.sceneDissolveSeconds,2.5);assert.equal(stage.style.values['--scene-dissolve-seconds'],'2.5s');
controller.setSceneDissolveSeconds(9);assert.equal(state.sceneDissolveSeconds,3);controller.setSceneDissolveSeconds('bad');assert.equal(state.sceneDissolveSeconds,.5);
assert.equal(controller.setCaptionSize(8),undefined);assert.equal(state.captionSizeLevel,5);assert.equal(stage.style.values['--caption-size-offset'],'1.3900000000000001cqmin');assert.equal(value.textContent,'+5');assert.equal(up.disabled,true);assert.equal(down.disabled,false);
controller.setCaptionSize(-8);assert.equal(state.captionSizeLevel,-5);assert.equal(value.textContent,'-5');assert.equal(down.disabled,true);
controller.setCaptionSize(0);assert.equal(value.textContent,'기본');
assert.equal(controller.setType('minimal'),undefined);assert.equal(state.currentType,'minimal');assert.equal(stage.classList.contains('type-card'),false);assert.equal(stage.classList.contains('type-minimal'),true);
assert.equal(buttons[1].classList.contains('active'),true);assert.equal(buttons[1].attrs['aria-pressed'],'true');assert.equal(buttons[0].attrs['aria-pressed'],'false');
catalog={styles:{minimal:{},custom:{}}};stage.classList.add('type-custom');controller.setType('minimal');assert.equal(stage.classList.contains('type-custom'),false,'configured catalog style classes are cleared');
assert.equal(saves,5,'caption and type save, dissolve does not');

let headlessSaves=0;const headlessState={};const headless=StyleController.create({setState:(k,v)=>{headlessState[k]=v;},saveEditorSettings:()=>{headlessSaves++;}});
assert.equal(headless.setCaptionSize(2),undefined);assert.equal(headless.setType('bubble'),undefined);assert.equal(headless.setSceneDissolveSeconds(1),undefined);
assert.deepEqual(headlessState,{captionSizeLevel:2,currentType:'bubble',sceneDissolveSeconds:1});assert.equal(headlessSaves,0,'headless changes update state without saving');
console.log('Step04 style controller tests passed');
