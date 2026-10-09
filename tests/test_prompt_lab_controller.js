const assert = require('node:assert/strict');
const PromptLab = require('../01_app/assets/core/prompt-lab-controller.js');

(async () => {
  function node() {
    const listeners = new Map();
    return {
      hidden: false, disabled: false, checked: false, value: '', textContent: '', innerHTML: '',
      placeholder: '', scrollTop: 0, scrollHeight: 42, focused: 0, children: [],
      addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); },
      removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter(item => item !== fn)); },
      dispatch(type, target = this) { const event = {target, prevented: false, preventDefault() { this.prevented = true; }}; return {event, results: (listeners.get(type) || []).map(fn => fn(event))}; },
      listenerCount(type) { return (listeners.get(type) || []).length; }, focus() { this.focused += 1; },
      closest() { return this.label; }, replaceChildren(...items) { this.children = items; }
    };
  }

  function harness(overrides = {}) {
    const ids = ['promptLabModal','promptLabForm','promptLabKey','promptLabStreaming','promptLabInput','promptLabOutput','promptLabMeta','promptLabImage','promptLabOpen','promptLabClose','promptLabRun'];
    const nodes = Object.fromEntries(ids.map(id => [id, node()]));
    const textMode = node(), imageMode = node();
    textMode.value = 'text'; imageMode.value = 'image'; textMode.checked = true;
    const modes = [textMode, imageMode];
    Object.defineProperty(modes, 'value', {get: () => imageMode.checked ? 'image' : 'text'});
    nodes.promptLabStreaming.label = node();
    nodes.promptLabStreaming.checked = true;
    nodes.promptLabForm.elements = {promptLabMode: modes};
    nodes.promptLabForm.reset = () => { textMode.checked = true; imageMode.checked = false; nodes.promptLabStreaming.checked = true; nodes.promptLabInput.value = ''; nodes.promptLabKey.value = ''; };
    const classes = new Set();
    const created = [];
    const root = {body:{classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)}},querySelector:selector=>nodes[selector.slice(1)]||null,createElement:tag=>{const item={tag};created.push(item);return item;}};
    const calls = [];
    const deps = {
      getRoot:()=>root,
      request:async(...args)=>{calls.push(['request',...args]);if(overrides.requestError)throw overrides.requestError;return overrides.requestResult||{output:'batch output',trace:{model:'gemini',usage:{promptTokenCount:3,candidatesTokenCount:4},latency_ms:8}}},
      fetch:async(...args)=>{calls.push(['fetch',...args]);return overrides.response},
      createTextDecoder:()=>({decode:value=>value||''}), createEmptyBytes:()=>''
    };
    return {controller:PromptLab.create(deps),nodes,modes,textMode,imageMode,classes,created,calls,root};
  }

  assert.throws(()=>PromptLab.create(),/requires getRoot/);
  const deps={getRoot(){},request(){},fetch(){},createTextDecoder(){},createEmptyBytes(){}};
  for(const name of Object.keys(deps)){const copy={...deps};delete copy[name];assert.throws(()=>PromptLab.create(copy),new RegExp(`requires ${name}`));}
  let h=harness();
  assert.equal(Object.isFrozen(h.controller),true);
  assert.equal(h.controller.mount(h.root),true);assert.equal(h.controller.mount(h.root),true);
  assert.equal(h.nodes.promptLabOpen.listenerCount('click'),1);assert.equal(h.textMode.listenerCount('change'),1);

  assert.equal(h.controller.mode(),'text');assert.equal(h.controller.syncMode(),undefined);
  assert.equal(h.nodes.promptLabOutput.hidden,false);assert.equal(h.nodes.promptLabImage.hidden,true);
  assert.match(h.nodes.promptLabInput.placeholder,/제목 3개/);
  h.textMode.checked=false;h.imageMode.checked=true;h.imageMode.dispatch('change');
  assert.equal(h.nodes.promptLabStreaming.label.hidden,true);assert.equal(h.nodes.promptLabOutput.hidden,true);assert.equal(h.nodes.promptLabImage.hidden,false);assert.match(h.nodes.promptLabInput.placeholder,/요양원 정원/);

  assert.equal(h.controller.open(),undefined);assert.equal(h.nodes.promptLabModal.hidden,false);assert.equal(h.classes.has('modal-open'),true);assert.equal(h.nodes.promptLabInput.focused,1);
  h.nodes.promptLabOutput.textContent='dirty';h.nodes.promptLabMeta.textContent='dirty';h.nodes.promptLabImage.innerHTML='dirty';
  assert.equal(h.controller.close(),undefined);assert.equal(h.nodes.promptLabModal.hidden,true);assert.equal(h.classes.has('modal-open'),false);
  assert.equal(h.nodes.promptLabOutput.textContent,'아직 실행하지 않았습니다.');assert.equal(h.nodes.promptLabMeta.textContent,'Google Gemini API 연결 후 테스트할 수 있습니다.');assert.match(h.nodes.promptLabImage.innerHTML,/생성된 이미지/);assert.equal(h.controller.mode(),'text');
  h.controller.open();h.nodes.promptLabModal.dispatch('pointerdown',h.nodes.promptLabInput);assert.equal(h.nodes.promptLabModal.hidden,false);h.nodes.promptLabModal.dispatch('pointerdown',h.nodes.promptLabModal);assert.equal(h.nodes.promptLabModal.hidden,true);

  h=harness();h.nodes.promptLabKey.value=' keep ';assert.equal(await h.controller.run(),undefined);assert.equal(h.nodes.promptLabMeta.textContent,'테스트할 프롬프트를 입력해 주세요.');assert.equal(h.nodes.promptLabKey.value,' keep ');assert.equal(h.calls.length,0);assert.equal(h.nodes.promptLabRun.disabled,false);

  h=harness();h.nodes.promptLabInput.value='  hello  ';h.nodes.promptLabKey.value=' key ';h.nodes.promptLabStreaming.checked=false;
  assert.equal(await h.controller.run(),undefined);
  assert.deepEqual(h.calls[0],['request','/api/prompt-harness/test',{method:'POST',body:JSON.stringify({prompt:'hello',api_key:'key'})}]);
  assert.equal(h.nodes.promptLabOutput.textContent,'batch output');assert.equal(h.nodes.promptLabMeta.textContent,'일괄 응답 · 모델 gemini · 입력 3 tokens · 출력 4 tokens · 8ms · 프로젝트 미반영');assert.equal(h.nodes.promptLabKey.value,'');assert.equal(h.nodes.promptLabRun.disabled,false);

  h=harness({requestResult:{image_data_url:'data:image/png;base64,x',trace:{model:'image-model',usage:{promptTokenCount:5},latency_ms:9}}});h.imageMode.checked=true;h.textMode.checked=false;h.nodes.promptLabInput.value=' picture ';h.nodes.promptLabKey.value='secret';
  await h.controller.run();assert.deepEqual(h.calls[0],['request','/api/prompt-harness/image',{method:'POST',body:JSON.stringify({prompt:'picture',api_key:'secret'})}]);assert.equal(h.created[0].src,'data:image/png;base64,x');assert.equal(h.created[0].alt,'picture');assert.deepEqual(h.nodes.promptLabImage.children,h.created);assert.equal(h.nodes.promptLabMeta.textContent,'이미지 생성 · 모델 image-model · 입력 5 tokens · 9ms · 프로젝트 미반영');

  h=harness({requestError:new Error('image failed')});h.imageMode.checked=true;h.textMode.checked=false;h.nodes.promptLabInput.value='picture';h.nodes.promptLabKey.value='secret';assert.equal(await h.controller.run(),undefined);assert.equal(h.nodes.promptLabOutput.textContent,'출력 없음');assert.match(h.nodes.promptLabImage.innerHTML,/이미지가 생성되지 않았습니다/);assert.equal(h.nodes.promptLabMeta.textContent,'image failed');assert.equal(h.nodes.promptLabKey.value,'');assert.equal(h.nodes.promptLabRun.disabled,false);

  const streamReads=[{value:'data: {"type":"chunk","text":"안녕"}\n\n',done:false},{value:'data: {"type":"done","model":"stream-model","usage":{"promptTokenCount":2,"candidatesTokenCount":1},"latency_ms":7}\n\n',done:true}];
  h=harness({response:{ok:true,body:{getReader:()=>({read:async()=>streamReads.shift()})}}});h.nodes.promptLabInput.value='stream';h.nodes.promptLabKey.value='key';
  await h.controller.run();assert.deepEqual(h.calls[0],['fetch','/api/prompt-harness/stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'stream',api_key:'key'})}]);assert.equal(h.nodes.promptLabOutput.textContent,'안녕');assert.equal(h.nodes.promptLabOutput.scrollTop,42);assert.equal(h.nodes.promptLabMeta.textContent,'스트리밍 · 모델 stream-model · 입력 2 tokens · 출력 1 tokens · 7ms · 프로젝트 미반영');

  h=harness({response:{ok:false,json:async()=>({})}});h.nodes.promptLabInput.value='stream';await h.controller.run();assert.equal(h.nodes.promptLabOutput.textContent,'출력 없음');assert.equal(h.nodes.promptLabMeta.textContent,'스트리밍 요청을 처리하지 못했습니다.');
  const errorReads=[{value:'data: {"type":"error"}\n\n',done:false}];h=harness({response:{ok:true,body:{getReader:()=>({read:async()=>errorReads.shift()})}}});h.nodes.promptLabInput.value='stream';await h.controller.run();assert.equal(h.nodes.promptLabMeta.textContent,'스트리밍이 중단됐습니다.');

  h=harness();h.controller.mount(h.root);h.controller.unmount();assert.equal(h.nodes.promptLabOpen.listenerCount('click'),0);assert.equal(h.textMode.listenerCount('change'),0);assert.equal(h.controller.unmount(),undefined);h.controller.mount(h.root);assert.equal(h.nodes.promptLabOpen.listenerCount('click'),1);
  const submit=h.nodes.promptLabForm.dispatch('submit');assert.equal(submit.event.prevented,true);await Promise.all(submit.results);
  const broken=harness();delete broken.nodes.promptLabMeta;assert.throws(()=>broken.controller.mount(broken.root),/missing #promptLabMeta/);broken.nodes.promptLabMeta=node();assert.equal(broken.controller.mount(broken.root),true);

  console.log('Prompt lab controller tests passed');
})().catch(error=>{console.error(error);process.exitCode=1});
