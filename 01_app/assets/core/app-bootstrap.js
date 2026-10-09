(async()=>{
const stepPartialDefinitions=[
  {container:'#userSettingsContainer',path:'/01_app/pages/components/user-settings.html'},
  {container:'#workflowProgressContainer',path:'/01_app/pages/components/workflow-progress.html'},
  {container:'#step01LoginContainer',path:'/01_app/pages/steps/step01-login.html'},
  {container:'#step01IndexContainer',path:'/01_app/pages/steps/step01-content-index.html'},
  {container:'#step01ProjectContainer',path:'/01_app/pages/steps/step01-project.html'},
  {container:'#step02Container',path:'/01_app/pages/steps/step02-keyword.html'},
  {container:'#step03Container',path:'/01_app/pages/steps/step03-script.html'},
  {container:'#step031Container',path:'/01_app/pages/steps/step03-storyboard.html'},
  {container:'#step05Container',path:'/01_app/pages/steps/step05-calendar.html'}
];
let stepPartialsPromise=null;
function ensureStepPartialsLoaded(){
  if(!stepPartialsPromise)stepPartialsPromise=window.StepPartialLoader.load(document,stepPartialDefinitions);
  return stepPartialsPromise;
}
stepPartialsPromise=ensureStepPartialsLoaded();
await ensureStepPartialsLoaded();
const todayParts=Object.fromEntries(new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',weekday:'long'}).formatToParts(new Date()).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
document.querySelectorAll('.page-date').forEach(item=>{
  item.dateTime=`${todayParts.year}-${todayParts.month}-${todayParts.day}`;
  item.textContent=`Date : ${todayParts.year}. ${todayParts.month}. ${todayParts.day}. ${todayParts.weekday}`;
});
let scenes=[];
const brandOverlayState=Step04BrandState.create();
const timelineBridge=Step04TimelineBridge.create({
  createAudio:src=>new Audio(src),
  applyEditorTimeline:timeline=>window.Step04VideoEditor?.applyTimeline(timeline),
  setEditorNarrationTracks:payload=>window.Step04VideoEditor?.setNarrationTracks(payload),
  resetActiveNarration:()=>window.Step04VideoEditor?.stopNarration(),
  getStoryboardImage:id=>storedStoryboardImages.get(id),
  getStoryboardVideo:id=>storedStoryboardVideos.get(id),
  getSceneVoice:id=>sceneVoiceContext(id).voice,
  onTimelineApplied:nextScenes=>{
    const duration=nextScenes.length?nextScenes[nextScenes.length-1].end:0;
    sceneTimelineSummary.textContent=`타임라인 기준 · 총 ${nextScenes.length}장면 · ${duration}초`;
    nextScenes.forEach(scene=>{if(scene.image){const preload=new Image();preload.src=scene.image}});
  }
});
const normalizeNarrationSrc=src=>timelineBridge.normalizeNarrationSrc(src);
const setNarrationTracks=tracks=>timelineBridge.setNarrationTracks(tracks);
if(typeof window!=='undefined'){
  Object.defineProperties(window,{
    narrationTracks:{configurable:true,get:()=>timelineBridge.getNarrationTracks()},
    narrations:{configurable:true,get:()=>timelineBridge.getNarrations()},
    narrationAudios:{configurable:true,get:()=>timelineBridge.getNarrationAudios()}
  });
  window.setNarrationTracks=setNarrationTracks;
}

function applyTimeline(timeline){
  scenes=timelineBridge.applyTimeline(timeline).scenes;
}

const SETTINGS_STORAGE_KEY='greenhill-p1-editor-settings-v1';
const SCRIPT_STORAGE_KEY='greenhill-script-saved-v1';
const CALENDAR_STORAGE_KEY='greenhill-content-calendar-v2';
const CALENDAR_UI_STORAGE_KEY='greenhill-content-calendar-ui-v1';
const LATEST_EXPORT_STORAGE_KEY='greenhill-latest-export-v1';
const latestExport=document.querySelector('#latestExport');
const latestExportList=document.querySelector('#latestExportList');
const calendarGrid=document.querySelector('#calendarGrid');
const calendarMonthTitle=document.querySelector('#calendarMonthTitle');
const calendarHelp=document.querySelector('#calendarHelp');
const calendarSettingsModal=document.querySelector('#calendarSettingsModal');
const calendarSettingsTitle=document.querySelector('#calendarSettingsTitle');
const calendarSettingsDate=document.querySelector('#calendarSettingsDate');
const calendarSettingsPlatforms=document.querySelector('#calendarSettingsPlatforms');
const calendarContentView=document.querySelector('#calendarContentView');
const contentUnavailableModal=document.querySelector('#contentUnavailableModal');
const calendarPreviewModal=document.querySelector('#calendarPreviewModal');
const calendarPreviewVideo=document.querySelector('#calendarPreviewVideo');
const calendarPreviewTitle=document.querySelector('#calendarPreviewTitle');
const calendarPreviewMeta=document.querySelector('#calendarPreviewMeta');
const calendarPreviewDownload=document.querySelector('#calendarPreviewDownload');
const calendarPreviewVersionPrev=document.querySelector('#calendarPreviewVersionPrev');
const calendarPreviewVersionNext=document.querySelector('#calendarPreviewVersionNext');
const calendarPreviewVersionCount=document.querySelector('#calendarPreviewVersionCount');
let calendarEntries=[];
let currentPreviewPlatform='youtube';
let captionSizeLevel=0;
let videoPanX=50;
let sceneCropPositions={};
let narrationEnabled=true;
let activeNarration=-1;
let selectedMusic='satie';
let currentType='editorial';
let currentScene=-1;
const sceneDissolveSeconds=.5;
let demoData={state:{},timeline:{scenes:[]},keywords:[]};
let activeStoryboardDocument=null;
let storedStoryboardImages=new Map();
let storedStoryboardImageCandidates=new Map();
let storedStoryboardVoiceClips=new Map();
let storedStoryboardVideos=new Map();
let storedStoryboardVideoCandidates=new Map();
let storyboardLook='original';
function applyStoryboardLook(look){
  return storyboardLookController.apply(look);
}
function restoreStoryboardLook(){return storyboardLookController.restore()}
function setStoryboardImageCandidates(items){
  return storyboardProjectStateController.setImageCandidates(items||[]);
}
function setStoryboardVideoCandidates(items){
  return storyboardProjectStateController.setVideoCandidates(items||[]);
}
function connectStoryboardAssetsToEditor(){
  return storyboardProjectStateController.connect();
}
let selectedKeywords=new Set();
function resetProjectScopedState(){
  return storyboardProjectStateController.reset();
}
let visibleKeywordIds=[];
let settingsReady=false;
function setLoginAccess(enabled,account=null){
  return authUIController.setAccess(enabled,account);
}

const fmt=s=>{const n=Math.max(0,Math.floor(s||0));return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`};
function sceneImageRequests(sceneIndex){
  return imageRegenerationController.requestsForScene(sceneIndex);
}
function updateImageVariantCount(){
  return imageRegenerationController.updateVariantCount();
}
function sceneBaseGuide(scene){
  return imageRegenerationController.baseGuide(scene);
}
function openImageRegeneration(){
  return imageRegenerationController.open();
}
function closeImageRegeneration(resetCreate=true){
  return imageRegenerationController.close(resetCreate);
}
async function requestImageRegeneration(){
  return imageRegenerationController.request();
}
let frontendApi=null;
async function api(path,options={}){
  if(!frontendApi)frontendApi=window.ThinkCastApiClient.createApiClient();
  const result=await frontendApi(path,options);
  return result;
}

const providerSettingsController=ThinkCastProviderSettingsController.create({getRoot:()=>document,request:(...args)=>api(...args),escapeHtml,setTimeout:(...args)=>setTimeout(...args)});
providerSettingsController.mount(document);
function refreshApiConnections(){return providerSettingsController.refresh()}
function closeApiSettings(){return providerSettingsController.close()}
function openApiSettings(step){return providerSettingsController.open(step)}
function ensureStepApiReady(step){return providerSettingsController.ensureStepReady(step)}
const promptLabController=ThinkCastPromptLabController.create({getRoot:()=>document,request:(...args)=>api(...args),fetch:(...args)=>fetch(...args),createTextDecoder:()=>new TextDecoder(),createEmptyBytes:()=>new Uint8Array()});
promptLabController.mount(document);
const platformGuideModal=document.querySelector('#platformGuideModal');
function closePlatformGuide(){platformGuideModal.hidden=true;document.body.classList.remove('modal-open')}
document.querySelector('#platformGuideClose').addEventListener('click',closePlatformGuide);
platformGuideModal.addEventListener('pointerdown',event=>{if(event.target===platformGuideModal)closePlatformGuide()});
function readContentRoute(){
  return shellNavigationController.readRoute();
}
function writeContentRoute(step,mode='push'){
  return shellNavigationController.writeRoute(step,mode);
}
const ACTIVE_PROJECT_STORAGE_KEY='thinkcast-active-project-v1';
let activeProjectId=null;
const projectStore=typeof ThinkCastProjectStore!=='undefined'&&ThinkCastProjectStore.createProjectStore?ThinkCastProjectStore.createProjectStore({activeProjectId:null}):null;
function setActiveProjectId(projectId){
  activeProjectId=projectId;
  if(projectId)localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY,projectId);
  else localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
  if(projectStore)projectStore.setActiveProject(projectId);
}
function selectRouteProject(route){
  return shellNavigationController.selectRouteProject(route);
}
async function restoreContentRoute(){
  return shellNavigationController.restoreRoute();
}
function showStep(step,historyMode='push'){
  return shellNavigationController.showStep(step,historyMode);
}
function prepareRestoredStep(target){
  return shellNavigationController.prepareStep(target);
}
function showContentIndexMessage(text){
  const el=document.querySelector('#contentIndexMessage');
  if(!el)return;
  el.textContent=text||'';
  el.hidden=!text;
}
const contentIndexErrors={};
function setContentIndexError(key,message){
  if(message)contentIndexErrors[key]=message;else delete contentIndexErrors[key];
  showContentIndexMessage(Object.values(contentIndexErrors).join(' · '));
}
async function navigateProjectStep(requestedTarget,{historyMode='push'}={}){
  return shellNavigationController.navigate(requestedTarget,{historyMode});
}

const indexProjects={};
function beginNav(){return shellNavigationController.begin()}
function isStaleNav(token){return shellNavigationController.isStale(token)}
let selectedVoiceProfile='warm_female';
let seasonalKeywordIds=new Set();
let keywordStageLocked=false;
function setKeywordStageLocked(locked){
  keywordStageLocked=Boolean(locked);
  document.querySelector('#trendKeywordOpen').disabled=keywordStageLocked;
  return keywordController.setLocked(keywordStageLocked);
}
function updateContentUuidLabels(){
  document.querySelectorAll('.step-view').forEach(view=>{
    let label=view.querySelector(':scope > .content-uuid, :scope > .flow-card > .content-uuid');
    if(!label){
      label=document.createElement('p');label.className='content-uuid';
      const host=view.querySelector(':scope > .flow-card')||view;
      const date=host.querySelector(':scope > .page-date');
      if(date)date.insertAdjacentElement('afterend',label);else host.prepend(label);
    }
    label.classList.toggle('missing',!activeProjectId);
    label.textContent=`CONTENT UUID · ${activeProjectId||'없음'}`;
  });
}
function showTokenUsage(usage){document.querySelector('#tokenUsage').textContent=`API ${(Number(usage?.total_tokens)||0).toLocaleString('ko-KR')} tokens · ${Number(usage?.requests)||0}회`}
function projectDate(value){return value?new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value)).replace(/\. /g,'.').replace(/\.$/,''):'—'}
function automationStageLabel(stage){if(!stage||stage==='create_project')return '콘텐츠 생성';if(stage.startsWith('keywords_'))return '키워드 선정';if(stage.startsWith('script_'))return '대본·타임라인';if(stage.startsWith('voice_'))return '음성 준비';if(stage==='video_scene_selection')return '영상 장면 선택';if(stage.startsWith('image_'))return '장면 이미지 생성';if(stage.startsWith('video_submit_')||stage.startsWith('video_complete_'))return '장면 영상 변환';if(stage.startsWith('crop_'))return '사람 위치 조정';if(stage==='video_design')return '영상 디자인';if(stage==='final_export_calendar')return '영상 제작·캘린더';return stage}
function projectCreatedDate(value){if(!value)return '날짜 미정';const parts=Object.fromEntries(new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',weekday:'long'}).formatToParts(new Date(value)).map(part=>[part.type,part.value]));return `${parts.year}년 ${parts.month}월 ${parts.day}일 ${parts.weekday}`}
function renderProjectIndex(projects){
  return projectIndexController.render(projects);
}
function refreshProjectIndex(){return projectIndexController.refresh()}
function openIndexProject(projectId,historyMode='push'){
  return contentIndexController.openProject(projectId,historyMode);
}
async function loadProjectContent(projectId,token){
  return projectHydrationController.loadContent(projectId,token);
}
let outroRatioAssets=null;
let brandStagePreview=null;
const brandSelectionController=Step04BrandSelectionController.create({getRoot:()=>document,request:(...args)=>api(...args),state:brandOverlayState,isOutroRatioCompanion:item=>outroRatioAssets.isCompanion(item),ensureOutroRatioAssets:(...args)=>outroRatioAssets.ensure(...args),updateWatermarkPreview:()=>updateWatermarkPreview(),updateOutroPreview:()=>updateCommonOutroPreview(),getSceneCount:()=>scenes.length,renderSceneList:()=>renderSceneList(),escapeHtml});
outroRatioAssets=Step04OutroRatioAssets.create({state:brandOverlayState,getAssets:()=>brandSelectionController.getAssets()});
function isOutroRatioCompanion(item){return outroRatioAssets.isCompanion(item)}
function ensureOutroRatioAssets(item,options){return outroRatioAssets.ensure(item,options)}
brandStagePreview=Step04BrandStagePreview.create({getRoot:()=>document,state:brandOverlayState,getAssets:()=>brandSelectionController.getAssets(),ensureOutroRatioAssets,getCurrentRatio:()=>{if(window.Step04VideoEditor?.currentCropFormat)return window.Step04VideoEditor.currentCropFormat();const stageCard=document.querySelector('#stageCard')||document.querySelector('.stage-card');if(!stageCard)return '16x9';return window.RatioProfiles?window.RatioProfiles.calculateCropFormat(stageCard.className):'16x9'}});
function brandRoleControls(role){return brandStagePreview.roleControls(role)}
function renderBrandChoices(){return brandSelectionController.renderChoices()}
function applyWatermarkPosition(element,position){return brandStagePreview.applyPosition(element,position)}
function currentCropFormat(){return brandStagePreview.currentRatio()}
function activeWatermarkProfile(){return brandStagePreview.activeWatermarkProfile()}
function updateWatermarkPreview(){return brandStagePreview.updateWatermark()}
function activeOutroProfile(){return brandStagePreview.activeOutroProfile()}
function outroBackgroundColor(profile){return brandStagePreview.backgroundColor(profile)}
function updateCommonOutroPreview(){return brandStagePreview.updateOutro()}
function currentBrandSelections(){return brandSelectionController.serializeSelections()}
function saveBrandSelections(){return brandSelectionController.saveSelections()}
async function loadProjectState(projectId,token){
  return projectHydrationController.loadState(projectId,token);
}
function setVoiceProfile(profileId){
  return voiceProfileController.setProfile(profileId);
}
function sceneVoiceContext(sceneId){
  return sceneVoiceController.context(sceneId);
}
function updateStoryboardVoiceControls(){
  return sceneVoiceController.updateControls();
}
function renderStoryboardGrid(){
  return storyboardGridRenderer.render();
}
async function cycleStoryboardCandidate(button){
  return candidateSelectionController.selectImage(button);
}
async function cycleStoryboardVideoCandidate(button){
  return candidateSelectionController.selectVideo(button);
}
async function generateStoryboardImage(button,force=true){
  return sceneImageController.generate(button,force);
}
async function generateMissingStoryboardImages(){
  return sceneImageController.generateMissing();
}
async function generateOrPlaySceneVoice(button,autoplay=true){
  return sceneVoiceController.generateOrPlay(button,autoplay);
}
async function generateMissingSceneVoices(){
  return sceneVoiceController.generateMissing();
}
async function pollSceneVideo(card,taskId){
  return sceneVideoController.poll(card,taskId);
}
async function resumePendingSceneVideos(){
  return sceneVideoController.resume();
}
async function generateSceneVideo(button,force=true){
  return sceneVideoController.generate(button,force);
}
async function generateMissingSceneVideos(){
  return sceneVideoController.generateMissing();
}
async function previewVoiceProfile(button){
  return voiceProfileController.preview(button);
}
function renderKeywords(){
  return keywordController.render();
}
function refreshKeywordBatch(){
  return keywordController.refresh();
}
function fillScript(script){
  return scriptEditorController.fill(script);
}
function currentScriptPayload(){
  return scriptEditorController.payload();
}
function updateScriptDiff(){
  return scriptEditorController.updateDiff();
}
function loadSavedScript(){
  return scriptEditorController.loadSaved();
}
function saveScriptLocally(script){
  return scriptEditorController.saveLocal(script);
}
async function saveScriptChanges(){
  return scriptEditorController.save();
}
function escapeHtml(value){
  return String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
}
const calendarStatusLabels={published:'배포 완료',scheduled:'배포 예약',draft:'미배포',deleted:'삭제·제거'};
const calendarPlatformLabels={youtube:'YouTube',instagram:'Instagram',facebook:'Facebook',tiktok:'TikTok',naver:'네이버 블로그',kakaotalk:'카카오톡 채널',threads:'Threads',x:'X',linkedin:'LinkedIn'};
const calendarTimeLabels={published:'배포',scheduled:'예약',draft:'제작',deleted:'삭제'};
function dateKey(date){return Step05Calendar.dateKey(date)}
function nextDateKey(value){return Step05Calendar.nextDateKey(value)}
function calendarId(){return globalThis.crypto?.randomUUID?.()||`content-${Date.now()}-${Math.random().toString(16).slice(2)}`}
function makeCalendarEntry(day,title,status,platform,index){
  const now=new Date();
  const date=new Date(now.getFullYear(),now.getMonth(),day,12);
  const start=dateKey(date);
  return {id:`demo-${now.getFullYear()}-${now.getMonth()+1}-${index}`,title,start,end:nextDateKey(start),allDay:true,extendedProps:{status,platform,createdAt:`${start}T09:00:00+09:00`,scheduledAt:status==='scheduled'?`${start}T11:30:00+09:00`:null,distributedAt:status==='published'?`${start}T14:00:00+09:00`:null,deletedAt:status==='deleted'?`${start}T16:00:00+09:00`:null}};
}
function seedCalendarEntries(){
  const start=dateKey(new Date());
  const outputs=[
    ['youtube','P1_final_minimal_naver_16x9_debussy_20260917_101600.mp4'],
    ['instagram','P1_final_minimal_instagram_9x16_debussy_20260917_101519.mp4'],
    ['facebook','P1_final_minimal_facebook_4x5_debussy_20260917_101641.mp4'],
    ['naver','P1_final_minimal_naver_16x9_debussy_20260917_101600.mp4']
  ];
  return outputs.map(([platform,filename])=>({
    id:`production-ed66d489-${platform}-20260917`,
    title:'가을 햇살 사이 안심과 만나는 하루',start,end:nextDateKey(start),allDay:true,
    extendedProps:{status:'draft',platform,createdAt:new Date().toISOString(),distributedAt:null,contentUrl:`/04_exports/${filename}`,filename}
  }));
}
function loadCalendarEntries(){
  return calendarDataController.load();
}
async function hydrateCalendarEntries(){
  return calendarDataController.hydrate();
}
function calendarContentVersions(entry){
  return Step05Calendar.calendarContentVersions(entry);
}
function saveCalendarEntries(){
  return calendarDataController.save();
}
function showLatestExport(result){
  return latestExportController.show(result);
}
function loadLatestExport(){
  return latestExportController.load();
}
function groupCalendarEntries(entries){
  return Step05Calendar.groupCalendarEntries(entries);
}
function calendarStatusTimestamp(item){
  return Step05Calendar.calendarStatusTimestamp(item);
}
function formatCalendarTime(value){
  return Step05Calendar.formatCalendarTime(value);
}
function calendarTimeInputValue(item){return Step05Calendar.calendarTimeInputValue(item)}
function calendarMinuteOfDay(item){
  return Step05Calendar.calendarMinuteOfDay(item);
}
function renderCalendar(options){
  return calendarPresentationController.render(options);
}
function recordCurrentProduction(result){
  return productionCalendarController.record(result);
}
function icsEscape(value){return Step05Calendar.icsEscape(value)}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function selectedKeywordLabels(){
  return (demoData?.keywords||[]).filter(item=>selectedKeywords.has(item.id)).map(item=>item.label);
}
function selectedPlatformValues(){
  return Array.from(window.Step04VideoEditor?.getSelectedPlatforms?.()||[]);
}
const workflowProgressController=ThinkCastWorkflowProgressController.create({getRoot:()=>document});
workflowProgressController.mount();
function configureWorkflowModal(type,configOverride=null){
  return workflowProgressController.configure(type,configOverride);
}
function setupSceneProgressBadges(role,label){
  const holder=document.createElement('div');
  holder.className='scene-conversion-badges';
  holder.setAttribute('aria-label',label);
  holder.innerHTML=scenes.map((scene,index)=>`<span class="scene-conversion-badge" data-scene-id="${escapeHtml(scene.id)}" data-status="queued" title="${escapeHtml(scene.name)} · 대기">${String(index+1).padStart(2,'0')}</span>`).join('');
  role.querySelector('.ai-role-copy').append(holder);
}
function setupCaptionProgressBadges(role){
  const holder=document.createElement('div');holder.className='scene-conversion-badges';holder.setAttribute('aria-label','문장별 자막 PNG 생성 상태');
  const formatLabels={"preview-landscape":'16:9',"preview-portrait":'9:16',"preview-feed":'4:5',"preview-square":'1:1'};
  const formats=[];selectedPlatformValues().forEach(platform=>{const key=platformPreviewFormats[platform]?.className;if(key&&!formats.includes(key))formats.push(key)});
  holder.innerHTML=formats.flatMap(format=>timelineBridge.getTitleSceneIndexes().map((sceneIndex,index)=>`<span class="scene-conversion-badge" data-format="${formatLabels[format]}" data-status="queued" title="${formatLabels[format]} · 자막 ${String(index+1).padStart(2,'0')} · ${escapeHtml(scenes[sceneIndex]?.name||'문장')} · 대기">${formatLabels[format]}·${String(index+1).padStart(2,'0')}</span>`)).join('');
  role.querySelector('.ai-role-copy').append(holder);
}
function applySequentialCaptionProgress(role,completed){
  [...role.querySelectorAll('.scene-conversion-badge')].forEach((badge,index)=>{badge.dataset.status=index<completed?'succeeded':index===completed?'running':'queued'});
}
function selectedOutputFormatGroups(){
  const labels={"preview-landscape":'16:9',"preview-portrait":'9:16',"preview-feed":'4:5',"preview-square":'1:1'};const groups=[];
  selectedPlatformValues().forEach(platform=>{const label=labels[platformPreviewFormats[platform]?.className];if(!label)return;let group=groups.find(item=>item.label===label);if(!group){group={label,platforms:[]};groups.push(group)}group.platforms.push(platform)});return groups;
}
function setupCompositeFormatBadges(role){
  role.classList.add('has-composite-formats');
  const holder=document.createElement('span');holder.className='composite-format-badges';holder.setAttribute('aria-label','선택 플랫폼별 최종 합성 상태');
  holder.innerHTML=selectedOutputFormatGroups().flatMap((group,formatIndex)=>group.platforms.map(platform=>`<span class="composite-platform-badge" data-format-index="${formatIndex}" data-format="${group.label}" data-platform="${escapeHtml(platform)}" data-status="queued" title="${escapeHtml(calendarPlatformLabels[platform]||platform)} · 합성 대기"><span class="calendar-platform" data-platform="${escapeHtml(platform)}" aria-label="${escapeHtml(calendarPlatformLabels[platform]||platform)}"></span></span>`)).join('');
  role.querySelector('.ai-role-copy>strong').after(holder);
}
function applyCompositeFormatProgress(role,currentIndex,completeAll=false){
  const statusLabels={queued:'합성 대기',running:'합성 중',succeeded:'합성 완료'};
  [...role.querySelectorAll('.composite-platform-badge')].forEach(badge=>{const formatIndex=Number(badge.dataset.formatIndex);badge.dataset.status=completeAll||formatIndex<currentIndex-1?'succeeded':formatIndex===currentIndex-1?'running':'queued';badge.title=`${calendarPlatformLabels[badge.dataset.platform]||badge.dataset.platform} · ${statusLabels[badge.dataset.status]}`});
}
function applySceneProgressEvent(role,event){
  const badge=[...role.querySelectorAll('.scene-conversion-badge')].find(item=>item.dataset.sceneId===String(event.scene_id));
  if(!badge)return;
  const status=['queued','running','succeeded','failed'].includes(event.status)?event.status:'queued';
  badge.dataset.status=status;
  badge.title=`${scenes.find(scene=>scene.id===String(event.scene_id))?.name||event.scene_id} · ${status}`;
}
async function runDemoSceneProgress(role,onProgress){
  const order=scenes.map(scene=>scene.id);
  for(let index=order.length-1;index>0;index--){const swap=Math.floor(Math.random()*(index+1));[order[index],order[swap]]=[order[swap],order[index]]}
  for(let index=0;index<order.length;index++){
    applySceneProgressEvent(role,{scene_id:order[index],status:'running'});
    await sleep(65+Math.random()*65);
    applySceneProgressEvent(role,{scene_id:order[index],status:'succeeded'});
    onProgress(index+1,order.length);
  }
}
function applySequentialSceneProgress(role,completed){
  scenes.forEach((scene,index)=>{
    const status=index<completed?'succeeded':index===completed&&completed<scenes.length?'running':'queued';
    applySceneProgressEvent(role,{scene_id:scene.id,status});
  });
}
async function runAiWorkflow(){
  return scriptGenerationController.run();
}
async function runProductionWorkflow(){
  return productionWorkflowController.run();
}
const renderController=Step04RenderController.create({
  getRoot:()=>document,
  getLocation:()=>location,
  api,
  fetch:(...args)=>fetch(...args),
  sleep,
  ensureStepApiReady,
  saveBrandSelections,
  pausePreview:()=>{const mainVideo=document.querySelector('#video');if(mainVideo&&typeof mainVideo.pause==='function'){try{mainVideo.pause()}catch(error){console.error('[Step04:render-pause]',error)}}},
  getRenderButton:()=>document.querySelector('#renderBtn'),
  getRenderStatus:()=>document.querySelector('#renderStatus'),
  configureWorkflowModal,
  setupCaptionProgressBadges,
  setupCompositeFormatBadges,
  setupSceneProgressBadges,
  applySequentialCaptionProgress,
  applyCompositeFormatProgress,
  applySequentialSceneProgress,
  getScenes:()=>scenes,
  timelineDuration:()=>scenes.length?Number(scenes[scenes.length-1].end)||0:0,
  getPayload:renderJobId=>{
    const effectiveSettings=(window.Step04VideoEditor&&typeof window.Step04VideoEditor.getEffectiveSettingsPayload==='function')
      ?window.Step04VideoEditor.getEffectiveSettingsPayload()
      :{type:currentType,music:selectedMusic,volume:Number(document.querySelector('#musicVolume')?.value||0.5),narration:narrationEnabled,caption_size:captionSizeLevel,video_pan_x:videoPanX/100,platforms:selectedPlatformValues(),preview_platform:currentPreviewPlatform};
    const activeCropPositions=(window.Step04VideoEditor&&typeof window.Step04VideoEditor.getSceneCropPositions==='function')
      ?window.Step04VideoEditor.getSceneCropPositions():sceneCropPositions;
    return {...effectiveSettings,job_id:renderJobId,project_id:activeProjectId,scene_crop_positions:activeCropPositions,scene_videos:[...storedStoryboardVideos.values()]};
  },
  recordCurrentProduction,
  showLatestExport,
  showStep,
  platformLabels:calendarPlatformLabels,
  escapeHtml,
  now:()=>Date.now(),
  random:()=>Math.random(),
  setInterval:(callback,delay)=>setInterval(callback,delay),
  clearInterval:id=>clearInterval(id),
  onError:error=>console.error('[Step04:render]',error)
});
window.startRenderWorkflow=()=>renderController.start();
function applyScript(script){
  scenes=timelineBridge.applyScript(script).scenes;
  document.querySelector('#projectTitle').textContent=script.headline||'하루를 보면 마음이 보입니다';
  renderSceneList();
  currentScene=-1;
  sync();
}
async function initDemo(){
  if(location.protocol==='file:'){
    document.querySelector('#loginMessage').textContent='P1_미리보기_및_변환_실행.bat를 실행해 열어 주세요.';
    return;
  }
  try{
    demoData=await api('/api/demo');
    applyTimeline(demoData.timeline);
    const state=demoData.state||{};
    selectedKeywords=new Set(state.selected_keywords||[]);
    const defaultIds=demoData.keywords.slice(0,8).map(item=>item.id);
    visibleKeywordIds=[...selectedKeywords,...defaultIds.filter(id=>!selectedKeywords.has(id))].slice(0,8);
    renderKeywords();
    const savedScript=loadSavedScript();
    const initialScript=savedScript||state.script;
    if(savedScript)demoData.state.script=savedScript;
    fillScript(initialScript);
    applyScript(initialScript);
  }catch(error){
    document.querySelector('#loginMessage').textContent=`서버 연결 오류: ${error.message}`;
  }
}

async function restoreLoginSession(){
  return sessionBootstrapController.restore();
}

const brandOverlayController=BrandOverlayController.create({state:brandOverlayState,getBrandAssets:()=>brandSelectionController.getAssets(),prepareOutroPreview:item=>ensureOutroRatioAssets(item,{force:true}),saveSelection:saveBrandSelections,applyPosition:applyWatermarkPosition,backgroundColor:outroBackgroundColor,updateWatermarkPreview,updateOutroPreview:updateCommonOutroPreview,onError:(feature,error)=>console.error(`[BrandOverlay:${feature}]`,error)});
function openWatermarkPreview(versionId){return brandOverlayController.openWatermarkPreview(versionId)}
function openOutroPreview(versionId){return brandOverlayController.openOutroPreview(versionId)}
const brandLibraryController=Step04BrandLibraryController.create({request:(...args)=>api(...args),selectionController:brandSelectionController,isOutroRatioCompanion,openWatermarkPreview,openOutroPreview,readFileAsDataUrl:file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)}),escapeHtml});
function refreshBrandLibrary(){return brandLibraryController.refresh()}
function showBrandLibrary(show){return brandLibraryController.show(show)}
brandLibraryController.mount(document);
const brandOverlayMount=brandOverlayController.mount(document);if(!brandOverlayMount.watermark.ok)console.error('[BrandOverlay:watermark]',brandOverlayMount.watermark.error);if(!brandOverlayMount.outro.ok)console.error('[BrandOverlay:outro]',brandOverlayMount.outro.error);
const scriptEditorController=Step03ScriptEditorController.create({getRoot:()=>document,storage:localStorage,storageKey:SCRIPT_STORAGE_KEY,request:(...args)=>api(...args),getScenes:()=>scenes,escapeHtml,getActiveProjectId:()=>activeProjectId,setDemoTimeline:timeline=>{demoData.timeline=timeline},applyTimeline,getActiveStoryboardDocument:()=>activeStoryboardDocument,setActiveStoryboardDocument:value=>{activeStoryboardDocument=value},setDemoState:state=>{demoData.state=state},applyScript,refreshProjectIndex});
scriptEditorController.mount(document);
const storyboardProjectStateController=Step03StoryboardProjectStateController.create({getRoot:()=>document,getScenes:()=>scenes,setScenes:value=>{scenes=value},setCurrentScene:value=>{currentScene=value},connectTimeline:value=>timelineBridge.connectStoryboardAssetsToEditor(value),resetTimeline:()=>timelineBridge.reset(),setDemoTimeline:value=>{demoData.timeline=value},setCropPositions:value=>{sceneCropPositions=value},setImages:value=>{storedStoryboardImages=value},setImageCandidates:value=>{storedStoryboardImageCandidates=value},setVoiceClips:value=>{storedStoryboardVoiceClips=value},setVideos:value=>{storedStoryboardVideos=value},setVideoCandidates:value=>{storedStoryboardVideoCandidates=value},clearKeywords:()=>selectedKeywords.clear(),setActiveStoryboardDocument:value=>{activeStoryboardDocument=value},resetEditorCrops:value=>{if(window.Step04VideoEditor?.setSceneCropPositions)window.Step04VideoEditor.setSceneCropPositions(value)},getStep04VideoEditor:()=>window.Step04VideoEditor,getFallbackSync:()=>typeof sync==='function'?sync:null,resetProjectStore:()=>{if(projectStore)projectStore.resetProjectState()}});
const projectHydrationComposition=ThinkCastProjectHydrationComposer.create({factories:{keyword:ThinkCastProjectKeywordHydrator,media:ThinkCastProjectMediaHydrator,brandPlatform:ThinkCastProjectBrandPlatformHydrator,editor:ThinkCastProjectEditorHydrator,applier:ThinkCastProjectHydrationApplier},keywordDependencies:{getDemoKeywords:()=>demoData.keywords,setDemoKeywords:value=>{demoData.keywords=value},setSelectedKeywords:value=>{selectedKeywords=value},setSeasonalKeywordIds:value=>{seasonalKeywordIds=value},setVisibleKeywordIds:value=>{visibleKeywordIds=value},renderKeywords},mediaDependencies:{setSceneCropPositions:positions=>{sceneCropPositions=positions;if(window.Step04VideoEditor?.setSceneCropPositions)window.Step04VideoEditor.setSceneCropPositions(positions)},setStoryboardImages:value=>{storedStoryboardImages=value},setStoryboardImageCandidates,setStoryboardVoiceClips:value=>{storedStoryboardVoiceClips=value},setStoryboardVideos:value=>{storedStoryboardVideos=value},setStoryboardVideoCandidates,setVoiceProfile},brandPlatformDependencies:{hydrateBrandSelections:value=>brandSelectionController.hydrate(value),renderBrandChoices,getPlatformButtons:()=>Array.from(document.querySelectorAll('.distribution-btn')),setSelectedPlatforms:value=>window.Step04VideoEditor?.setSelectedPlatforms(value),setPlatformPreview},editorDependencies:{setDemoTimeline:timeline=>{demoData.timeline=timeline},mergeDemoState:values=>{demoData.state={...(demoData.state||{}),...values}},setActiveStoryboardDocument:value=>{activeStoryboardDocument=value},setKeywordStageLocked,applyTimeline,connectStoryboardAssetsToEditor,fillScript,applyScript},applierDependencies:{}});
const projectHydrationController=ThinkCastProjectHydrationController.create({request:(...args)=>api(...args),isStale:isStaleNav,getActiveProjectId:()=>activeProjectId,applier:projectHydrationComposition.applier});
const projectIndexView=Step01ProjectIndexView.create({getRoot:()=>document,getCalendarEntries:()=>calendarEntries,calendarContentVersions,escapeHtml,projectDate,automationStageLabel});
const projectIndexController=Step01ProjectIndexController.create({projectsIndex:indexProjects,view:projectIndexView,getRememberedProjectId:()=>localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY),getActiveProjectId:()=>activeProjectId,setActiveProjectId,request:(...args)=>api(...args),refreshBrandLibrary,setInterval:(callback,delay)=>setInterval(callback,delay),clearInterval:id=>clearInterval(id),onPollError:error=>console.error('[ProjectIndex:poll]',error)});
projectIndexController.startPolling();
const authUIController=ThinkCastAuthUIController.create({getRoot:()=>document,request:(...args)=>api(...args),setDemoState:state=>{demoData.state=state},refreshProjectIndex,showStep,setActiveProjectId,setKeywordStageLocked});
authUIController.mount(document);
const shellNavigationController=ThinkCastShellNavigationController.create({contentRoute:ThinkCastContentRoute,getLocation:()=>location,getHistory:()=>history,getWindow:()=>window,isLoggedIn:()=>authUIController.isLoggedIn(),getActiveProjectId:()=>activeProjectId,setActiveProjectId,getProjects:()=>indexProjects,refreshProjectIndex,loadProjectState,loadProjectContent,openIndexProject,updateContentUuidLabels,getPreviewVideo:()=>typeof video!=='undefined'&&video?video:document.querySelector('#video'),scrollTo:options=>window.scrollTo(options),renderStoryboardGrid,connectStoryboardAssetsToEditor,setContentIndexError,onError:(feature,error)=>console.error(`[ShellNavigation:${feature}]`,error)});
shellNavigationController.mount(document);
const sessionBootstrapController=ThinkCastSessionBootstrapController.create({request:(...args)=>api(...args),navigation:shellNavigationController,setLoginAccess,refreshProjectIndex,hydrateCalendarEntries,getActiveProjectId:()=>activeProjectId,openIndexProject,loadProjectState,loadProjectContent,setContentIndexError});
const contentIndexView=Step01ContentIndexView.create({escapeHtml,projectCreatedDate});
const contentIndexController=Step01ContentIndexController.create({view:contentIndexView,request:(...args)=>api(...args),getProjects:()=>indexProjects,getActiveProjectId:()=>activeProjectId,beginNav,setActiveProjectId,showStep,showBrandLibrary,navigateProjectStep,resetProjectScopedState,setKeywordStageLocked,setVoiceProfile,getKeywords:()=>demoData.keywords,setVisibleKeywordIds:ids=>{visibleKeywordIds=ids},renderKeywords,refreshProjectIndex,confirm:message=>confirm(message),alert:message=>alert(message)});
contentIndexController.mount(document);
const scriptGenerationController=Step02ScriptGenerationController.create({getRoot:()=>document,configureWorkflowModal,request:(...args)=>api(...args),getActiveProjectId:()=>activeProjectId,getSelectedKeywordLabels:selectedKeywordLabels,now:()=>Date.now(),setInterval:(callback,delay)=>setInterval(callback,delay),clearInterval:id=>clearInterval(id),sleep,setGeneratedState:state=>{demoData.state=state},setGeneratedTimeline:timeline=>{demoData.timeline=timeline},setGeneratedDocument:value=>{activeStoryboardDocument=value},setKeywordLocked:setKeywordStageLocked,setVoiceProfile,applyTimeline,removeStoredScript:()=>localStorage.removeItem(SCRIPT_STORAGE_KEY),fillScript,applyScript,refreshProjectIndex,showStep});
scriptGenerationController.mount(document);
const storyboardLookController=Step03StoryboardLookController.create({getRoot:()=>document,storage:localStorage,getActiveProjectId:()=>activeProjectId,setCurrentLook:value=>{storyboardLook=value}});
const storyboardGridRenderer=Step03StoryboardGridRenderer.create({getRoot:()=>document,restoreStoryboardLook,getStoryboardDocument:()=>activeStoryboardDocument,getCurrentScriptLines:()=>currentScriptPayload().lines,getImages:()=>storedStoryboardImages,getImageCandidates:()=>storedStoryboardImageCandidates,getVoiceContext:sceneVoiceContext,getVideos:()=>storedStoryboardVideos,getVideoCandidates:()=>storedStoryboardVideoCandidates,escapeHtml,updateVoiceControls:updateStoryboardVoiceControls,resumePendingVideos:resumePendingSceneVideos});
const storyboardFlowController=Step03StoryboardFlowController.create({getRoot:()=>document,renderStoryboardGrid,showStep,updateScriptDiff,saveScriptChanges,connectStoryboardAssetsToEditor,applyStoryboardLook});
storyboardFlowController.mount(document);
const imageRegenerationController=Step04ImageRegenerationController.create({getRoot:()=>document,request:(...args)=>api(...args),sleep,now:()=>Date.now(),getActiveProjectId:()=>activeProjectId,getScenes:()=>scenes,getCurrentScene:()=>currentScene,getImageCandidates:()=>storedStoryboardImageCandidates,getRegenerationRequests:()=>demoData?.state?.image_regeneration_requests||[],setDemoState:state=>{demoData.state=state},getMainVideo:()=>document.querySelector('#video'),getBody:()=>document.body,onError:(feature,error)=>console.error(`[ImageRegeneration:${feature}]`,error)});
const voiceProfileController=Step03VoiceProfileController.create({getRoot:()=>document,request:(...args)=>api(...args),fetch:(...args)=>fetch(...args),createObjectURL:blob=>URL.createObjectURL(blob),revokeObjectURL:url=>URL.revokeObjectURL(url),getActiveProjectId:()=>activeProjectId,getSelectedProfile:()=>selectedVoiceProfile,setSelectedProfile:value=>{selectedVoiceProfile=value},onError:(feature,error)=>console.error(`[VoiceProfile:${feature}]`,error)});
voiceProfileController.mount(document);
const sceneVoicePlaybackController=Step03SceneVoicePlaybackController.create({getRoot:()=>document});
sceneVoicePlaybackController.mount(document);
const sceneVoiceController=Step03SceneVoiceController.create({getRoot:()=>document,request:(...args)=>api(...args),getActiveProjectId:()=>activeProjectId,getStoryboardDocument:()=>activeStoryboardDocument,getVoiceClips:()=>storedStoryboardVoiceClips,getSelectedVoiceProfile:()=>selectedVoiceProfile,setDemoTimeline:timeline=>{demoData.timeline=timeline},applyTimeline,onError:(feature,error)=>console.error(`[SceneVoice:${feature}]`,error),playback:sceneVoicePlaybackController});
sceneVoiceController.mount(document);
const candidateSelectionController=Step03CandidateSelectionController.create({getRoot:()=>document,request:(...args)=>api(...args),getActiveProjectId:()=>activeProjectId,getImages:()=>storedStoryboardImages,getImageCandidates:()=>storedStoryboardImageCandidates,getVideos:()=>storedStoryboardVideos,getVideoCandidates:()=>storedStoryboardVideoCandidates,renderStoryboardGrid,escapeSelector:value=>CSS.escape(value),onError:(feature,error)=>console.error(`[CandidateSelection:${feature}]`,error)});
candidateSelectionController.mount(document);
const sceneImageController=Step03SceneImageController.create({getRoot:()=>document,request:(...args)=>api(...args),sleep,getActiveProjectId:()=>activeProjectId,getImages:()=>storedStoryboardImages,getImageCandidates:()=>storedStoryboardImageCandidates,getVideos:()=>storedStoryboardVideos,escapeHtml,onError:(feature,error)=>console.error(`[SceneImage:${feature}]`,error)});
sceneImageController.mount(document);
const sceneVideoController=Step03SceneVideoController.create({getRoot:()=>document,request:(...args)=>api(...args),sleep,getActiveProjectId:()=>activeProjectId,getImages:()=>storedStoryboardImages,getVideos:()=>storedStoryboardVideos,getVideoCandidates:()=>storedStoryboardVideoCandidates,renderStoryboardGrid,escapeSelector:value=>CSS.escape(value),onError:(feature,error)=>console.error(`[SceneVideo:${feature}]`,error)});
sceneVideoController.mount(document);
const productionWorkflowController=Step03ProductionWorkflowController.create({getRoot:()=>document,configureWorkflowModal,generateMissingSceneVideos,request:(...args)=>api(...args),getActiveProjectId:()=>activeProjectId,sleep,setupSceneProgressBadges,runDemoSceneProgress,showStep});
productionWorkflowController.mount(document);
const keywordController=Step02Keyword.create({getRoot:()=>document,getKeywords:()=>demoData.keywords,getVisibleKeywordIds:()=>visibleKeywordIds,setVisibleKeywordIds:value=>{visibleKeywordIds=value},getSelectedKeywords:()=>selectedKeywords,getActiveProjectId:()=>activeProjectId,beginNav,isStaleNav,loadProjectContent,showStep,ensureStepApiReady,request:(...args)=>api(...args),setDemoState:state=>{demoData.state=state},runAiWorkflow,random:()=>Math.random()});
keywordController.mount(document);
const trendKeywordController=Step02TrendKeywordController.create({getRoot:()=>document,request:(...args)=>api(...args),getActiveProjectId:()=>activeProjectId,isKeywordLocked:()=>keywordStageLocked,getSelectedKeywords:()=>selectedKeywords,getSeasonalKeywordIds:()=>seasonalKeywordIds,setSeasonalKeywordIds:value=>{seasonalKeywordIds=value},getVisibleKeywordIds:()=>visibleKeywordIds,setVisibleKeywordIds:value=>{visibleKeywordIds=value},getKeywords:()=>demoData.keywords,setKeywords:value=>{demoData.keywords=value},renderKeywords,showTokenUsage,escapeHtml});
trendKeywordController.mount(document);
function setAuthMode(mode){
  return authUIController.setMode(mode);
}
// Thin Adapter Bridge for Step 04 Video Editor
function sync(){return window.Step04VideoEditor?.sync();}
function seekScene(idx){return window.Step04VideoEditor?.seekScene(idx);}
function seekOutroPreview(){return window.Step04VideoEditor?.seekOutroPreview();}
function togglePlay(){return window.Step04VideoEditor?.togglePlay();}
function renderSceneList(){return window.Step04VideoEditor?.renderSceneList();}
function setPlatformPreview(p){return window.Step04VideoEditor?.setPlatformPreview(p);}
function setMusic(m){return window.Step04VideoEditor?.setMusic(m);}
function setType(t){return window.Step04VideoEditor?.setType(t);}
function restoreEditorSettings(){return window.Step04VideoEditor?.restoreEditorSettings();}

// Explicit callbacks used by the isolated Step 04 controller.
Object.assign(window,{
  api,
  ensureOutroRatioAssets,
  saveBrandSelections,
  updateCommonOutroPreview,
  updateWatermarkPreview
});
Object.defineProperty(window,'brandAssets',{configurable:true,get:()=>brandSelectionController.getAssets()});

calendarGrid.addEventListener('click',event=>{
  if(calendarDragController.consumeDidDrag())return;
  if(calendarSettingsController.consumeLongPressOpened())return;
  const sticker=event.target.closest('.calendar-sticker');
  if(sticker){calendarPreviewController.open(sticker.dataset.groupId);return}
  const day=event.target.closest('.calendar-day,.calendar-time-column');if(!day||calendarViewController.snapshot().view==='day')return;
  calendarPresentationController.selectDate(day.dataset.date);
});
calendarContentView.addEventListener('click',()=>{
  const item=calendarSettingsController.getActiveEntries().find(entry=>calendarContentVersions(entry).length);
  if(!item){calendarSettingsController.close();calendarPreviewController.openUnavailable();return}
  const version=calendarContentVersions(item).at(-1);
  showLatestExport({url:version.url,filename:version.filename||`${item.title}.mp4`});
  calendarSettingsController.close();showStep(5);
  requestAnimationFrame(()=>{latestExport.scrollIntoView({behavior:'smooth',block:'start'});latestExportList.querySelector('video')?.play().catch(()=>{})});
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!platformGuideModal.hidden)closePlatformGuide()});
const calendarStore=Step05CalendarStore.create({storage:localStorage,storageKey:CALENDAR_STORAGE_KEY,request:(...args)=>api(...args),collapseDuplicates:Step05Calendar.collapseDuplicates,uniquenessKey:Step05Calendar.uniquenessKey});
const calendarDataController=Step05CalendarDataController.create({store:calendarStore,getEntries:()=>calendarEntries,setEntries:entries=>{calendarEntries=entries},render:renderCalendar});
const latestExportController=Step05LatestExportController.create({section:latestExport,list:latestExportList,storage:localStorage,storageKey:LATEST_EXPORT_STORAGE_KEY,platformLabels:calendarPlatformLabels,platformFormats:window.VideoEditorRatioProfiles?.PLATFORM_PREVIEW_FORMATS||{},createElement:tag=>document.createElement(tag),now:()=>new Date(),onError:(feature,error)=>console.warn(`[LatestExport:${feature}]`,error)});
const calendarViewController=Step05CalendarViewController.create({storage:localStorage,storageKey:CALENDAR_UI_STORAGE_KEY,now:()=>new Date(),isDateKey:value=>/^\d{4}-\d{2}-\d{2}$/.test(value||''),dateKey:Step05Calendar.dateKey});
const calendarRenderer=Step05CalendarRenderer.create({dateKey:Step05Calendar.dateKey,groupEntries:Step05Calendar.groupCalendarEntries,statusTimestamp:Step05Calendar.calendarStatusTimestamp,formatTime:Step05Calendar.formatCalendarTime,minuteOfDay:Step05Calendar.calendarMinuteOfDay,escapeHtml,statusLabels:calendarStatusLabels,platformLabels:calendarPlatformLabels,timeLabels:calendarTimeLabels});
const calendarPresentationController=Step05CalendarPresentationController.create({grid:calendarGrid,scroller:calendarGrid.parentElement,title:calendarMonthTitle,viewButtons:[...document.querySelectorAll('.calendar-view-btn')],prevButton:document.querySelector('#calendarPrev'),nextButton:document.querySelector('#calendarNext'),viewController:calendarViewController,renderer:calendarRenderer,getEntries:()=>calendarEntries,now:()=>new Date(),requestFrame:callback=>requestAnimationFrame(callback),cancelFrame:frame=>cancelAnimationFrame(frame),getPageScroll:()=>({x:window.scrollX,y:window.scrollY}),scrollWindow:(x,y)=>window.scrollTo(x,y)});
calendarPresentationController.mount();
const calendarDragController=Step05CalendarDragController.create({grid:calendarGrid,getEntries:()=>calendarEntries,setEntries:entries=>{calendarEntries=entries},save:saveCalendarEntries,render:renderCalendar,setHelp:text=>{calendarHelp.textContent=text},contentIdentity:Step05Calendar.contentIdentity,collapseDuplicates:Step05Calendar.collapseDuplicates,nextDateKey:Step05Calendar.nextDateKey,shiftTimestampDate:Step05Calendar.shiftTimestampDate,dateKey:Step05Calendar.dateKey,setTimer:(callback,delay)=>setTimeout(callback,delay),clearTimer:timer=>clearTimeout(timer)});
calendarDragController.mount();
const calendarSettingsController=Step05CalendarSettingsController.create({grid:calendarGrid,modal:calendarSettingsModal,title:calendarSettingsTitle,dateInput:calendarSettingsDate,platforms:calendarSettingsPlatforms,cancelButton:document.querySelector('#calendarSettingsCancel'),saveButton:document.querySelector('#calendarSettingsSave'),body:document.body,keyTarget:document,getEntries:()=>calendarEntries,setEntries:entries=>{calendarEntries=entries},contentIdentity:Step05Calendar.contentIdentity,nextDateKey:Step05Calendar.nextDateKey,timeInputValue:Step05Calendar.calendarTimeInputValue,escapeHtml,statusLabels:calendarStatusLabels,platformLabels:calendarPlatformLabels,setCursor:value=>calendarViewController.setCursor(value),saveEntries:saveCalendarEntries,render:renderCalendar,setHelp:text=>{calendarHelp.textContent=text},setTimer:(callback,delay)=>setTimeout(callback,delay),clearTimer:timer=>clearTimeout(timer)});
calendarSettingsController.mount();
const calendarPreviewController=Step05CalendarPreviewController.create({previewModal:calendarPreviewModal,previewMeta:calendarPreviewMeta,video:calendarPreviewVideo,title:calendarPreviewTitle,download:calendarPreviewDownload,count:calendarPreviewVersionCount,previousButton:calendarPreviewVersionPrev,nextButton:calendarPreviewVersionNext,previewCloseButton:document.querySelector('#calendarPreviewClose'),unavailableModal:contentUnavailableModal,unavailableCloseButton:document.querySelector('#contentUnavailableClose'),body:document.body,keyTarget:document,getEntries:()=>calendarEntries,contentIdentity:Step05Calendar.contentIdentity,contentVersions:Step05Calendar.calendarContentVersions,escapeHtml,platformFormats:window.VideoEditorRatioProfiles?.PLATFORM_PREVIEW_FORMATS||{},platformLabels:calendarPlatformLabels,onError:(feature,error)=>console.warn(`[CalendarPreview:${feature}]`,error)});
calendarPreviewController.mount();
const calendarExportController=Step05CalendarExportController.create({button:document.querySelector('#calendarExport'),getEntries:()=>calendarEntries,contentIdentity:Step05Calendar.contentIdentity,collapseDuplicates:Step05Calendar.collapseDuplicates,nextDateKey:Step05Calendar.nextDateKey,dateKey:Step05Calendar.dateKey,icsEscape:Step05Calendar.icsEscape,statusLabels:calendarStatusLabels,now:()=>new Date(),createBlob:(parts,options)=>new Blob(parts,options),createObjectURL:blob=>URL.createObjectURL(blob),revokeObjectURL:url=>URL.revokeObjectURL(url),createLink:()=>document.createElement('a'),setTimer:(callback,delay)=>setTimeout(callback,delay),setHelp:text=>{calendarHelp.textContent=text}});
calendarExportController.mount();
const productionCalendarController=Step05ProductionCalendarController.create({getEntries:()=>calendarEntries,setEntries:entries=>{calendarEntries=entries},getActiveProjectId:()=>activeProjectId,getTitle:()=>document.querySelector('#projectTitle').textContent,getSelectedPlatforms:()=>new Set(selectedPlatformValues()),getPreviewPlatform:()=>currentPreviewPlatform,calendarContentVersions:Step05Calendar.calendarContentVersions,collapseDuplicates:Step05Calendar.collapseDuplicates,nextDateKey:Step05Calendar.nextDateKey,dateKey:Step05Calendar.dateKey,createId:calendarId,now:()=>new Date(),save:saveCalendarEntries,render:renderCalendar,refresh:refreshProjectIndex,onError:(feature,error)=>console.error(`[ProductionCalendar:${feature}]`,error)});
calendarPresentationController.load();
loadCalendarEntries();
loadLatestExport();
renderCalendar();
refreshApiConnections().catch(()=>{});

async function loadRenderSettingsOnce() {
  if (!window.Step04VideoEditor) return;
  if (typeof window.Step04VideoEditor.isConfigured === 'function' && window.Step04VideoEditor.isConfigured()) {
    window.Step04VideoEditor.initStep4UI();
    return;
  }
  let settings = null;
  let catalog = null;
  try {
    const apiRes = (typeof window.api === 'function') ? await window.api('/api/render-settings') : null;
    if (apiRes) {
      settings = apiRes.effective || null;
      catalog = apiRes.catalog || null;
    }
  } catch (e) {}
  window.Step04VideoEditor.configure(settings, catalog);
  window.Step04VideoEditor.initStep4UI();
}

async function ensureStep4Loaded() {
  if (document.querySelector('#step4')) {
    await loadRenderSettingsOnce();
    return true;
  }
  const container = document.querySelector('#step4Container') || document.body;
  if (!container) return false;
  let loaded = false;
  try {
    if (typeof fetch === 'function') {
      const res = await fetch('/01_app/pages/steps/step04-video.html');
      if (res.ok) {
        container.innerHTML = await res.text();
        loaded = true;
      }
    }
  } catch (e) {}
  if (!loaded && typeof require === 'function' && typeof process !== 'undefined') {
    try {
      const fs = require('fs');
      const path = require('path');
      const fp = path.resolve('01_app/pages/steps/step04-video.html');
      if (fs.existsSync(fp)) {
        container.innerHTML = fs.readFileSync(fp, 'utf8');
        loaded = true;
      }
    } catch (e) {}
  }
  if (loaded) {
    await loadRenderSettingsOnce();
    return true;
  }
  return false;
}

async function boot(){await ensureStepPartialsLoaded();await ensureStep4Loaded();await initDemo();await restoreLoginSession()}
boot();
const userSettingsController=ThinkCastUserSettingsController.create({getRoot:()=>document,request:(...args)=>api(...args),getIndexProjects:()=>indexProjects,refreshProjectIndex,confirm:message=>window.confirm(message),fetch:(...args)=>fetch(...args),createObjectURL:blob=>URL.createObjectURL(blob),revokeObjectURL:url=>URL.revokeObjectURL(url),createRequestId:()=>crypto.randomUUID(),setInterval:(callback,delay)=>setInterval(callback,delay),clearInterval:timer=>clearInterval(timer),onError:(feature,error)=>console.warn(`[UserSettings:${feature}]`,error),authUI:authUIController,storage:localStorage});
userSettingsController.mount();
})().catch(error=>{
  console.error(error);
  const container=document.querySelector('#step01LoginContainer');
  if(container&&!container.textContent)container.textContent='단계 화면을 불러오지 못했습니다. 새로고침해 주세요.';
});
