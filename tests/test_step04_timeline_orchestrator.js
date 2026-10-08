const assert = require('node:assert/strict');
const TimelineOrchestrator = require('../01_app/assets/steps/step04/step04-timeline-orchestrator.js');

function make({hasRoot=true,paused=true,time=0,seekable=true}={}) {
  const order=[]; let mediaTime=time; const video={paused}; let frame=null;
  Object.defineProperty(video,'currentTime',{
    get:()=>mediaTime,
    set:value=>{ if(seekable) mediaTime=value; }
  });
  const controller=TimelineOrchestrator.create({
    getRoot:()=>hasRoot?{querySelector:s=>s==='#video'?video:null}:null,
    setCurrentScene:value=>order.push(['current',value]),renderSceneList:()=>order.push(['render']),
    updateSummary:()=>order.push(['summary']),previewSync:value=>{order.push(['preview',value]);return {time:value};},
    syncNarration:value=>order.push(['narration',value]),scheduleFrame:callback=>{order.push(['frame']);frame=callback;}
  });
  return {controller,order,video,setMediaTime:value=>{mediaTime=value;},getFrame:()=>frame};
}

const headless=make({hasRoot:false});
assert.equal(headless.controller.applyTimeline({scenes:[]}),undefined);
assert.deepEqual(headless.order,[['current',-1],['render']],'headless apply resets and renders without summary/sync');
assert.deepEqual(headless.controller.getScenes(),[]);assert.equal(headless.controller.sync(),undefined);

const one=make({time:0});
const source={scenes:[{id:'a',name:'Name',script:'Script',preview_uri:'/a.jpg',start:'1',end:'4',cue_start:'1.5',cue_end:'3.5'}]};
assert.equal(one.controller.applyTimeline(source),undefined);
assert.deepEqual(one.order,[['current',-1],['render'],['summary'],['preview',0],['narration',0]]);
assert.deepEqual(one.controller.getScenes()[0],{id:'a',name:'Name',script:'Script',preview_uri:'/a.jpg',start:'1',end:'4',cue_start:'1.5',cue_end:'3.5',text:'Script',image:'/a.jpg',cueStart:1.5,cueEnd:3.5});
source.scenes[0].script='mutated input';assert.equal(one.controller.getScenes()[0].text,'Script','normalization creates internal scene objects separate from input');

const many=make({paused:false,time:7});
many.controller.applyTimeline({scenes:[
  {id:'a',title:'Title',image:'/existing.jpg',start:0,end:2},
  {id:'b',narration:'Narration',start:2,end:6,cueStart:'2.2',cueEnd:'5.8'},
  {id:'c',line:'Line',start:6,end:9}
]});
assert.equal(many.controller.getScenes().length,3);
assert.deepEqual(many.controller.getScenes().map(s=>[s.text,s.image,s.cueStart,s.cueEnd]),[['Title','/existing.jpg',0,2],['Narration','',2.2,5.8],['Line','',6,9]]);
assert.deepEqual(many.order.slice(-3),[['preview',7],['narration',7],['frame']],'playing sync schedules frame after preview and narration');
assert.equal(typeof many.getFrame(),'function');

const unseekable=make({paused:true,time:0,seekable:false});
unseekable.controller.applyTimeline({scenes:[{start:0,end:3},{start:3,end:7}]});
unseekable.order.length=0;
assert.equal(unseekable.controller.setPreviewTime(3.55),undefined);
assert.equal(unseekable.video.currentTime,0,'failed media seek does not change the media clock');
assert.equal(unseekable.controller.getPreviewTime(),3.55,'logical preview time advances independently');
unseekable.controller.sync();
assert.deepEqual(unseekable.order,[['preview',3.55],['narration',3.55]],'paused preview remains at logical navigation time');
unseekable.video.paused=false;
unseekable.setMediaTime(1.25);
unseekable.order.length=0;
unseekable.controller.sync();
assert.equal(unseekable.controller.getPreviewTime(),1.25,'active playback reflects the media clock into logical time');
assert.deepEqual(unseekable.order,[['preview',1.25],['narration',1.25],['frame']]);

const missingVideo=TimelineOrchestrator.create({getRoot:()=>({querySelector:()=>null}),previewSync:()=>{throw new Error('must not run');}});
missingVideo.applyTimeline({scenes:[{start:0,end:1}]});assert.equal(missingVideo.sync(),undefined);
console.log('Step04 timeline orchestrator tests passed');
