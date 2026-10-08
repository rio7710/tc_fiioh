const assert = require('node:assert/strict');
const SettingsController = require('../01_app/assets/steps/step04/step04-settings-controller.js');

(async()=>{

function button(key, value) { return { dataset:{[key]:value}, attrs:{}, setAttribute(k,v){this.attrs[k]=v;} }; }
const volume={value:'0.7'}, status={textContent:''};
const types=[button('type','minimal')], music=[button('music','debussy')], platforms=[button('platform','youtube'),button('platform','threads')];
const root={querySelector:s=>s==='#musicVolume'?volume:s==='#renderStatus'?status:null,querySelectorAll:s=>s==='.type-btn'?types:s==='.music-btn[data-music]'?music:s==='.distribution-btn'?platforms:[]};
const state={currentType:'editorial',selectedMusic:'satie',currentVolume:.5,videoPanX:50,captionSizeLevel:0,narrationEnabled:true,currentPreviewPlatform:'youtube',selectedPlatforms:new Set(['youtube']),sceneCropPositions:{old:{}} ,sceneDissolveSeconds:.5};
const storageData=new Map(); const storage={setItem:(k,v)=>storageData.set(k,v),getItem:k=>storageData.get(k)||null};
const calls=[]; let catalogSeen=null; let apiCall=null; let errors=0;
const controller=SettingsController.create({root,storage,storageKey:'thinkcast-editor-settings-v1',getState:k=>state[k],setState:(k,v)=>{state[k]=v;},
  configureRatioCatalog:c=>{catalogSeen=c;},clampVideoPan:v=>Math.max(0,Math.min(100,v)),api:async(...args)=>{apiCall=args;return {ok:true};},onError:()=>{errors++;},
  setVideoPan:v=>{calls.push(['pan',v]);state.videoPanX=Math.max(0,Math.min(100,v));},setCaptionSize:v=>{calls.push(['caption',v]);state.captionSizeLevel=Math.max(-5,Math.min(5,v));},
  setNarration:v=>{calls.push(['narration',v]);state.narrationEnabled=v;},setType:v=>{calls.push(['type',v]);state.currentType=v;},setMusic:v=>{calls.push(['music',v]);state.selectedMusic=v;},
  setPlatformPreview:v=>{calls.push(['platform',v]);state.currentPreviewPlatform=v;},setSceneDissolveSeconds:v=>{calls.push(['dissolve',v]);state.sceneDissolveSeconds=Math.max(0,Math.min(3,v));}
});

const catalog={music:{debussy:{uri:'/d.mp3'}}};
const configured=controller.configure({type:'minimal',music:'debussy',volume:2,video_pan_x:.6,caption_size:8,narration:false,preview_platform:'threads',platforms:['youtube','threads'],scene_dissolve_seconds:4},catalog);
assert.equal(configured.settings.type,'minimal'); assert.equal(configured.catalog,catalog); assert.equal(catalogSeen,catalog);
assert.equal(controller.getConfiguredSettings().music,'debussy'); assert.equal(controller.getConfiguredCatalog(),catalog); assert.equal(controller.isConfigured(),true);
assert.deepEqual(calls.map(x=>x[0]),['pan','caption','narration','type','music','platform','dissolve'],'restore callback order is stable');
assert.equal(state.sceneCropPositions && Object.keys(state.sceneCropPositions).length,0); assert.equal(platforms[1].attrs['aria-pressed'],'true');
assert.equal(state.currentVolume,1); assert.equal(state.videoPanX,60); assert.equal(state.captionSizeLevel,5); assert.equal(state.sceneDissolveSeconds,3);

assert.deepEqual(controller.getEffectiveSettingsPayload(),{type:'minimal',music:'debussy',volume:1,narration:false,preview_platform:'threads',platforms:['youtube','threads'],video_pan_x:.6,scene_dissolve_seconds:3,caption_size:5});
await controller.persistRenderSettings();
assert.equal(apiCall[0],'/api/render-settings'); assert.equal(apiCall[1].method,'POST');
assert.deepEqual(JSON.parse(apiCall[1].body),{schema_version:'render-settings.v1',overrides:controller.getEffectiveSettingsPayload()});
const local=JSON.parse(storageData.get('thinkcast-editor-settings-v1')); assert.deepEqual(Object.keys(local),['type','music','volume','videoPanX','captionSize','narration','previewPlatform','platforms']);

storageData.set('thinkcast-editor-settings-v1',JSON.stringify({type:'bad',music:'bad',previewPlatform:'bad',platforms:['threads','bad'],videoPanX:150,captionSize:-9,narration:true,sceneDissolveSeconds:-2,volume:'bad'}));
const localState={...state}; const localCalls=[];
const localController=SettingsController.create({root,storage,storageKey:'thinkcast-editor-settings-v1',getState:k=>localState[k],setState:(k,v)=>{localState[k]=v;},setVideoPan:v=>localCalls.push(['pan',v]),setCaptionSize:v=>localCalls.push(['caption',v]),setNarration:v=>localCalls.push(['narration',v]),setType:v=>localCalls.push(['type',v]),setMusic:v=>localCalls.push(['music',v]),setPlatformPreview:v=>localCalls.push(['platform',v]),setSceneDissolveSeconds:v=>localCalls.push(['dissolve',v])});
localController.restoreEditorSettings();
assert.deepEqual(localCalls,[['pan',150],['caption',-9],['narration',true],['type','editorial'],['music','satie'],['platform','youtube'],['dissolve',-2]]);
assert.deepEqual([...localState.selectedPlatforms],['threads'],'DOM validity filters selected platforms');

storageData.set('thinkcast-editor-settings-v1','{bad'); assert.equal(controller.loadEditorSettings(),null); assert.equal(errors,1);
const broken=SettingsController.create({storage:{getItem(){throw new Error('read');},setItem(){throw new Error('write');}},storageKey:'x',getState:()=>null,onError:()=>{errors++;}});
assert.equal(broken.loadEditorSettings(),null); broken.saveEditorSettings(); assert.ok(errors>=3);
const failed=SettingsController.create({root,storage,storageKey:'x',getState:k=>state[k],api:async()=>{throw new Error('offline');},onError:()=>{}});
await failed.persistRenderSettings(); assert.equal(status.textContent,'설정 저장 실패 (오프라인/오류)');
assert.doesNotThrow(()=>SettingsController.create({getState:()=>null,setState(){},setVideoPan(){},setCaptionSize(){},setNarration(){},setType(){},setMusic(){},setPlatformPreview(){},setSceneDissolveSeconds(){}}).restoreEditorSettings(), 'optional DOM is safe');
console.log('Step04 settings controller tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
