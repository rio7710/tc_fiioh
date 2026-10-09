(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Step03ProductionWorkflowController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const productionConfig = Object.freeze({
    kicker:'AI IMAGE PRODUCTION TEAM',
    title:'장면 이미지 제작 중',
    summary:'대본을 바탕으로 캐릭터·씬·음성을 구성하고 이미지 연결 상태를 검수합니다.',
    engines:Object.freeze([
      {mark:'IN',kind:'internal',name:'내부 캐릭터',status:'내부 자산'},
      {mark:'GPT',kind:'gpt',name:'ChatGPT API',status:'연동 예정'},
      {mark:'N',kind:'nano',name:'Nano Banana',status:'연동 예정'},
      {mark:'VO',kind:'voice',name:'Voice API',status:'연동 예정'},
      {mark:'C',kind:'claude',name:'Claude API',status:'연동 예정'}
    ].map(Object.freeze)),
    roles:Object.freeze([
      {name:'캐릭터 구성',description:'내부 캐릭터 라이브러리 불러오기',engine:'내부 캐릭터'},
      {name:'씬 이미지 구성',description:'대본 기반 구도 · 이미지 생성',engine:'GPT · Nano Banana'},
      {name:'브릿지 이미지 추가',description:'씬 사이를 잇는 연결 이미지 생성',engine:'GPT · Nano Banana'},
      {name:'음성 생성·추출',description:'확정 대본 기반 TTS 생성 · 장면별 음성 파일 및 싱크 구성',engine:'Voice API · 내부 STT'},
      {name:'브릿지 검수',description:'씬 연결 · 전환 어색함 확인',engine:'GPT · Claude'},
      {name:'이미지 오류 검토',description:'캐릭터 · 구도 · 장면 일관성 확인',engine:'GPT · Claude'}
    ].map(Object.freeze))
  });
  const actions = Object.freeze([
    '내부 캐릭터 라이브러리에서 등장인물을 구성 중입니다',
    'ChatGPT와 Nano Banana가 씬 이미지를 구성 중입니다',
    'GPT와 Nano Banana로 브릿지 이미지가 추가되고 있습니다',
    'Voice API가 확정 대본의 음성을 생성하고 장면별 파일을 추출 중입니다',
    'GPT와 Claude가 씬 사이 브릿지를 확인 중입니다',
    'GPT와 Claude가 캐릭터와 장면 이미지 오류를 검토 중입니다'
  ]);
  const requiredIds = ['aiWorkflowModal','aiProgressBar','aiFootStatus','aiWorkflowSummary','aiNow'];

  function create(dependencies) {
    const deps = dependencies || {};
    for (const name of ['getRoot','configureWorkflowModal','generateMissingSceneVideos','request','getActiveProjectId','sleep','setupSceneProgressBadges','runDemoSceneProgress','showStep']) {
      if (typeof deps[name] !== 'function') throw new TypeError(`Step03ProductionWorkflowController requires ${name}`);
    }
    let mountedRoot = null;
    let elements = null;
    let activeRun = null;

    function resolveRoot(root) {
      const value = root || mountedRoot || deps.getRoot();
      if (!value || typeof value.querySelector !== 'function' || !value.body) throw new TypeError('Step03ProductionWorkflowController requires a DOM root');
      return value;
    }
    function collect(root) {
      const found = {};
      for (const id of requiredIds) {
        found[id] = root.querySelector(`#${id}`);
        if (!found[id]) throw new Error(`Step03ProductionWorkflowController missing #${id}`);
      }
      return found;
    }
    function mount(root) {
      const value = resolveRoot(root);
      if (mountedRoot) return true;
      elements = collect(value);
      mountedRoot = value;
      return true;
    }
    function unmount() {
      if (activeRun) return false;
      mountedRoot = null;
      elements = null;
      return true;
    }

    async function execute(projectId) {
      await deps.generateMissingSceneVideos();
      const root = resolveRoot();
      const nodes = mountedRoot ? elements : collect(root);
      const modal = deps.configureWorkflowModal('production', productionConfig);
      if (!modal || typeof modal.querySelectorAll !== 'function') throw new TypeError('Step03ProductionWorkflowController requires a configured workflow modal');
      const roles = [...modal.querySelectorAll('.ai-role')];
      if (roles.length < productionConfig.roles.length) throw new Error('Step03ProductionWorkflowController requires production workflow roles');
      const progress = nodes.aiProgressBar;
      const foot = nodes.aiFootStatus;
      const summary = nodes.aiWorkflowSummary;
      const nowNode = nodes.aiNow;
      const preparationPromise = deps.request('/api/production/prepare', {method:'POST',body:JSON.stringify({project_id:projectId})}).then(value=>({value}),error=>({error}));
      modal.hidden = false;
      modal.classList.remove('complete');
      root.body.classList.add('modal-open');
      progress.style.width = '0%';
      nowNode.classList.add('processing');
      nowNode.textContent = '이미지 제작 AI 팀을 호출하고 있습니다';
      roles.forEach(role => { role.className = 'ai-role'; role.querySelector('.ai-role-state').textContent = '대기'; });
      deps.setupSceneProgressBadges(roles[1], '장면별 이미지 생성 상태');
      try {
        const stepSize = 100 / roles.length;
        for (let index = 0; index < roles.length; index += 1) {
          const role = roles[index];
          role.classList.add('active');
          role.querySelector('.ai-role-state').textContent = '작업 중';
          nowNode.textContent = actions[index];
          foot.textContent = `${index + 1} / ${roles.length} 단계 처리 중`;
          progress.style.width = `${index * stepSize + stepSize / 2}%`;
          if (index === 1) {
            await deps.runDemoSceneProgress(role, (completed, total) => {
              role.querySelector('.ai-role-state').textContent = `${completed} / ${total}`;
              foot.textContent = `장면 이미지 생성 · ${String(completed).padStart(2, '0')} / ${String(total).padStart(2, '0')} 완료`;
              progress.style.width = `${(index + completed / total) * stepSize}%`;
            });
          } else await deps.sleep(1400 + index * 100);
          role.classList.remove('active');
          role.classList.add('done');
          role.querySelector('.ai-role-state').textContent = '완료';
          progress.style.width = `${(index + 1) * stepSize}%`;
        }
        const preparation = await preparationPromise;
        if (preparation.error) throw preparation.error;
        modal.classList.add('complete');
        nowNode.classList.remove('processing');
        nowNode.textContent = '장면 이미지 구성이 완료되었습니다.';
        summary.textContent = '캐릭터, 씬 이미지, 브릿지와 음성 구성이 완료됐습니다. 영상 생성 전 장면별 이미지를 검수할 수 있습니다.';
        foot.textContent = '1초 후 이미지 검수·영상 디자인 화면으로 이동합니다.';
        await deps.sleep(1000);
        modal.hidden = true;
        root.body.classList.remove('modal-open');
        deps.showStep(4);
      } catch (error) {
        nowNode.classList.remove('processing');
        nowNode.textContent = '이미지 구성을 완료하지 못했습니다.';
        summary.textContent = '장면 이미지 제작 중 문제가 발생했습니다.';
        foot.textContent = error.message;
        await deps.sleep(1500);
        modal.hidden = true;
        root.body.classList.remove('modal-open');
        throw error;
      }
    }

    function run() {
      if (activeRun) return activeRun;
      const projectId = deps.getActiveProjectId();
      if (!projectId) return Promise.reject(new Error('이미지를 제작할 콘텐츠를 먼저 선택해 주세요.'));
      activeRun = execute(projectId).finally(() => { activeRun = null; });
      return activeRun;
    }
    return Object.freeze({mount,unmount,run,isRunning:()=>Boolean(activeRun)});
  }
  return Object.freeze({create});
});
