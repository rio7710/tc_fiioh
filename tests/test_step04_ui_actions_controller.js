const assert = require('node:assert/strict');
const UIActionsController = require('../01_app/assets/steps/step04/step04-ui-actions-controller.js');

(async()=>{
  const imageModal={hidden:true};const helpModal={hidden:true};const bodyClasses=[];
  const root={querySelector:s=>s==='#imageRegenerationModal'?imageModal:s==='#platformGuideModal'?helpModal:null};
  let renderCalls=0;let selected=new Set(['youtube']);let saves=0;const shellOrder=[];
  let saveResult;
  const controller=UIActionsController.create({root,getBody:()=>({classList:{add:v=>bodyClasses.push(v)}}),startRender:()=>{renderCalls++;return 'rendered';},
    getBrandAssets:()=>[{version_id:'v1'},{version_id:'v2'}],callShellFeature:(name,arg,options)=>{shellOrder.push([name,arg?.version_id,options?.force]);if(name==='saveBrandSelections')return saveResult;},
    getSelectedPlatforms:()=>selected,setSelectedPlatforms:value=>{shellOrder.push(['state']);selected=value;},saveEditorSettings:()=>{shellOrder.push(['save']);saves++;}});
  assert.equal(controller.openImageRegeneration(),undefined);assert.equal(imageModal.hidden,false);
  assert.equal(controller.closeImageRegeneration(),undefined);assert.equal(imageModal.hidden,true);
  imageModal.hidden=false;assert.equal(controller.requestImageRegeneration(),undefined);assert.equal(imageModal.hidden,true);
  assert.doesNotThrow(()=>UIActionsController.create({}).openImageRegeneration(),'headless modal actions are safe');
  const shellCalls=[];const requestPromise=Promise.resolve('requested');
  const shellController=UIActionsController.create({root,hasShellFeature:name=>['openImageRegeneration','closeImageRegeneration','requestImageRegeneration'].includes(name),callShellFeature:(name,...args)=>{shellCalls.push([name,...args]);return name==='openImageRegeneration'?undefined:name==='closeImageRegeneration'?'closed':requestPromise;}});
  imageModal.hidden=true;
  assert.equal(shellController.openImageRegeneration('scene-1'),undefined);assert.equal(imageModal.hidden,true,'shell open returning undefined does not run fallback');
  assert.equal(shellController.closeImageRegeneration('cancel'),'closed');assert.equal(imageModal.hidden,true);
  assert.equal(shellController.requestImageRegeneration({prompt:'new'}),requestPromise,'request Promise is propagated unchanged');
  assert.equal(await requestPromise,'requested');
  assert.deepEqual(shellCalls,[['openImageRegeneration','scene-1'],['closeImageRegeneration','cancel'],['requestImageRegeneration',{prompt:'new'}]]);
  assert.deepEqual(['16x9','9x16','4x5','1x1','bad'].map(v=>controller.platformForRatio(v)),['youtube','instagram','facebook','square','youtube']);
  assert.equal(controller.startRender(),'rendered');assert.equal(renderCalls,1);assert.equal(UIActionsController.create({}).startRender(),undefined);
  assert.equal(controller.openDistributionHelp(),undefined);assert.equal(helpModal.hidden,false);assert.deepEqual(bodyClasses,['modal-open']);

  shellOrder.length=0;saveResult=undefined;const regular=controller.brandChanged({target:{id:'brandWatermarkVersion',value:'v1'}});assert.ok(regular instanceof Promise);await regular;
  assert.deepEqual(shellOrder,[['updateWatermarkPreview',undefined,undefined],['updateCommonOutroPreview',undefined,undefined],['saveBrandSelections',undefined,undefined]]);
  shellOrder.length=0;saveResult=Promise.resolve().then(()=>shellOrder.push(['saved-async']));await controller.brandChanged({target:{id:'brandOutroVersion',value:'v2'}});
  assert.deepEqual(shellOrder,[['ensureOutroRatioAssets','v2',true],['updateWatermarkPreview',undefined,undefined],['updateCommonOutroPreview',undefined,undefined],['saveBrandSelections',undefined,undefined],['saved-async']]);

  const button={attrs:{},setAttribute(k,v){shellOrder.push(['aria',v]);this.attrs[k]=v;}};
  shellOrder.length=0;assert.equal(controller.toggleDistribution('instagram',button),undefined);assert.equal(selected.has('instagram'),true);assert.deepEqual(shellOrder,[['state'],['aria','true'],['save']]);
  shellOrder.length=0;controller.toggleDistribution('instagram',button);assert.equal(selected.has('instagram'),false);assert.deepEqual(shellOrder,[['state'],['aria','false'],['save']]);
  shellOrder.length=0;controller.toggleDistribution('',button);assert.deepEqual(shellOrder,[],'empty platform exits before mutation');assert.equal(saves,2);
  console.log('Step04 UI actions controller tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
