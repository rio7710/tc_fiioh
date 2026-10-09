const assert = require('node:assert/strict');
const ProviderSettings = require('../01_app/assets/core/provider-settings-controller.js');

(async () => {
  function node() {
    const listeners = new Map();
    const classes = new Set();
    return {
      hidden: false, disabled: false, textContent: '', title: '', innerHTML: '', value: '', dataset: {},
      classList: {add:name=>classes.add(name), remove:name=>classes.delete(name), toggle:(name,on)=>on?classes.add(name):classes.delete(name), contains:name=>classes.has(name)},
      addEventListener(type, fn) { const list=listeners.get(type)||[];list.push(fn);listeners.set(type,list); },
      removeEventListener(type, fn) { listeners.set(type,(listeners.get(type)||[]).filter(item=>item!==fn)); },
      dispatch(type, target=this) { const event={target,currentTarget:this,prevented:false,preventDefault(){this.prevented=true}};return {event,results:(listeners.get(type)||[]).map(fn=>fn(event))}; },
      listenerCount:type=>(listeners.get(type)||[]).length,
      querySelectorAll:()=>[], querySelector:()=>null,
      resetCount:0, reset(){this.resetCount+=1;}
    };
  }

  const baseConfig = () => ({
    hosted:false,
    providers:{openai:{label:'Open & AI',docs:'https://example.test/openai',fields:[{id:'key',label:'API <Key>',env:'OPENAI_KEY',secret:true}]},kling:{label:'Kling',docs:'https://example.test/kling',fields:[{id:'access',label:'Access',env:'KLING_ACCESS',secret:false},{id:'secret',label:'Secret',env:'KLING_SECRET',secret:true}]}},
    statuses:{openai:{configured:true,source:'environment'},kling:{configured:false,source:null}},
    steps:{'2':['openai'],'3':['openai'],'4':['kling']}
  });

  function harness(overrides={}) {
    const ids=['globalApiSettings','apiSettingsModal','apiSettingsForm','apiSettingsClose','apiSettingsTitle','apiSettingsDescription','apiSettingsProviders','apiSettingsMessage','apiSettingsSave'];
    const nodes=Object.fromEntries(ids.map(id=>[id,node()]));
    const bodyClasses=new Set();
    const calls=[];const timers=[];
    let cards=[];
    const root={body:{classList:{add:name=>bodyClasses.add(name),remove:name=>bodyClasses.delete(name)}},querySelector:selector=>nodes[selector.slice(1)]||null,querySelectorAll:selector=>selector==='[data-provider-card]'?cards:[]};
    const deps={
      getRoot:()=>root,
      request:async(...args)=>{calls.push(args);if(overrides.request) return overrides.request(...args);return baseConfig();},
      escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;'),
      setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;}
    };
    return {controller:ProviderSettings.create(deps),nodes,root,bodyClasses,calls,timers,setCards:value=>{cards=value}};
  }

  const valid={getRoot(){},request(){},escapeHtml(){},setTimeout(){}};
  assert.throws(()=>ProviderSettings.create(),/requires getRoot/);
  for(const name of Object.keys(valid)){const deps={...valid};delete deps[name];assert.throws(()=>ProviderSettings.create(deps),new RegExp(`requires ${name}`));}

  let h=harness();
  assert.equal(Object.isFrozen(h.controller),true);
  assert.equal(h.controller.getConfig(),null);assert.equal(h.controller.getActiveStep(),1);
  assert.equal(h.controller.mount(h.root),true);assert.equal(h.controller.mount(h.root),true);
  assert.equal(h.nodes.globalApiSettings.listenerCount('click'),1);assert.equal(h.nodes.apiSettingsForm.listenerCount('submit'),1);
  h.controller.unmount();assert.equal(h.nodes.globalApiSettings.listenerCount('click'),0);assert.equal(h.controller.unmount(),undefined);
  h.controller.mount(h.root);assert.equal(h.nodes.globalApiSettings.listenerCount('click'),1);
  const broken=harness();delete broken.nodes.apiSettingsMessage;assert.throws(()=>broken.controller.mount(broken.root),/missing #apiSettingsMessage/);broken.nodes.apiSettingsMessage=node();assert.equal(broken.controller.mount(broken.root),true);

  h=harness();h.controller.mount(h.root);
  const config=await h.controller.refresh();assert.equal(config,h.controller.getConfig());assert.deepEqual(h.calls,[['/api/provider-settings']]);
  assert.equal(h.nodes.globalApiSettings.textContent,'API 연결 설정 · 1/2');assert.equal(h.nodes.globalApiSettings.title,'전역 공급자 2개 중 1개 연결됨');
  assert.equal(h.nodes.globalApiSettings.classList.contains('ready'),false);assert.equal(h.nodes.globalApiSettings.classList.contains('needs-config'),true);

  const readyConfig=baseConfig();readyConfig.statuses.kling={configured:true,source:'session'};
  h=harness({request:async()=>readyConfig});h.controller.mount(h.root);await h.controller.refresh();assert.equal(h.nodes.globalApiSettings.classList.contains('ready'),true);assert.equal(h.nodes.globalApiSettings.textContent,'API 연결 설정 · 2/2');

  h=harness();h.controller.mount(h.root);assert.equal(await h.controller.open(0),undefined);assert.equal(h.controller.getActiveStep(),1);
  assert.equal(h.nodes.apiSettingsTitle.textContent,'STEP 01 · 로그인 및 프로젝트');assert.equal(h.nodes.apiSettingsModal.hidden,false);assert.equal(h.bodyClasses.has('modal-open'),true);
  assert.match(h.nodes.apiSettingsProviders.innerHTML,/Open &amp; AI/);assert.match(h.nodes.apiSettingsProviders.innerHTML,/API &lt;Key>/);assert.match(h.nodes.apiSettingsProviders.innerHTML,/환경변수/);assert.match(h.nodes.apiSettingsProviders.innerHTML,/type="password"/);assert.equal(h.nodes.apiSettingsSave.hidden,false);
  h.controller.close();assert.equal(h.nodes.apiSettingsModal.hidden,true);assert.equal(h.bodyClasses.has('modal-open'),false);assert.equal(h.nodes.apiSettingsForm.resetCount,1);

  h=harness({request:async()=>{throw new Error('network down')}});h.controller.mount(h.root);await h.controller.open(2);
  assert.equal(h.controller.getConfig(),null);assert.equal(h.nodes.apiSettingsMessage.textContent,'network down');assert.match(h.nodes.apiSettingsProviders.innerHTML,/별도 API 키 없음/);assert.equal(h.nodes.apiSettingsSave.hidden,true);assert.equal(h.nodes.apiSettingsModal.hidden,false);

  const hosted=baseConfig();hosted.hosted=true;
  h=harness({request:async()=>hosted});h.controller.mount(h.root);await h.controller.open(4);assert.match(h.nodes.apiSettingsProviders.innerHTML,/disabled/);assert.equal(h.nodes.apiSettingsSave.hidden,true);assert.match(h.nodes.apiSettingsMessage.textContent,/공개 사이트에서는 키 노출 방지/);assert.match(h.nodes.apiSettingsProviders.innerHTML,/required-now/);

  h=harness();h.controller.mount(h.root);assert.equal(await h.controller.ensureStepReady(2),true);assert.equal(h.calls.length,1);
  assert.equal(await h.controller.ensureStepReady(4),false);assert.equal(h.calls.length,3);assert.equal(h.controller.getActiveStep(),4);
  const noRequirements=baseConfig();noRequirements.steps['5']=[];h=harness({request:async()=>noRequirements});h.controller.mount(h.root);assert.equal(await h.controller.ensureStepReady(5),true);
  h=harness({request:async()=>{throw new Error('refresh failed')}});h.controller.mount(h.root);await assert.rejects(()=>h.controller.ensureStepReady(2),/refresh failed/);

  function input(field,value){const item=node();item.dataset.field=field;item.value=value;return item;}
  function card(provider,label,inputs){const item=node(),strong=node();item.dataset.providerCard=provider;strong.textContent=label;item.querySelectorAll=selector=>selector==='[data-field]'?inputs:[];item.querySelector=selector=>selector==='strong'?strong:null;return item;}
  h=harness();h.controller.mount(h.root);h.setCards([card('openai','OpenAI',[input('key','   ')])]);await h.controller.save();assert.match(h.nodes.apiSettingsMessage.textContent,/연결할 공급자/);assert.equal(h.nodes.apiSettingsSave.disabled,false);assert.equal(h.calls.length,0);
  h=harness();h.controller.mount(h.root);h.setCards([card('kling','Kling',[input('access',' value '),input('secret','')])]);await h.controller.save();assert.equal(h.nodes.apiSettingsMessage.textContent,'Kling: 필수 인증값을 모두 입력해 주세요.');assert.equal(h.calls.length,0);

  const first=input('key',' one '), secondA=input('access',' two '), secondB=input('secret',' three ');
  let gets=0;
  h=harness({request:async(path,options)=>{if(options)return {message:options.body.includes('openai')?'OpenAI saved':'Kling saved'};gets+=1;return readyConfig;}});h.controller.mount(h.root);h.setCards([card('openai','OpenAI',[first]),card('kling','Kling',[secondA,secondB])]);await h.controller.save();
  assert.deepEqual(h.calls.slice(0,2),[['/api/provider-settings',{method:'POST',body:JSON.stringify({provider:'openai',credentials:{key:'one'}})}],['/api/provider-settings',{method:'POST',body:JSON.stringify({provider:'kling',credentials:{access:'two',secret:'three'}})}]]);
  assert.equal(first.value,'');assert.equal(secondA.value,'');assert.equal(secondB.value,'');assert.equal(gets,1);assert.equal(h.nodes.apiSettingsMessage.textContent,'Kling saved');assert.equal(h.nodes.apiSettingsMessage.classList.contains('success'),true);assert.equal(h.timers[0].delay,700);
  await h.controller.open(2); // active step changes before delayed callback
  await h.timers[0].fn();assert.equal(h.controller.getActiveStep(),2);

  const succeeded=input('key','ok'), failed=input('key','keep');let postCount=0;
  h=harness({request:async(path,options)=>{if(options&&++postCount===1)return {message:'saved'};throw new Error('second failed');}});h.controller.mount(h.root);h.setCards([card('a','A',[succeeded]),card('b','B',[failed])]);await h.controller.save();assert.equal(succeeded.value,'');assert.equal(failed.value,'keep');assert.equal(h.nodes.apiSettingsMessage.textContent,'second failed');assert.equal(h.nodes.apiSettingsSave.disabled,false);

  h=harness();h.controller.mount(h.root);const click=h.nodes.globalApiSettings.dispatch('click');await Promise.all(click.results);assert.equal(h.controller.getActiveStep(),1);
  h.nodes.apiSettingsModal.hidden=false;h.nodes.apiSettingsModal.dispatch('pointerdown',h.nodes.apiSettingsMessage);assert.equal(h.nodes.apiSettingsModal.hidden,false);h.nodes.apiSettingsModal.dispatch('pointerdown',h.nodes.apiSettingsModal);assert.equal(h.nodes.apiSettingsModal.hidden,true);
  const submit=h.nodes.apiSettingsForm.dispatch('submit');assert.equal(submit.event.prevented,true);await Promise.all(submit.results);assert.match(h.nodes.apiSettingsMessage.textContent,/연결할 공급자/);

  console.log('Provider settings controller tests passed');
})().catch(error=>{console.error(error);process.exitCode=1});
