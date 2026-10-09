(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.Step03SceneVoicePlaybackController=api})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  function create(dependencies){
    const deps=dependencies||{};if(typeof deps.getRoot!=='function')throw new TypeError('Step03SceneVoicePlaybackController requires getRoot');
    let mountedRoot=null;
    const root=()=>{const value=mountedRoot||deps.getRoot();if(!value||typeof value.querySelector!=='function'||typeof value.querySelectorAll!=='function')throw new TypeError('Step03SceneVoicePlaybackController requires a DOM root');return value};
    function audio(value=root()){const node=value.querySelector('#storyboardVoiceAudio');if(!node||typeof node.pause!=='function'||typeof node.play!=='function')throw new Error('Step03SceneVoicePlaybackController missing #storyboardVoiceAudio');return node}
    function updateControls(resolveContext){if(typeof resolveContext!=='function')throw new TypeError('Step03SceneVoicePlaybackController requires a context resolver');const value=root();value.querySelectorAll('.storyboard-card').forEach(card=>{const ctx=resolveContext(card.dataset.scene),button=card.querySelector('.storyboard-speaker'),usage=card.querySelector('.storyboard-voice-usage');if(!ctx||!button||!usage)throw new Error('음성 카드 컨트롤을 찾을 수 없습니다.');const title=ctx.voice?'저장된 음성 재생':ctx.shared?`${ctx.ownerLabel} 음성 이어 사용 · 첫 씬에서 생성`:'이 내레이션 음성 생성';button.disabled=ctx.shared&&!ctx.voice;button.title=title;button.setAttribute('aria-label',title);button.classList.toggle('has-audio',Boolean(ctx.voice));const tokens=Number(ctx.voice?.usage?.total_tokens||0);usage.textContent=ctx.shared?`${ctx.ownerLabel} 음성 이어 사용 · 추가 생성 없음`:tokens?`음성 사용 토큰 ${tokens.toLocaleString()}`:'';usage.hidden=!usage.textContent})}
    function applyGenerated(card,voice){if(!card||typeof card.querySelector!=='function'||!voice||!voice.uri)throw new TypeError('유효한 생성 음성 카드와 음성이 필요합니다.');const button=card.querySelector('.storyboard-speaker'),usageNode=card.querySelector('.storyboard-voice-usage');if(!button||!usageNode)throw new Error('음성 사용량 표시 영역을 찾을 수 없습니다.');button.classList.add('has-audio');button.title='저장된 음성 재생';button.setAttribute('aria-label','저장된 음성 재생');const usage=voice.usage||{};usageNode.textContent=`음성 사용 토큰 ${Number(usage.total_tokens||0).toLocaleString()} (입력 ${Number(usage.input_tokens||0).toLocaleString()} / 출력 ${Number(usage.output_tokens||0).toLocaleString()})`;usageNode.hidden=false}
    async function play(voice,options={}){if(!voice||!voice.uri)throw new TypeError('유효한 음성 주소가 필요합니다.');if(options.autoplay===false)return voice;const node=audio();if(options.pauseFirst)node.pause();node.src=voice.uri;await node.play();return voice}
    function pause(){audio().pause()}
    function mount(value){if(mountedRoot)return true;const candidate=value||deps.getRoot();if(!candidate||typeof candidate.querySelector!=='function'||typeof candidate.querySelectorAll!=='function')throw new TypeError('Step03SceneVoicePlaybackController requires a DOM root');audio(candidate);mountedRoot=candidate;return true}
    function unmount(){if(!mountedRoot)return true;audio(mountedRoot).pause();mountedRoot=null;return true}
    return Object.freeze({mount,unmount,updateControls,applyGenerated,play,pause});
  }
  return Object.freeze({create});
});
