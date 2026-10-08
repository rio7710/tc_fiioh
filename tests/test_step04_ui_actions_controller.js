const assert = require('node:assert/strict');
const UIActionsController = require('../01_app/assets/steps/step04/step04-ui-actions-controller.js');

(async()=>{
  const imageModal={hidden:true};const helpModal={hidden:true};const bodyClasses=[];
  const root={querySelector:s=>s==='#imageRegenerationModal'?imageModal:s==='#platformGuideModal'?helpModal:null};
  let renderCalls=0;let selected=new Set(['youtube']);let saves=0;const shellOrder=[];
  let saveResult;
  const controller=UIActionsController.create({root,getBody:()=>({classList:{add:v=>bodyClasses.push(v)}}),startRender:()=>{renderCalls++;return 'rendered';},
    getBrandAssets:()=>[{version_id:'v1'},{version_id:'v2'}],callShellFeature:(name,arg)=>{shellOrder.push([name,arg?.version_id]);if(name==='saveBrandSelections')return saveResult;},
    getSelectedPlatforms:()=>selected,setSelectedPlatforms:value=>{shellOrder.push(['state']);selected=value;},saveEditorSettings:()=>{shellOrder.push(['save']);saves++;}});
  assert.equal(controller.openImageRegeneration(),undefined);assert.equal(imageModal.hidden,false);
  assert.equal(controller.closeImageRegeneration(),undefined);assert.equal(imageModal.hidden,true);
  imageModal.hidden=false;assert.equal(controller.requestImageRegeneration(),undefined);assert.equal(imageModal.hidden,true);
  assert.doesNotThrow(()=>UIActionsController.create({}).openImageRegeneration(),'headless modal actions are safe');
  assert.deepEqual(['16x9','9x16','4x5','1x1','bad'].map(v=>controller.platformForRatio(v)),['youtube','instagram','facebook','square','youtube']);
  assert.equal(controller.startRender(),'rendered');assert.equal(renderCalls,1);assert.equal(UIActionsController.create({}).startRender(),undefined);
  assert.equal(controller.openDistributionHelp(),undefined);assert.equal(helpModal.hidden,false);assert.deepEqual(bodyClasses,['modal-open']);

  shellOrder.length=0;saveResult=undefined;const regular=controller.brandChanged({target:{id:'brandWatermarkVersion',value:'v1'}});assert.ok(regular instanceof Promise);await regular;
  assert.deepEqual(shellOrder,[['updateWatermarkPreview',undefined],['updateCommonOutroPreview',undefined],['saveBrandSelections',undefined]]);
  shellOrder.length=0;saveResult=Promise.resolve().then(()=>shellOrder.push(['saved-async']));await controller.brandChanged({target:{id:'brandOutroVersion',value:'v2'}});
  assert.deepEqual(shellOrder,[['ensureOutroRatioAssets','v2'],['updateWatermarkPreview',undefined],['updateCommonOutroPreview',undefined],['saveBrandSelections',undefined],['saved-async']]);

  const button={attrs:{},setAttribute(k,v){shellOrder.push(['aria',v]);this.attrs[k]=v;}};
  shellOrder.length=0;assert.equal(controller.toggleDistribution('instagram',button),undefined);assert.equal(selected.has('instagram'),true);assert.deepEqual(shellOrder,[['state'],['aria','true'],['save']]);
  shellOrder.length=0;controller.toggleDistribution('instagram',button);assert.equal(selected.has('instagram'),false);assert.deepEqual(shellOrder,[['state'],['aria','false'],['save']]);
  shellOrder.length=0;controller.toggleDistribution('',button);assert.deepEqual(shellOrder,[],'empty platform exits before mutation');assert.equal(saves,2);
  console.log('Step04 UI actions controller tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
