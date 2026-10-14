(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Step02ScriptGenerationController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const storyboardConfig = Object.freeze({
    kicker:'STORYBOARD GENERATION',
    title:'최종대본 생성 중',
    summary:'선택한 키워드와 그룹 레퍼런스로 실제 최종대본을 생성합니다.',
    engines:Object.freeze([{mark:'GPT',kind:'gpt',name:'OpenAI API',status:'실제 요청'}]),
    roles:Object.freeze([
      {name:'대본 작성',description:'인물·장소 분산, 서사와 나레이션 확정',engine:'OpenAI API'},
      {name:'콘티 작성',description:'장소 이동·연속성·씬 프롬프트 설계',engine:'OpenAI API'},
      {name:'최종 검증',description:'스키마 검증 · 프로젝트 저장',engine:'Schema Validator'}
    ].map(Object.freeze))
  });
  const requiredIds = ['aiWorkflowModal','aiProgressBar','aiFootStatus','aiWorkflowSummary','aiNow','aiSceneProgress','aiSceneCompleted','aiSceneTotal','aiSceneFailed'];

  function create(dependencies) {
    const deps = dependencies || {};
    for (const name of ['getRoot','configureWorkflowModal','request','getActiveProjectId','getSelectedKeywordLabels','getPendingJob','setPendingJob','clearPendingJob','now','setInterval','clearInterval','sleep','setGeneratedState','setGeneratedTimeline','setGeneratedDocument','setKeywordLocked','setVoiceProfile','applyTimeline','removeStoredScript','fillScript','applyScript','refreshProjectIndex','showStep']) {
      if (typeof deps[name] !== 'function') throw new TypeError(`Step02ScriptGenerationController requires ${name}`);
    }
    let mountedRoot = null;
    let elements = null;
    let activeRun = null;

    function resolveRoot(root) {
      const value = root || mountedRoot || deps.getRoot();
      if (!value || typeof value.querySelector !== 'function' || !value.body) throw new TypeError('Step02ScriptGenerationController requires a DOM root');
      return value;
    }
    function collect(root) {
      const found = {};
      for (const id of requiredIds) {
        found[id] = root.querySelector(`#${id}`);
        if (!found[id]) throw new Error(`Step02ScriptGenerationController missing #${id}`);
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

    async function execute(projectId, resumeJobId) {
      const root = resolveRoot();
      const nodes = mountedRoot ? elements : collect(root);
      const modal = deps.configureWorkflowModal('storyboard', storyboardConfig);
      if (!modal || typeof modal.querySelectorAll !== 'function') throw new TypeError('Step02ScriptGenerationController requires a configured workflow modal');
      const roles = [...modal.querySelectorAll('.ai-role')];
      if (roles.length < storyboardConfig.roles.length) throw new Error('Step02ScriptGenerationController requires storyboard workflow roles');
      const progress = nodes.aiProgressBar;
      const foot = nodes.aiFootStatus;
      const summary = nodes.aiWorkflowSummary;
      const nowNode = nodes.aiNow;
      const sceneProgress = nodes.aiSceneProgress;
      const sceneCompleted = nodes.aiSceneCompleted;
      const sceneTotal = nodes.aiSceneTotal;
      const sceneFailed = nodes.aiSceneFailed;
      const updateSceneProgress = values => {
        const total = Math.max(0, Number(values?.total_scenes) || 0);
        const completed = Math.max(0, Math.min(total, Number(values?.completed_scenes) || 0));
        const failed = Math.max(0, Number(values?.failed_scenes) || 0);
        sceneProgress.hidden = total < 1;
        sceneCompleted.textContent = String(completed);
        sceneTotal.textContent = String(total);
        sceneFailed.hidden = failed < 1;
        sceneFailed.textContent = `실패 ${failed}`;
      };
      const labels = deps.getSelectedKeywordLabels();
      const requestStartedAt = deps.now();
      const formatElapsed = () => {
        const totalSeconds = Math.max(0, Math.floor((deps.now() - requestStartedAt) / 1000));
        return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
      };
      let activePhase = 0;
      const updateWaitingState = () => {
        const elapsed = formatElapsed();
        nowNode.textContent = `${activePhase === 0 ? '대본' : '콘티'} 작성 중 · ${elapsed}`;
        foot.textContent = `${activePhase + 1}차 요청 처리 중 · GPT 응답 대기 ${elapsed} · 창을 유지해 주세요.`;
        roles.forEach((role, index) => { if (index === activePhase) role.querySelector('.ai-role-state').textContent = `응답 대기 ${elapsed}`; });
      };
      modal.hidden = false;
      modal.classList.remove('complete');
      root.body.classList.add('modal-open');
      progress.classList.add('indeterminate');
      progress.style.transform = 'none';
      progress.style.width = '';
      summary.textContent = `${labels.join(', ')} 키워드로 실제 최종대본을 생성하고 있습니다.`;
      nowNode.classList.add('processing');
      nowNode.textContent = 'GPT에 최종대본 생성 요청을 전송하고 있습니다';
      foot.textContent = '요청 1건 전송 중 · 중복 요청은 차단됩니다.';
      updateSceneProgress(null);
      roles.forEach((role, index) => { role.className = `ai-role ${index === 0 ? 'active' : ''}`; role.querySelector('.ai-role-state').textContent = index === 0 ? '요청 전송' : '대기'; role.querySelector('.ai-role-result').textContent = ''; });
      updateWaitingState();
      let waitingTimer = deps.setInterval(updateWaitingState, 1000);
      const stopWaiting = () => { if (waitingTimer !== null) { deps.clearInterval(waitingTimer); waitingTimer = null; } };
      let terminalJob = false;
      try {
        if (!resumeJobId) await deps.request('/api/script/plan', {method:'POST',body:JSON.stringify({project_id:projectId})});
        roles[0].classList.remove('active'); roles[0].classList.add('done'); roles[0].querySelector('.ai-role-state').textContent = '저장 완료';
        activePhase = 1; roles[1].classList.add('active'); roles[1].querySelector('.ai-role-state').textContent = '요청 전송';
        progress.classList.remove('indeterminate'); progress.style.width = '33%';
        summary.textContent = resumeJobId ? '진행 중이던 대본·콘티 작업을 다시 연결했습니다.' : '1차 대본이 저장됐습니다. 장소 이동과 씬 연속성을 설계합니다.';
        const queued = resumeJobId ? {job_id:resumeJobId} : await deps.request('/api/script/jobs', {method:'POST',body:JSON.stringify({project_id:projectId})});
        deps.setPendingJob({project_id:projectId,job_id:queued.job_id});
        let generated = null;
        while (!generated) {
          await deps.sleep(1000);
          const job = await deps.request(`/api/script/job-status?job_id=${encodeURIComponent(queued.job_id)}`);
          const jobProgress = job.progress || {};
          const percent = Math.max(33, Math.min(99, Number(jobProgress.percent) || 33));
          progress.classList.remove('indeterminate'); progress.style.width = `${percent}%`;
          nowNode.textContent = `${jobProgress.detail || '대본·콘티 생성 중'} · ${formatElapsed()}`;
          const repairCount = Number(jobProgress.repair_count || 0);
          const regenerationCount = Number(jobProgress.regeneration_count || 0);
          updateSceneProgress(jobProgress);
          foot.textContent = `작업 ${job.job_id.slice(0,8)} · 시도 ${job.attempt} · 보정 ${repairCount}/3 · 신규 재생성 ${regenerationCount}/1`;
          roles[1].querySelector('.ai-role-state').textContent = `${jobProgress.phase || job.status} · ${percent}%`;
          if (job.status === 'failed') { terminalJob = true; throw new Error(job.error?.message || '대본 생성 작업이 실패했습니다.'); }
          if (job.status === 'cancelled') { terminalJob = true; throw new Error('대본 생성 작업이 취소됐습니다.'); }
          if (job.status === 'succeeded') { terminalJob = true; generated = job.response; }
        }
        deps.clearPendingJob();
        updateSceneProgress(generated.generation?.scene_review || {
          completed_scenes:generated.generation?.scene_count,
          total_scenes:generated.generation?.scene_count,
          failed_scenes:0
        });
        stopWaiting();
        roles[1].classList.remove('active'); roles[1].classList.add('done'); roles[1].querySelector('.ai-role-state').textContent = '완료';
        activePhase = 2; roles[2].classList.add('active'); progress.style.width = '66%';
        nowNode.textContent = 'GPT 응답 수신 완료 · 검증된 결과를 화면에 반영하고 있습니다';
        foot.textContent = `응답 수신 ${formatElapsed()} · 프로젝트 저장 완료 · 화면 구성 중`;
        roles[2].querySelector('.ai-role-state').textContent = '응답 수신';
        deps.setGeneratedState(generated.state);
        deps.setGeneratedTimeline(generated.timeline);
        deps.setGeneratedDocument(generated.document || null);
        deps.setKeywordLocked(true);
        deps.setVoiceProfile('warm_female');
        deps.applyTimeline(generated.timeline);
        progress.classList.remove('indeterminate'); progress.style.transform = 'none'; progress.style.width = '100%';
        roles.forEach(role => { role.classList.add('done'); role.querySelector('.ai-role-state').textContent = '완료'; });
        modal.classList.add('complete');
        nowNode.classList.remove('processing'); nowNode.textContent = '대본이 완료되었습니다.';
        summary.textContent = '스키마 검증과 프로젝트 저장이 완료되어 대본과 콘티 초안이 준비됐습니다.';
        foot.textContent = '1초 후 대본 화면으로 이동합니다.';
        await deps.sleep(1000);
        modal.hidden = true;
        root.body.classList.remove('modal-open');
        deps.removeStoredScript();
        deps.fillScript(generated.state.script);
        deps.applyScript(generated.state.script);
        await deps.refreshProjectIndex();
        deps.showStep(3);
      } catch (error) {
        stopWaiting();
        if (terminalJob) deps.clearPendingJob();
        progress.classList.remove('indeterminate'); progress.style.transform = 'none'; progress.style.width = '0%';
        nowNode.classList.remove('processing'); nowNode.textContent = '처리를 완료하지 못했습니다.';
        summary.textContent = '스토리보드 생성 중 문제가 발생했습니다.';
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
      if (!projectId) return Promise.reject(new Error('대본을 생성할 콘텐츠를 먼저 선택해 주세요.'));
      const pending = deps.getPendingJob();
      const jobId = pending?.project_id === projectId ? pending.job_id : null;
      activeRun = execute(projectId, jobId).finally(() => { activeRun = null; });
      return activeRun;
    }

    function resume() {
      if (activeRun) return activeRun;
      const projectId = deps.getActiveProjectId();
      const pending = deps.getPendingJob();
      if (!projectId || pending?.project_id !== projectId || !pending.job_id) return Promise.resolve(false);
      activeRun = execute(projectId, pending.job_id).finally(() => { activeRun = null; });
      return activeRun;
    }

    return Object.freeze({mount,unmount,run,resume,isRunning:()=>Boolean(activeRun)});
  }
  return Object.freeze({create});
});
