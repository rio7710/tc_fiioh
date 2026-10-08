const assert = require('node:assert/strict');
const LifecycleController = require('../01_app/assets/steps/step04/step04-lifecycle-controller.js');

assert.equal(LifecycleController.create({}).init(),false,'headless init is false');
assert.equal(LifecycleController.create({getDocument:()=>({querySelector:()=>null})}).init(),false,'missing root is false');

const step4={id:'step4'};const document={querySelector:s=>s==='#step4'?step4:null};
let order=[];let bindResult={bound:false};let captured=null;let restoreThrows=false;
const controller=LifecycleController.create({
  getDocument:()=>document,navigationMount:doc=>{assert.equal(doc,document);order.push('navigation');},playbackMount:()=>order.push('playback'),
  UIBindings:{bind(options){captured=options;order.push('bind');return bindResult;}},getBindingOptions:()=>({marker:'same',setType(){}}),
  restoreEditorSettings:()=>{order.push('restore');if(restoreThrows)throw new Error('restore');},onError:(label,error)=>{order.push('error');assert.equal(label,'[Step04:settings-restore]');assert.equal(error.message,'restore');}
});
assert.equal(controller.init(),false,'bind failure is false');assert.equal(controller.isInitialized(),false);assert.deepEqual(order,['navigation','playback','bind']);
assert.equal(captured.document,document);assert.equal(captured.root,step4);assert.equal(captured.marker,'same');assert.equal(typeof captured.setType,'function');
order=[];bindResult={bound:true};assert.equal(controller.init(),true,'bind failure can retry');assert.deepEqual(order,['navigation','playback','bind','restore']);assert.equal(controller.isInitialized(),true);
order=[];assert.equal(controller.init(),true,'initialized call is idempotent');assert.deepEqual(order,[],'idempotent call does not remount or bind');

order=[];restoreThrows=true;
const throwing=LifecycleController.create({getDocument:()=>document,navigationMount:()=>order.push('navigation'),playbackMount:()=>order.push('playback'),UIBindings:{bind:()=>{order.push('bind');return {bound:true};}},restoreEditorSettings:()=>{order.push('restore');throw new Error('restore');},onError:(label,error)=>{order.push('error');assert.equal(label,'[Step04:settings-restore]');assert.equal(error.message,'restore');}});
assert.equal(throwing.init(),true,'restore exception still initializes');assert.equal(throwing.isInitialized(),true);assert.deepEqual(order,['navigation','playback','bind','restore','error']);
console.log('Step04 lifecycle controller tests passed');
