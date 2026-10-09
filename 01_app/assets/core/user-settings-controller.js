(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ThinkCastUserSettingsController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(dependencies) {
    const deps = dependencies || {};
    const required = ['getRoot','request','getIndexProjects','refreshProjectIndex','confirm','fetch','createObjectURL','revokeObjectURL','createRequestId','setInterval','clearInterval','onError'];
    required.forEach(name => { if (typeof deps[name] !== 'function') throw new TypeError(`ThinkCastUserSettingsController requires ${name}`); });
    if (!deps.authUI || typeof deps.authUI.isLoggedIn !== 'function' || typeof deps.authUI.getActiveAccount !== 'function') throw new TypeError('ThinkCastUserSettingsController requires authUI');
    if (!deps.storage || typeof deps.storage.getItem !== 'function') throw new TypeError('ThinkCastUserSettingsController requires storage');
    let mounted = false;
    let disposeRuntime = () => {};
    let listenerDisposers = [];

    function mount() {
      if (mounted) return true;
      const document = deps.getRoot();
      if (!document || typeof document.querySelector !== 'function') throw new TypeError('ThinkCastUserSettingsController requires root');
      const api = deps.request;
      const authUIController = deps.authUI;
      const localStorage = deps.storage;
      const indexProjects = deps.getIndexProjects();
      const confirm = deps.confirm;
      const fetch = deps.fetch;
      const URL = {createObjectURL: deps.createObjectURL, revokeObjectURL: deps.revokeObjectURL};
      const crypto = {randomUUID: deps.createRequestId};
      const setInterval = deps.setInterval;
      const clearInterval = deps.clearInterval;
      const listen = (node, type, handler, options) => {
        node.addEventListener(type, handler, options);
        listenerDisposers.push(() => node.removeEventListener(type, handler, options));
        return handler;
      };
        const dialog=document.querySelector('#userSettingsDialog');
        const slider=document.querySelector('#userAutomationRange');
        let stages=[];
        let selectedStage='manual';
        const optionsForm=document.querySelector('#userStageOptionsForm');
        const keyDialog=document.querySelector('#userChannelKeyDialog');
        const keyInput=document.querySelector('#userChannelKeyInput');
        let keyTrigger=null;
        function openChannelKey(button,name){
          keyTrigger=button;keyInput.value='';
          document.querySelector('#userChannelKeyTitle').textContent=`${name} 채널 키`;
          keyInput.setAttribute('aria-label',`${name} API 키 또는 액세스 토큰`);
          keyDialog.showModal();keyInput.focus();
        }
        listen(document.querySelector('#userChannelKeyForm'),'submit',event=>event.preventDefault());
        function closeChannelKey(){keyInput.value='';keyDialog.close();}
        listen(document.querySelector('#userChannelKeyClose'),'click',closeChannelKey);
        listen(document.querySelector('#userChannelKeyCancel'),'click',closeChannelKey);
        listen(keyDialog,'cancel',()=>{keyInput.value='';});
        listen(keyDialog,'close',()=>{keyInput.value='';if(dialog.open)keyTrigger?.focus();});
        listen(keyDialog,'click',event=>{if(event.target!==keyDialog)return;const r=keyDialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeChannelKey();});
        const saveStatus=document.querySelector('#userSettingsSaveStatus');
        const repeatFieldset=document.querySelector('#userAutomationRepeat');
        const repeatInterval=document.querySelector('#userRepeatInterval');
        const repeatSuffix=document.querySelector('#userRepeatSuffix');
        function repeatSettings(){const unit=repeatFieldset.querySelector('input[name="userRepeatUnit"]:checked').value;return {interval:Number(repeatInterval.value),unit};}
        function syncRepeatLimit(){const unit=repeatFieldset.querySelector('input[name="userRepeatUnit"]:checked')?.value||'day';repeatInterval.max=unit==='count'?'100':'365';repeatSuffix.textContent=unit==='count'?'회 연속':'마다';}
        listen(repeatFieldset,'change',syncRepeatLimit);
        function settingsKey(){
          const activeAccount=authUIController.getActiveAccount();
          const userId=activeAccount?.user?.id||activeAccount?.user?.user_id||activeAccount?.user?.username;
          if(!authUIController.isLoggedIn()||!userId)throw new Error('로그인 후 설정을 저장해 주세요.');
          return `thinkcast-user-automation-v1:${userId}`;
        }
        function restoreAutomationSettings(saved){
          saveStatus.textContent='서버에 저장합니다. 저장만으로는 실행되지 않습니다.';
          try{
            if(saved===undefined){saved=JSON.parse(localStorage.getItem(settingsKey())||'null');if(saved)saveStatus.textContent='기존 브라우저 설정입니다. 저장하면 서버에 반영됩니다.';}
            if(!saved||saved.version!==1)return;
            slider.value=String(Math.max(0,stages.findIndex(stage=>stage.key===saved.endpoint)+1));
            if(Number.isInteger(saved.repeat?.interval)&&saved.repeat.interval>=1&&saved.repeat.interval<=365)repeatInterval.value=String(saved.repeat.interval);
            if(['day','week','month','count'].includes(saved.repeat?.unit))repeatFieldset.querySelector(`input[value="${saved.repeat.unit}"]`).checked=true;
            syncRepeatLimit();
            optionsForm.querySelectorAll('input[id],select[id]').forEach(input=>{
              const value=saved.options?.[input.id];
              if(input.type==='checkbox'){if(typeof value==='boolean')input.checked=value;}
              else if(typeof value==='string'){
                const previous=input.value;input.value=value;
                if(!input.checkValidity()||input.value==='')input.value=previous;
              }
            });
            optionsForm.querySelectorAll('[data-output-channel]').forEach(input=>{input.checked=Array.isArray(saved.channels)&&saved.channels.includes(input.dataset.outputChannel)});
            selectedStage=stages[Number(slider.value)-1]?.key||'manual';
            syncKeywordButton();
          }catch(error){saveStatus.textContent='저장된 설정을 불러오지 못했습니다. 기본값으로 표시합니다.';}
        }
        let serverVersion=0,serverEnabled=false,automationBusy=false,automationLoaded=false,automationPoll=null,openGeneration=0,loadedConfig='';
        let availableBrandRoles=new Set();
        function syncAvailableBrandOptions(){
          const inputs={intro:'#userUseIntro',outro:'#userUseOutro',watermark:'#userUseWatermark'};
          Object.entries(inputs).forEach(([role,selector])=>{
            const input=document.querySelector(selector),available=availableBrandRoles.has(role);
            if(!available)input.checked=false;
            input.disabled=!available;
            input.closest?.('label')?.classList?.toggle?.('unavailable',!available);
            input.title=available?'':'등록된 활성 리소스가 없어 자동화에서 제외됩니다.';
          });
        }
        function collectAutomationConfig(){return {schema_version:'1.0.0',endpoint:stages[Number(slider.value)-1]?.key||'manual',repeat:repeatSettings(),keywords:{count:Number(document.querySelector('#userKeywordCount').value),ai:document.querySelector('#userAiKeywords').checked,month:document.querySelector('#userKeywordMonth').value},video:{scene_count:Number(document.querySelector('#userVideoSceneCount').value),crop:document.querySelector('#userCropMode').value},voice:{profile_id:document.querySelector('#userVoiceProfile').value},brand:{intro:document.querySelector('#userUseIntro').checked,outro:document.querySelector('#userUseOutro').checked,watermark:document.querySelector('#userUseWatermark').checked},channels:[...optionsForm.querySelectorAll('[data-output-channel]:checked')].map(input=>input.dataset.outputChannel)};}
        function applyServerSettings(data){
          serverVersion=data.settings?.version||0;serverEnabled=!!data.settings?.enabled;
          const c=data.settings?.config;
          if(c)restoreAutomationSettings({version:1,endpoint:c.endpoint,repeat:c.repeat,channels:c.channels,options:{userKeywordCount:String(c.keywords.count),userAiKeywords:c.keywords.ai,userKeywordMonth:c.keywords.month,userVideoSceneCount:String(c.video.scene_count),userCropMode:c.video.crop,userVoiceProfile:c.voice?.profile_id||'warm_female',userUseIntro:c.brand.intro,userUseOutro:c.brand.outro,userUseWatermark:c.brand.watermark}});
          else restoreAutomationSettings();
          syncAvailableBrandOptions();
          loadedConfig=JSON.stringify(collectAutomationConfig());renderAutomationStatus(data);render();
        }
        function renderAutomationStatus(data){
          const setting=data.settings;
          const active=!!setting?.enabled||(data.runs||[]).some(run=>['queued','running'].includes(run.status));
          const toggle=document.querySelector('#userAutomationToggle');
          toggle.textContent=active?'중지':'시작';toggle.dataset.action=active?'stop':'start';toggle.classList.toggle('primary',!active);
          document.querySelector('#userAutomationServerStatus').textContent=setting?.enabled?`자동화 예약 중 · 다음 실행 ${new Date(setting.next_run_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} (한국 시간)`:'자동화 중지 상태';
          const labels={queued:'대기',running:'진행 중',succeeded:'완료',failed:'실패',cancelled:'중지'};
          document.querySelector('#userAutomationRuns').replaceChildren(...(data.runs||[]).map(run=>{
            const row=document.createElement('div');row.className='user-automation-run';
            const text=document.createElement('div');text.textContent=`${new Date(run.created_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} · ${labels[run.status]||run.status} · ${run.stage}${run.error_message?' · '+run.error_message:''}`;row.append(text);
            if(run.project_id){const link=document.createElement('a');link.href=`?project_id=${encodeURIComponent(run.project_id)}#index`;link.textContent='콘텐츠 보기';row.append(link);}
            if(['failed','queued','running'].includes(run.status)){const button=document.createElement('button');button.type='button';button.className='flow-btn';button.textContent=run.status==='failed'?'다시 시도':'이번 실행 취소';button.disabled=automationBusy;listen(button,'click',()=>{if(confirm(run.status==='failed'?'완료된 단계는 재사용합니다. 응답이 끊긴 단계는 재호출 비용이 발생할 수 있습니다. 다시 시도할까요?':'진행 중인 외부 요청은 완료될 수 있습니다. 다음 단계부터 중지할까요?'))mutateAutomation(run.status==='failed'?'retry':'cancel',run.run_id)});row.append(button);}
            return row;
          }));
        }
        function setAutomationBusy(value){
          automationBusy=value;slider.disabled=value||!stages.length;
          optionsForm.inert=value;document.querySelector('#userAutomationStages').inert=value;repeatFieldset.inert=value;
          ['userSettingsSave','userAutomationToggle','userVoicePreview'].forEach(id=>document.getElementById(id).disabled=value||!automationLoaded);
        }
        async function mutateAutomation(action,runId){
          if(automationBusy||!automationLoaded)return false;
          if(['save','start'].includes(action)&&!optionsForm.reportValidity()){saveStatus.textContent='입력값을 확인해 주세요.';return false;}
          const generation=openGeneration;setAutomationBusy(true);saveStatus.textContent='서버에 반영 중…';
          try{
            const payload={action,request_id:crypto.randomUUID(),version:serverVersion};
            if(['save','start'].includes(action))payload.config=collectAutomationConfig();
            if(runId)payload.run_id=runId;
            const data=await api('/api/automation',{method:'POST',body:JSON.stringify(payload)});
            if(generation!==openGeneration)return false;
            applyServerSettings(data);saveStatus.textContent=action==='save'?'서버에 저장했습니다. 자동화는 중지 상태입니다.':action==='start'?'자동화를 시작했습니다. 첫 콘텐츠가 곧 생성됩니다.':'반영했습니다. 이미 시작한 외부 요청은 완료될 수 있습니다.';
            deps.refreshProjectIndex().catch(error=>deps.onError('refresh-project-index',error));return true;
          }catch(error){if(generation===openGeneration)saveStatus.textContent=error.message;return false;}
          finally{if(generation===openGeneration)setAutomationBusy(false);}
        }
        async function startAutomation(closeAfter=false){
          if(automationBusy||!automationLoaded)return;
          const c=collectAutomationConfig();if(c.endpoint==='manual'){saveStatus.textContent='자동화할 단계를 선택해 주세요.';return;}
          const unit={day:'일',week:'주',month:'개월',count:'회 연속'}[c.repeat.unit];
          const cadence=c.repeat.unit==='count'?`${c.repeat.interval}${unit}`:`${c.repeat.interval}${unit} 간격`;
          if(!confirm(`키워드부터 ${stages[Number(slider.value)-1]?.label}까지 ${cadence}으로 자동화를 시작합니다.\n지금 첫 콘텐츠를 만들며, AI·이미지·음성 API 비용이 발생할 수 있습니다.\n진행할까요?`))return;
          if(await mutateAutomation('start')&&closeAfter)dialog.close();
        }
        function requestSettingsClose(){
          if(automationBusy)return;
          if(automationLoaded&&Number(slider.value)>0&&!(serverEnabled&&loadedConfig===JSON.stringify(collectAutomationConfig()))){startAutomation(true);return;}
          dialog.close();
        }
        const recommendButton=document.querySelector('#userKeywordRecommend');
        const refreshButton=document.querySelector('#userKeywordRefresh');
        const keywordCount=document.querySelector('#userKeywordCount');
        const aiKeywords=document.querySelector('#userAiKeywords');
        const keywordMonth=document.querySelector('#userKeywordMonth');
        const keywordMessage=document.querySelector('#userKeywordResultMessage');
        const keywordResults=document.querySelector('#userKeywordResults');
        let keywordRequestGeneration=0;
        let keywordBusy=false;
        function syncKeywordButton(){
          document.querySelector('#userKeywordLoading').hidden=!keywordBusy;
          keywordResults.setAttribute('aria-busy',String(keywordBusy));
          recommendButton.disabled=refreshButton.disabled=keywordBusy||!aiKeywords.checked;
        }
        function clearKeywordPreview(){
          keywordRequestGeneration++;keywordBusy=false;keywordResults.replaceChildren();syncKeywordButton();
          keywordMessage.textContent=aiKeywords.checked?'월별 후보는 중복 없이 추첨합니다. 이번 달 후보가 없으면 AI API를 호출합니다.':'AI 추천 사용이 꺼져 있습니다.';
        }
        listen(aiKeywords,'change',clearKeywordPreview);
        listen(keywordCount,'input',clearKeywordPreview);
        listen(keywordMonth,'change',clearKeywordPreview);
        async function requestKeywords(refresh=false){
          if(keywordBusy||!aiKeywords.checked||!keywordCount.reportValidity())return;
          const count=Number(keywordCount.value);
          if(!Number.isInteger(count)||count<1||count>5){keywordMessage.textContent='추천 개수는 1~5 사이의 정수로 입력해 주세요.';return}
          const generation=++keywordRequestGeneration;keywordBusy=true;syncKeywordButton();keywordResults.replaceChildren();
          keywordMessage.textContent='대한민국 기준 계절·행사 키워드를 추천하고 있습니다…';
          try{
            const result=await api('/api/season-keywords/preview',{method:'POST',body:JSON.stringify({count,refresh,month:keywordMonth.value})});
            if(generation!==keywordRequestGeneration||!dialog.open)return;
            keywordResults.replaceChildren(...result.keywords.map(keyword=>{
              const row=document.createElement('p');const title=document.createElement('strong');title.textContent=keyword.label;
              row.append(title,document.createElement('br'),document.createTextNode(keyword.description));return row;
            }));
            keywordMessage.textContent=result.source==='monthly_pool'?`${result.month} 요양원 후보에서 ${result.keywords.length}개 추첨 · 남은 후보 ${result.remaining}개 · API 호출 없음${result.cycled?' · 새 순환 시작':''}`:`${result.context.local_date} · 대한민국 ${result.context.season} · ${result.cached?'저장된 추천 재사용':'실제 API 추천 완료'} · ${result.keywords.length}개 · ${result.usage.total_tokens} 토큰${result.cached?' (원 요청 기준)':''}`;
          }catch(error){if(generation===keywordRequestGeneration&&dialog.open)keywordMessage.textContent=error.message}
          finally{if(generation===keywordRequestGeneration){keywordBusy=false;syncKeywordButton()}}
        }
        listen(recommendButton,'click',()=>requestKeywords(false));
        listen(refreshButton,'click',()=>requestKeywords(true));
        listen(optionsForm,'submit',event=>event.preventDefault());
        let previousOverflow='';
        function render(){
          const end=Number(slider.value);
          repeatFieldset.disabled=end===0;
          repeatFieldset.hidden=end===0;
          const label=end?`${stages[end-1].label}까지 자동 진행`:'수동 진행';
          document.querySelector('#userAutomationValue').textContent=label;
          slider.setAttribute('aria-valuetext',label);
          document.querySelectorAll('#userAutomationStages button').forEach((item,index)=>{
            item.className=`user-settings-stage${index>0&&index<=end?' included':''}${index===end?' endpoint':''}`;
            item.setAttribute('aria-pressed',String(item.dataset.userStageButton===selectedStage));
          });
          optionsForm.querySelectorAll('[data-user-stage]').forEach(panel=>{panel.hidden=panel.dataset.userStage!==selectedStage});
          document.querySelector('#userAutomationSummary').textContent=!stages.length?'단계 목록을 불러오지 못했습니다. 콘텐츠 목록을 다시 불러온 뒤 열어 주세요.':end?`자동 진행: ${stages.slice(0,end).map(stage=>stage.label).join(' → ')} · ${stages[end]?`${stages[end].label} 전 대기`:'제작물 캘린더 표시까지 (배포 제외)'}`:'모든 단계에서 사용자가 직접 진행합니다.';
        }
        listen(document.querySelector('#userSettingsOpen'),'click',async()=>{
          const generation=++openGeneration;automationLoaded=false;
          stages=(Object.values(indexProjects)[0]?.steps||[]).filter(stage=>stage.key!=='1').map(stage=>stage.key==='5'?{...stage,label:'제작 캘린더'}:stage);
          selectedStage='manual';optionsForm.reset();clearKeywordPreview();
          slider.closest('.user-automation-layout').style.setProperty('--stage-count',String(stages.length+1));
          syncKeywordButton();
          document.querySelector('#userAutomationStages').replaceChildren(...[{key:'manual',label:'수동'},...stages].map((stage,index)=>{
            const button=document.createElement('button');button.type='button';button.dataset.userStageButton=stage.key;button.textContent=stage.label;
            listen(button,'click',()=>{slider.value=String(index);selectedStage=stage.key;render()});return button;
          }));
          slider.max=String(stages.length);slider.value='0';slider.disabled=!stages.length;
          const outputGroups=new Map();
          document.querySelectorAll('.distribution-btn[data-platform]').forEach(button=>{
            const name=button.querySelector('span:not([class])')?.textContent.trim()||button.dataset.platform;
            const preview=document.querySelector(`.platform-preview-btn[data-platform="${button.dataset.platform}"]`);
            const ratio=preview?.getAttribute('aria-label')?.match(/(?:16:9|9:16|4:5|1:1)/)?.[0]||'16:9';
            if(!outputGroups.has(ratio)){
              const group=document.createElement('fieldset');group.className='user-output-group';group.dataset.outputRatio=ratio;
              const title=document.createElement('legend');title.textContent=ratio;
              const grid=document.createElement('div');grid.className='user-output-grid';group.append(title,grid);outputGroups.set(ratio,group);
            }
            const label=document.createElement('label');label.className='user-output-channel';label.dataset.platform=button.dataset.platform;
            const check=document.createElement('input');check.type='checkbox';check.dataset.outputChannel=button.dataset.platform;check.dataset.outputRatio=ratio;
            const icon=document.createElement('span');icon.className='platform-icon';icon.setAttribute('aria-hidden','true');
            const text=document.createElement('span');text.textContent=name;label.append(check,icon,text);
            const keyButton=document.createElement('button');keyButton.type='button';keyButton.className='user-channel-key';keyButton.dataset.channelKey=button.dataset.platform;
            keyButton.setAttribute('aria-label',`${name} 채널 키 입력`);keyButton.title=`${name} 채널 키 입력`;keyButton.setAttribute('aria-haspopup','dialog');keyButton.setAttribute('aria-controls','userChannelKeyDialog');
            /* Lucide KeyRound: https://lucide.dev/icons/key-round
             * ISC License. Copyright (c) 2026 Lucide Icons and Contributors.
             * Permission to use, copy, modify, and/or distribute this software for any
             * purpose with or without fee is hereby granted, provided that the above
             * copyright notice and this permission notice appear in all copies.
             * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
             * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
             * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
             * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
             * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
             * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
             * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
             */
            keyButton.innerHTML='<svg class="lucide lucide-key-round" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg>';
            listen(keyButton,'click',()=>openChannelKey(keyButton,name));
            const card=document.createElement('div');card.className='user-output-card';card.append(label,keyButton);
            outputGroups.get(ratio).querySelector('.user-output-grid').append(card);
          });
          document.querySelector('#userOutputChannels').replaceChildren(...outputGroups.values());
          render();previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.showModal();
          setAutomationBusy(true);saveStatus.textContent='서버 설정을 불러오는 중…';
          try{
            const [data,brandData]=await Promise.all([api('/api/automation'),api('/api/brand-assets')]);if(generation!==openGeneration||!dialog.open)return;
            availableBrandRoles=new Set((brandData.assets||[]).filter(asset=>asset&&asset.active).map(asset=>asset.role));
            automationLoaded=true;applyServerSettings(data);
            clearInterval(automationPoll);automationPoll=setInterval(async()=>{if(!dialog.open||automationBusy)return;try{const current=await api('/api/automation');if(dialog.open&&generation===openGeneration)renderAutomationStatus(current)}catch(error){deps.onError('poll',error)}},5000);
          }catch(error){saveStatus.textContent='서버 설정을 불러오지 못했습니다. 닫은 뒤 다시 열어 주세요.';}
          finally{if(generation===openGeneration)setAutomationBusy(false);}
        });
        listen(slider,'input',()=>{selectedStage=stages[Number(slider.value)-1]?.key||'manual';render()});
        listen(document.querySelector('#userSettingsClose'),'click',requestSettingsClose);
        listen(document.querySelector('#userSettingsSave'),'click',()=>mutateAutomation('save'));
        listen(document.querySelector('#userVoicePreview'),'click',async event=>{
          const button=event.currentTarget,profile=document.querySelector('#userVoiceProfile').value;
          const status=document.querySelector('#userVoicePreviewStatus'),audio=document.querySelector('#voiceSampleAudio');
          if(button.disabled)return;
          button.disabled=true;button.textContent='불러오는 중…';status.textContent='음성 샘플을 준비하고 있습니다.';
          try{
            const response=await fetch(`/api/voice/sample?profile=${encodeURIComponent(profile)}&v=greeting-20260928`,{credentials:'same-origin',cache:'no-store'});
            if(!response.ok){const detail=await response.json().catch(error=>{deps.onError('voice-error-json',error);return {}});throw new Error(detail.error||'음성 샘플을 불러오지 못했습니다.')}
            const url=URL.createObjectURL(await response.blob()),previous=audio.dataset.objectUrl;
            audio.pause();audio.src=url;audio.dataset.objectUrl=url;audio.onended=()=>{URL.revokeObjectURL(url);delete audio.dataset.objectUrl};
            if(previous)URL.revokeObjectURL(previous);
            await audio.play();status.textContent='선택한 음성 샘플을 재생합니다.';
          }catch(error){status.textContent=error.message}
          finally{button.disabled=false;button.textContent='▶ 듣기'}
        });
        listen(document.querySelector('#userAutomationToggle'),'click',()=>{
          if(document.querySelector('#userAutomationToggle').dataset.action==='stop'){
            if(confirm('반복 예약과 진행 중인 자동화를 중지할까요? 이미 시작한 API 요청의 비용은 발생할 수 있습니다.'))mutateAutomation('stop');
          }else startAutomation(true);
        });
        listen(dialog,'cancel',event=>{event.preventDefault();requestSettingsClose();});
        listen(dialog,'click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)requestSettingsClose()});
        listen(dialog,'close',()=>{openGeneration++;clearInterval(automationPoll);document.body.style.overflow=previousOverflow;slider.value='0';selectedStage='manual';optionsForm.reset();clearKeywordPreview();render();document.querySelector('#userSettingsOpen').focus()});
      disposeRuntime = () => {
        openGeneration++;
        clearInterval(automationPoll);
        automationPoll = null;
        const audio = document.querySelector('#voiceSampleAudio');
        const objectUrl = audio?.dataset?.objectUrl;
        if (audio) audio.onended = null;
        if (objectUrl) { audio.pause(); deps.revokeObjectURL(objectUrl); delete audio.dataset.objectUrl; }
        if (keyInput) keyInput.value = '';
      };
      mounted = true;
      return true;
    }

    function unmount() {
      if (!mounted) return false;
      disposeRuntime();
      listenerDisposers.splice(0).reverse().forEach(dispose => dispose());
      disposeRuntime = () => {};
      mounted = false;
      return true;
    }

    return Object.freeze({mount, unmount});
  }

  return Object.freeze({create});
});
