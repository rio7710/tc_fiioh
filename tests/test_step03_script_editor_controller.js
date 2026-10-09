const assert = require('node:assert/strict');
const Editor = require('../01_app/assets/steps/step03/step03-script-editor-controller.js');

(async () => {
  function element() {
    const listeners = new Map();
    return {textContent:'',innerHTML:'',hidden:false,disabled:false,value:'',
      addEventListener(type,fn){const list=listeners.get(type)||[];list.push(fn);listeners.set(type,list)},
      removeEventListener(type,fn){listeners.set(type,(listeners.get(type)||[]).filter(item=>item!==fn))},
      listenerCount:type=>(listeners.get(type)||[]).length,
      dispatch(type){return (listeners.get(type)||[]).map(fn=>fn({target:this}))}
    };
  }
  function row(value='') {
    const input={value};const old={hidden:false,textContent:''};const classes=new Set();
    return {input,old,classes,classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name)}},querySelector(selector){return selector==='input'?input:old}};
  }
  function harness(overrides={}) {
    const ids=['scriptHeadline','scriptConcept','scriptLines','scriptSaveBar','scriptDiffSummary','scriptSaveBtn','scriptMessage'];
    const nodes=Object.fromEntries(ids.map(id=>[id,element()]));
    const rows=overrides.rows||[];const inputs=overrides.inputs||rows.map(item=>item.input);
    const root={querySelector:selector=>nodes[selector.slice(1)]||null,querySelectorAll:selector=>selector==='#scriptLines input'?inputs:selector==='#scriptLines .script-row'?rows:[]};
    const calls=[];const storageData=new Map();
    const storage=overrides.storage||{getItem:key=>{if(overrides.getError)throw overrides.getError;return storageData.get(key)||null},setItem:(key,value)=>{if(overrides.setError)throw overrides.setError;storageData.set(key,value)}};
    const result=overrides.result||{timeline:{scenes:[{id:'new'}]},document:{id:'doc-new'},state:{script:{headline:'saved',concept:'saved concept',lines:['saved line']}}};
    let activeDocument=overrides.activeDocument||{id:'doc-old'};
    const record=name=>value=>{calls.push([name,value]);if(overrides.throwAt===name)throw new Error(`failed ${name}`)};
    const deps={getRoot:()=>root,storage,storageKey:'greenhill-script-saved-v1',request:async(...args)=>{calls.push(['request',...args]);if(overrides.requestError)throw overrides.requestError;return result},getScenes:()=>overrides.scenes||[],escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;'),getActiveProjectId:()=> 'project-a',setDemoTimeline:record('timeline'),applyTimeline:record('applyTimeline'),getActiveStoryboardDocument:()=>activeDocument,setActiveStoryboardDocument:value=>{calls.push(['document',value]);activeDocument=value},setDemoState:record('state'),applyScript:record('applyScript'),refreshProjectIndex:async()=>{calls.push(['refresh']);if(overrides.refreshError)throw overrides.refreshError}};
    return {controller:Editor.create(deps),nodes,rows,inputs,root,calls,result,storageData,getDocument:()=>activeDocument};
  }

  assert.throws(()=>Editor.create(),/requires getRoot/);
  const required={getRoot(){},storage:{getItem(){},setItem(){}},storageKey:'key',request(){},getScenes(){},escapeHtml(){},getActiveProjectId(){},setDemoTimeline(){},applyTimeline(){},getActiveStoryboardDocument(){},setActiveStoryboardDocument(){},setDemoState(){},applyScript(){},refreshProjectIndex(){}};
  for(const name of Object.keys(required)){const deps={...required};delete deps[name];assert.throws(()=>Editor.create(deps),new RegExp(`requires ${name}`));}
  let h=harness();assert.equal(Object.isFrozen(h.controller),true);h.controller.mount(h.root);assert.equal(h.controller.mount(h.root),true);assert.equal(h.nodes.scriptLines.listenerCount('input'),1);assert.equal(h.nodes.scriptSaveBtn.listenerCount('click'),1);

  const rows=[row(' <first> '),row('second')];
  h=harness({rows,scenes:[{name:'legacy',script_line_index:0,cueStart:0,cueEnd:9},{name:'<scene>',scriptLineIndex:1,cueStart:5,cueEnd:3}]});
  assert.equal(h.controller.fill({headline:'Head',concept:'Concept',lines:[' <first> ','second']}),undefined);
  assert.equal(h.nodes.scriptHeadline.textContent,'Head');assert.equal(h.nodes.scriptConcept.textContent,'Concept');
  assert.match(h.nodes.scriptLines.innerHTML,/S#00/,'snake_case-only scene is not matched');assert.match(h.nodes.scriptLines.innerHTML,/#0\.0s/);assert.match(h.nodes.scriptLines.innerHTML,/S#02/);assert.match(h.nodes.scriptLines.innerHTML,/title="&lt;scene&gt;"/);assert.match(h.nodes.scriptLines.innerHTML,/value=" &lt;first&gt; "/);
  assert.equal(h.nodes.scriptSaveBar.hidden,true);assert.equal(h.nodes.scriptDiffSummary.textContent,'수정된 문장 0개 · 아직 저장되지 않았습니다.');
  rows[1].input.value=' changed ';assert.equal(h.controller.updateDiff(),1);assert.equal(rows[1].classes.has('changed'),true);assert.equal(rows[1].old.hidden,false);assert.equal(rows[1].old.textContent,'수정 전 · second');assert.equal(h.nodes.scriptSaveBar.hidden,false);
  h.nodes.scriptHeadline.textContent=' Head ';h.nodes.scriptConcept.textContent=' Concept ';assert.deepEqual(h.controller.payload(),{headline:' Head ',concept:' Concept ',lines:['<first>','changed']});

  h=harness();assert.equal(h.controller.loadSaved(),null);h.storageData.set('greenhill-script-saved-v1',JSON.stringify({headline:'saved',lines:['a']}));assert.deepEqual(h.controller.loadSaved(),{headline:'saved',lines:['a']});h.storageData.set('greenhill-script-saved-v1','bad');assert.equal(h.controller.loadSaved(),null);
  assert.equal(harness({getError:new Error('blocked')}).controller.loadSaved(),null);
  h=harness();assert.equal(h.controller.saveLocal({lines:['a']}),undefined);assert.equal(h.storageData.get('greenhill-script-saved-v1'),JSON.stringify({lines:['a']}));assert.equal(harness({setError:new Error('full')}).controller.saveLocal({lines:['a']}),undefined);

  h=harness({rows:[row('saved line')],inputs:[{value:' draft line '}],scenes:[{scriptLineIndex:0,cueStart:0,cueEnd:2}]});h.nodes.scriptHeadline.textContent='headline';h.nodes.scriptConcept.textContent='concept';
  const saved=await h.controller.save();assert.equal(saved,h.result.state.script);assert.deepEqual(h.calls.map(call=>call[0]),['request','timeline','applyTimeline','document','state','applyScript','refresh']);assert.deepEqual(h.calls[0],['request','/api/script/save',{method:'POST',body:JSON.stringify({project_id:'project-a',headline:'headline',concept:'concept',lines:['draft line']})}]);assert.equal(h.getDocument(),h.result.document);assert.equal(h.nodes.scriptMessage.textContent,'수정한 대본을 저장했습니다.');assert.equal(h.nodes.scriptSaveBtn.disabled,false);assert.equal(h.nodes.scriptSaveBtn.textContent,'수정 내용 저장');assert.equal(h.storageData.get('greenhill-script-saved-v1'),JSON.stringify(h.result.state.script));

  h=harness({result:{document:null,state:{script:{lines:[]}}},activeDocument:{id:'keep'}});await h.controller.save();assert.deepEqual(h.getDocument(),{id:'keep'});assert.equal(h.calls.some(call=>call[0]==='timeline'),false);
  h=harness({requestError:new Error('save failed')});await assert.rejects(h.controller.save(),/save failed/);assert.deepEqual(h.calls.map(call=>call[0]),['request']);assert.equal(h.nodes.scriptSaveBtn.disabled,false);assert.equal(h.nodes.scriptSaveBtn.textContent,'수정 내용 저장');
  h=harness({refreshError:new Error('refresh failed'),rows:[row('saved line')]});await assert.rejects(h.controller.save(),/refresh failed/);assert.equal(h.calls.some(call=>call[0]==='state'),true);assert.equal(h.calls.some(call=>call[0]==='applyScript'),true);assert.notEqual(h.storageData.get('greenhill-script-saved-v1'),undefined);assert.notEqual(h.nodes.scriptMessage.textContent,'수정한 대본을 저장했습니다.');assert.equal(h.nodes.scriptSaveBtn.disabled,false);

  h=harness({requestError:new Error('click failed')});h.controller.mount(h.root);h.nodes.scriptMessage.textContent='old';await Promise.all(h.nodes.scriptSaveBtn.dispatch('click'));assert.equal(h.nodes.scriptMessage.textContent,'click failed');h.nodes.scriptMessage.textContent='old';h.nodes.scriptLines.dispatch('input');assert.equal(h.nodes.scriptMessage.textContent,'');
  h.controller.unmount();assert.equal(h.nodes.scriptLines.listenerCount('input'),0);assert.equal(h.nodes.scriptSaveBtn.listenerCount('click'),0);assert.equal(h.controller.unmount(),undefined);h.controller.mount(h.root);assert.equal(h.nodes.scriptLines.listenerCount('input'),1);
  const broken=harness();delete broken.nodes.scriptConcept;assert.throws(()=>broken.controller.mount(broken.root),/missing #scriptConcept/);broken.nodes.scriptConcept=element();assert.equal(broken.controller.mount(broken.root),true);

  console.log('Step 3 script editor controller tests passed');
})().catch(error=>{console.error(error);process.exitCode=1});
