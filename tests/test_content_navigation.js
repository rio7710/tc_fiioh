const assert = require('node:assert/strict');
const Route = require('../01_app/assets/core/content-route.js');
const Navigation = require('../01_app/assets/core/shell-navigation-controller.js');

function browser(url) {
  let current = new URL(url); const entries = [current.href]; let position = 0;
  const views = ['stepIndex','stepProject','step1','step2','step3','step31','step4','step5'].map(id => ({id, hidden:true}));
  const messages = {}, projects = {A:{}, B:{}}; let active = null, loadProjectState = async () => ({content:true});
  const topNav = {setActive(){},addEventListener(){},removeEventListener(){}};
  const root = {querySelectorAll:()=>views,querySelector(selector){if(selector==='thinkcast-top-nav')return topNav;return messages[selector] ||= {textContent:'',hidden:true}},addEventListener(){},removeEventListener(){}};
  const location={};Object.defineProperty(location,'href',{get:()=>current.href});
  const history={pushState(_s,_t,href){current=new URL(href);entries.splice(++position);entries.push(current.href)},replaceState(_s,_t,href){current=new URL(href);entries[position]=current.href}};
  let controller;
  const deps={contentRoute:Route,getLocation:()=>location,getHistory:()=>history,getWindow:()=>({addEventListener(){},removeEventListener(){}}),isLoggedIn:()=>true,getActiveProjectId:()=>active,setActiveProjectId:id=>{active=id},getProjects:()=>projects,refreshProjectIndex:async()=>{},loadProjectState:(...args)=>loadProjectState(...args),loadProjectContent:async()=>({}),openIndexProject:(id,mode='push')=>{if(!projects[id])return;controller.begin();active=id;controller.showStep('project',mode)},updateContentUuidLabels(){},getPreviewVideo:()=>({pause(){}}),scrollTo(){},renderStoryboardGrid(){},connectStoryboardAssetsToEditor(){},setContentIndexError(_key,message){(messages['#contentIndexMessage'] ||= {}).textContent=message},onError(){}};
  controller=Navigation.create(deps);controller.mount(root);
  return {controller,entries,views,messages,setUrl:href=>{current=new URL(href)},url:()=>current,active:()=>active,open:(id,mode='push')=>deps.openIndexProject(id,mode),setStateLoader:fn=>{loadProjectState=fn},travel:async delta=>{position+=delta;current=new URL(entries[position]);await controller.restoreRoute()}};
}

(async()=>{
  const b=browser('https://tc.test/app.html?project_id=A#step3-1');await b.controller.restoreRoute();
  assert.equal(b.active(),'A','URL ID must override remembered ID');assert.equal(b.views.find(v=>!v.hidden).id,'step31');assert.equal(b.entries.length,1,'restore must replace history');
  b.open('B');await b.controller.navigate('4');assert.equal(b.url().searchParams.get('project_id'),'B');assert.equal(b.url().hash,'#step4');
  const count=b.entries.length;await b.travel(-1);assert.equal(b.views.find(v=>!v.hidden).id,'stepProject');await b.travel(-1);assert.equal(b.active(),'A');assert.equal(b.views.find(v=>!v.hidden).id,'step31');await b.travel(1);await b.travel(1);assert.equal(b.views.find(v=>!v.hidden).id,'step4');assert.equal(b.entries.length,count,'history traversal must not append entries');
  const reload=browser(b.url().href);await reload.controller.restoreRoute();assert.equal(reload.active(),'B');assert.equal(reload.views.find(v=>!v.hidden).id,'step4');
  b.setUrl('https://tc.test/app.html?project_id=missing#step4');await b.controller.restoreRoute();assert.equal(b.active(),null);assert.equal(b.views.find(v=>!v.hidden).id,'stepIndex');assert.match(b.messages['#contentIndexMessage'].textContent,/찾을 수 없습니다/);assert.equal(b.url().searchParams.has('project_id'),false);
  const legacy=browser('https://tc.test/app.html#step3-1');legacy.open('A','replace');legacy.setUrl('https://tc.test/app.html#step3-1');await legacy.controller.restoreRoute();assert.equal(legacy.views.find(v=>!v.hidden).id,'step31');assert.equal(legacy.url().searchParams.get('project_id'),'A');
  const race=browser('https://tc.test/app.html?project_id=A#index');let release;race.setStateLoader(id=>id==='A'?new Promise(resolve=>release=resolve):Promise.resolve({content:true}));await race.controller.restoreRoute();const pending=race.controller.navigate('3-1');race.open('B');await race.controller.navigate('4');release({content:true});await pending;assert.equal(race.url().hash,'#step4');assert.equal(race.url().searchParams.get('project_id'),'B');
  console.log('PASS: route identity, legacy URLs, reload, back/forward, invalid ID, stale navigation');
})().catch(error=>{console.error(error);process.exitCode=1});
