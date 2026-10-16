(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ThinkCastAutomationControlPanel = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(dependencies) {
    const deps=dependencies||{};
    for(const name of ['getRoot','model','onToggle','onRunAction'])if(typeof deps[name]!=='function')throw new TypeError(`ThinkCastAutomationControlPanel requires ${name}`);
    let mounted=false,busy=false,current=null,nodes=null,listeners=[];
    const listen=(node,type,handler)=>{node.addEventListener(type,handler);listeners.push(()=>node.removeEventListener(type,handler));};
    function resolve(document,id){const node=document.querySelector(`#${id}`);if(!node)throw new Error(`Automation control panel DOM missing #${id}`);return node;}
    function mount(){
      if(mounted)return true;
      const document=deps.getRoot();if(!document?.querySelector||!document?.createElement)throw new TypeError('ThinkCastAutomationControlPanel requires a DOM root');
      nodes={document,switchControl:resolve(document,'userAutomationSwitch'),switch:resolve(document,'userAutomationToggle'),switchText:resolve(document,'userAutomationSwitchText'),badge:resolve(document,'userAutomationStateBadge'),percent:resolve(document,'userAutomationPercent'),bar:resolve(document,'userAutomationProgressBar'),stage:resolve(document,'userAutomationCurrentStage'),detail:resolve(document,'userAutomationCurrentDetail'),phases:resolve(document,'userAutomationProgressSteps'),server:resolve(document,'userAutomationServerStatus'),runs:resolve(document,'userAutomationRuns')};
      async function toggle(wanted){
        if(busy||!current){nodes.switch.checked=Boolean(current?.enabled);return false;}
        nodes.switch.checked=Boolean(wanted);setBusy(true);
        try{const changed=await deps.onToggle(wanted);if(!changed)nodes.switch.checked=Boolean(current.enabled);}
        finally{setBusy(false);}
        return nodes.switch.checked===Boolean(wanted);
      }
      listen(nodes.switchControl,'click',event=>{event.preventDefault?.();return toggle(!Boolean(current?.enabled))});
      listen(nodes.switch,'change',()=>toggle(nodes.switch.checked));
      mounted=true;return true;
    }
    function setBusy(value){busy=Boolean(value);if(nodes)nodes.switch.disabled=busy;}
    function setNotice(message,state='idle'){
      if(!nodes)return false;
      nodes.detail.textContent=String(message||'');nodes.badge.textContent=state==='failed'?'확인 필요':current?.state||'꺼짐';nodes.badge.dataset.state=state;
      return true;
    }
    function runRow(run){
      const row=nodes.document.createElement('article');row.className=`user-automation-run ${run.status||''}`;
      const head=nodes.document.createElement('strong');head.textContent=`${deps.model({runs:[run]}).state} · ${deps.model({runs:[run]}).stage}`;
      const time=nodes.document.createElement('time');time.textContent=run.created_at?new Date(run.created_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'';
      const detail=nodes.document.createElement('span');detail.textContent=run.error_message||`시도 ${run.attempt||1}`;
      row.append(head,time,detail);
      if(run.project_id){const link=nodes.document.createElement('a');link.href=`?project_id=${encodeURIComponent(run.project_id)}#index`;link.textContent='콘텐츠 보기';row.append(link);}
      if(['failed','queued','running'].includes(run.status)){
        const action=nodes.document.createElement('button');action.type='button';action.className='flow-btn';action.textContent=run.status==='failed'?'다시 시도':'이번 실행 취소';action.disabled=busy;
        listen(action,'click',()=>deps.onRunAction(run.status==='failed'?'retry':'cancel',run));row.append(action);
      }
      return row;
    }
    function render(snapshot){
      if(!mounted)throw new Error('Automation control panel is not mounted');
      current=deps.model(snapshot);nodes.switch.checked=current.enabled;nodes.switch.disabled=busy;
      nodes.switchText.textContent=current.enabled?'켜짐':'꺼짐';nodes.badge.textContent=current.state;nodes.badge.dataset.state=current.latest?.status||'idle';
      nodes.percent.textContent=`${current.percent}%`;nodes.bar.style.width=`${current.percent}%`;nodes.bar.parentElement?.setAttribute?.('aria-valuenow',String(current.percent));
      nodes.stage.textContent=current.stage;nodes.detail.textContent=current.detail;
      nodes.phases.replaceChildren(...current.phases.map(phase=>{const item=nodes.document.createElement('li');item.className=phase.state;item.textContent=phase.label;return item;}));
      nodes.server.textContent=current.nextRunAt&&current.enabled?`다음 실행 · ${new Date(current.nextRunAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}`:current.enabled?'자동 제작이 활성화되어 있습니다.':'자동 제작이 꺼져 있습니다.';
      nodes.runs.replaceChildren(...current.runs.slice(0,5).map(runRow));
      return current;
    }
    function unmount(){if(!mounted)return false;listeners.splice(0).reverse().forEach(dispose=>dispose());nodes=null;current=null;mounted=false;return true;}
    return Object.freeze({mount,unmount,render,setBusy,setNotice});
  }
  return Object.freeze({create});
});
