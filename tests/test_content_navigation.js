const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('01_app/P1_title_design_preview.html', 'utf8');
const block = html.slice(html.indexOf('function readContentRoute()'), html.indexOf("let selectedVoiceProfile="));

function browser(url) {
  let current = new URL(url);
  const entries = [current.href];
  let position = 0;
  const storage = new Map();
  const views = ['stepIndex','stepProject','step1','step2','step3','step31','step4','step5'].map(id => ({id, hidden:true}));
  const messages = {};
  const context = vm.createContext({
    URL, console, isLoggedIn:true, video:{pause(){}}, updateContentUuidLabels(){},
    document:{
      querySelectorAll(){return views;},
      querySelector(selector){
        if(selector==='thinkcast-top-nav')return {setActive(){}};
        return messages[selector] ||= {textContent:'',hidden:true};
      }
    },
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    window:{scrollTo(){},addEventListener(){}},
    history:{
      pushState(_s,_t,href){current=new URL(href);entries.splice(++position);entries.push(current.href);},
      replaceState(_s,_t,href){current=new URL(href);entries[position]=current.href;}
    },
    refreshProjectIndex:async()=>{},
    loadProjectState:async()=>({content:true}),loadProjectContent:async()=>({}),
    renderStoryboardGrid(){},connectStoryboardAssetsToEditor(){}
  });
  Object.defineProperty(context,'location',{get:()=>current});
  vm.runInContext(block,context);
  vm.runInContext("indexProjects.A={};indexProjects.B={};function openIndexProject(id,mode='push'){beginNav();activeProjectId=id;localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY,id);showStep('project',mode)}",context);
  return {
    context,entries,views,messages,storage,
    run:code=>vm.runInContext(code,context),
    setUrl:href=>{current=new URL(href);},
    url:()=>current,
    travel:async delta=>{position+=delta;current=new URL(entries[position]);await context.restoreContentRoute();}
  };
}
(async()=>{
  const b=browser('https://tc.test/app.html?project_id=A#step3-1');
  b.storage.set('thinkcast-active-project-v1','B');
  await b.context.restoreContentRoute();
  assert.equal(b.run('activeProjectId'),'A','URL ID must override remembered ID');
  assert.equal(b.views.find(v=>!v.hidden).id,'step31');
  assert.equal(b.entries.length,1,'restore must replace history');
  b.run("openIndexProject('B')");
  await b.context.navigateProjectStep('4');
  assert.equal(b.url().searchParams.get('project_id'),'B');
  assert.equal(b.url().hash,'#step4');
  const count=b.entries.length;
  await b.travel(-1);
  assert.equal(b.views.find(v=>!v.hidden).id,'stepProject');
  await b.travel(-1);
  assert.equal(b.run('activeProjectId'),'A');
  assert.equal(b.views.find(v=>!v.hidden).id,'step31');
  await b.travel(1);await b.travel(1);
  assert.equal(b.views.find(v=>!v.hidden).id,'step4');
  assert.equal(b.entries.length,count,'history traversal must not append entries');
  const reload=browser(b.url().href);
  await reload.context.restoreContentRoute();
  assert.equal(reload.run('activeProjectId'),'B');
  assert.equal(reload.views.find(v=>!v.hidden).id,'step4');
  b.setUrl('https://tc.test/app.html?project_id=missing#step4');
  await b.context.restoreContentRoute();
  assert.equal(b.run('activeProjectId'),null);
  assert.equal(b.views.find(v=>!v.hidden).id,'stepIndex');
  assert.match(b.messages['#contentIndexMessage'].textContent,/찾을 수 없습니다/);
  assert.equal(b.url().searchParams.has('project_id'),false);
  const legacy=browser('https://tc.test/app.html#step3-1');
  legacy.run("activeProjectId='A'");await legacy.context.restoreContentRoute();
  assert.equal(legacy.views.find(v=>!v.hidden).id,'step31');
  assert.equal(legacy.url().searchParams.get('project_id'),'A');
  // A navigation suspended on state must not overwrite B's later URL/view.
  const race=browser('https://tc.test/app.html?project_id=A#index');
  let release;
  race.context.loadProjectState=id=>id==='A'?new Promise(resolve=>release=resolve):Promise.resolve({content:true});
  const old=race.context.restoreContentRoute();await old;
  const pending=race.context.navigateProjectStep('3-1');
  race.run("openIndexProject('B')");await race.context.navigateProjectStep('4');
  release({content:true});await pending;
  assert.equal(race.url().hash,'#step4');assert.equal(race.url().searchParams.get('project_id'),'B');
  console.log('PASS: route identity, legacy URLs, reload, back/forward, invalid ID, stale navigation');
})().catch(error=>{console.error(error);process.exitCode=1;});
