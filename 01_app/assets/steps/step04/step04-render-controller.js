/* Step 04 final-render workflow controller. */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Step04RenderController = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(dependencies) {
    const d = dependencies || {};
    let running = false;
    const root = () => d.getRoot?.() || d.root || null;
    const query = selector => root()?.querySelector?.(selector) || null;

    async function start() {
      if (running) return undefined;
      running = true;
      const renderStatus = d.getRenderStatus?.() || query('#renderStatus');
      const renderBtn = d.getRenderButton?.() || query('#renderBtn');
      let renderPoll = null;
      try {
        if (d.getLocation?.()?.protocol === 'file:') {
          if (renderStatus) renderStatus.textContent = 'P1_미리보기_및_변환_실행.bat로 페이지를 열어주세요.';
          return undefined;
        }
        try { if (!await d.ensureStepApiReady(4)) return undefined; }
        catch (error) { if (renderStatus) renderStatus.textContent = `API 설정 확인 오류: ${error.message}`; return undefined; }
        try { await d.saveBrandSelections(); }
        catch (error) { if (renderStatus) renderStatus.textContent = `브랜드 설정 저장 오류: ${error.message}`; return undefined; }
        d.pausePreview?.();
        if (renderBtn) { renderBtn.disabled = true; renderBtn.setAttribute('aria-busy', 'true'); }
        if (renderStatus) renderStatus.textContent = '승인 이미지로 최종 영상을 제작하고 있습니다. 이 페이지를 닫지 마세요.';
        const modal = d.configureWorkflowModal('export');
        const roles = Array.from(modal.querySelectorAll('.ai-role'));
        const progress = query('#aiProgressBar');
        const foot = query('#aiFootStatus');
        const summary = query('#aiWorkflowSummary');
        const now = query('#aiNow');
        const actions = [
          '콘티에서 선택한 장면 미디어와 타이밍을 확정 중입니다',
          '선택한 디자인으로 문장별 투명 자막 PNG를 생성 중입니다',
          'FFmpeg Worker가 비율별 영상·자막·음성·BGM을 H.264/AAC로 최종 합성 중입니다',
          'MP4 파일을 등록하고 콘텐츠 캘린더에 기록 중입니다'
        ];
        const renderJobId = `render-${d.now()}-${d.random().toString(36).slice(2, 8)}`;
        const payload = d.getPayload(renderJobId);
        modal.hidden = false; modal.classList.remove('complete'); root().body?.classList.add('modal-open');
        progress.style.width = '0%'; now.classList.add('processing'); now.textContent = '영상 생성·최종 출력 워커를 호출하고 있습니다';
        roles.forEach(role => { role.className = 'ai-role'; role.querySelector('.ai-role-state').textContent = '대기'; });
        // Start the durable job before optional progress decoration. A broken
        // badge renderer must never prevent the actual export from reaching
        // the queue.
        const renderRequest = d.fetch('/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        try {
          d.setupCaptionProgressBadges(roles[1]);
          d.setupCompositeFormatBadges(roles[2]);
          d.setupSceneProgressBadges(roles[2], '장면별 최종 영상 합성 상태');
        } catch (decorationError) {
          d.onError?.(decorationError);
        }
        const captionBadgeTotal = roles[1].querySelectorAll('.scene-conversion-badge').length;
        try {
          const activate = index => {
            roles.forEach((role, roleIndex) => role.classList.toggle('active', roleIndex === index));
            roles[index].querySelector('.ai-role-state').textContent = '작업 중';
            now.textContent = actions[index]; foot.textContent = `${index + 1} / ${roles.length} 단계 처리 중`;
            progress.style.width = `${(index + .35) / roles.length * 100}%`;
          };
          const complete = index => {
            roles[index].classList.remove('active'); roles[index].classList.add('done');
            roles[index].querySelector('.ai-role-state').textContent = '완료'; progress.style.width = `${(index + 1) / roles.length * 100}%`;
          };
          const completeCaptionStage = async () => {
            if (roles[1].classList.contains('done')) return true;
            d.applySequentialCaptionProgress(roles[1], captionBadgeTotal);
            roles[1].querySelector('.ai-role-state').textContent = `${captionBadgeTotal} / ${captionBadgeTotal}`;
            await d.sleep(240);
            const allSucceeded = Array.from(roles[1].querySelectorAll('.scene-conversion-badge')).every(badge => badge.dataset.status === 'succeeded');
            if (!allSucceeded) return false;
            complete(1); activate(2); return true;
          };
          activate(0); await d.sleep(700); complete(0);
          activate(1); d.applySequentialCaptionProgress(roles[1], 0);
          d.applyCompositeFormatProgress(roles[2], 0);
          d.applySequentialSceneProgress(roles[2], 0);
          let renderPollBusy = false;
          const pollRenderProgress = async () => {
            if (renderPollBusy) return;
            renderPollBusy = true;
            try {
              const job = await d.api(`/api/render/status?job_id=${encodeURIComponent(renderJobId)}`);
              const jobProgress = Math.max(0, Math.min(1, Number(job.progress) || 0));
              const percent = Math.round(jobProgress * 100);
              const sceneCount = d.getScenes().length;
              const completedScenes = Math.max(0, Math.min(sceneCount, Number(job.completed_scenes) || 0));
              const sceneTotal = Number(job.scene_total) || sceneCount;
              if (job.phase === 'captions') {
                const completedCaptions = Math.max(0, Math.min(captionBadgeTotal, Number(job.completed_captions) || 0));
                d.applySequentialCaptionProgress(roles[1], completedCaptions); roles[1].querySelector('.ai-role-state').textContent = `${completedCaptions} / ${job.caption_total || captionBadgeTotal}`;
                progress.style.width = `${(1 + completedCaptions / Math.max(1, job.caption_total || captionBadgeTotal)) / roles.length * 100}%`;
                now.textContent = `자막 PNG 생성 중 · ${String(completedCaptions).padStart(2, '0')} / ${String(job.caption_total || captionBadgeTotal).padStart(2, '0')}`;
              } else if (job.phase === 'caption_ready' || job.phase === 'composite') {
                await completeCaptionStage();
                const formatIndex = Math.max(1, Number(job.format_index) || 1); const formatId = job.format_id || `${formatIndex}번 비율`;
                d.applyCompositeFormatProgress(roles[2], formatIndex);
                d.applySequentialSceneProgress(roles[2], completedScenes); roles[2].querySelector('.ai-role-state').textContent = `${completedScenes} / ${sceneTotal}`;
                progress.style.width = `${(2 + jobProgress) / roles.length * 100}%`;
                now.textContent = `FFmpeg Worker · ${formatId} (${formatIndex}/${job.format_total || 1}) 합성 중 · ${percent}% · 장면 ${String(completedScenes).padStart(2, '0')} / ${String(sceneTotal).padStart(2, '0')}`;
              } else { now.textContent = '자막 PNG 생성 작업을 준비하고 있습니다'; foot.textContent = '자막 작업 등록 대기 중'; }
              foot.textContent = job.detail || `장면 ${String(completedScenes).padStart(2, '0')} / ${String(sceneTotal).padStart(2, '0')} 완료 · ${job.rendered_seconds || 0}초 / ${d.timelineDuration()}초 처리 중`;
            } catch (error) { if (!String(error.message).includes('찾을 수 없습니다')) foot.textContent = '합성 진행률을 확인하고 있습니다.'; }
            finally { renderPollBusy = false; }
          };
          renderPoll = d.setInterval(pollRenderProgress, 500);
          let response;
          try {
            response = await renderRequest;
          } catch (requestError) {
            let recoveredResult = null;
            for (let attempt = 0; attempt < 1200; attempt++) {
              try {
                const job = await d.api(`/api/render/status?job_id=${encodeURIComponent(renderJobId)}`);
                if (job.status === 'succeeded' && job.response) { recoveredResult = job.response; break; }
                if (job.status === 'failed') throw new Error(job.detail || '변환에 실패했습니다.');
              } catch (statusError) { if (!String(statusError.message).includes('찾을 수 없습니다')) throw statusError; }
              await d.sleep(500);
            }
            if (!recoveredResult) throw requestError;
            response = { ok: true, json: async () => recoveredResult };
          } finally { if (renderPoll != null) { d.clearInterval(renderPoll); renderPoll = null; } }
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || '변환에 실패했습니다.');
          await completeCaptionStage();
          d.applyCompositeFormatProgress(roles[2], 0, true);
          d.applySequentialSceneProgress(roles[2], d.getScenes().length);
          if (!roles[2].classList.contains('done')) complete(2);
          activate(3); d.recordCurrentProduction(result); await d.sleep(700); complete(3);
          modal.classList.add('complete'); now.classList.remove('processing'); now.textContent = '배포 파일 준비가 완료되었습니다.';
          const exports = Array.isArray(result.exports) && result.exports.length ? result.exports : [{ filename: result.filename, url: result.url }];
          summary.textContent = `선택한 설정으로 출력 규격별 MP4 ${exports.length}개를 만들고 콘텐츠 캘린더에 기록했습니다.`;
          foot.textContent = '잠시 후 배포 캘린더로 이동합니다.';
          if (renderStatus) renderStatus.innerHTML = `완료: ${exports.map(item => { const platforms = Array.isArray(item.platforms) && item.platforms.length ? item.platforms : [item.platform]; const label = platforms.map(platform => d.platformLabels[platform] || platform).join('·'); return `<a class="export-link" href="${item.url}" download>${d.escapeHtml(label || '영상')} · ${d.escapeHtml(item.filename)}</a>`; }).join(' · ')}`;
          d.showLatestExport(result);
          await d.sleep(1200); modal.hidden = true; root().body?.classList.remove('modal-open'); d.showStep(5);
          return result;
        } catch (error) {
          now.classList.remove('processing'); now.textContent = '배포 파일을 준비하지 못했습니다.';
          summary.textContent = '최종 출력 워커 처리 중 문제가 발생했습니다.'; foot.textContent = error.message;
          if (renderStatus) renderStatus.textContent = `오류: ${error.message}`;
          const close = root()?.createElement?.('button');
          if (close) { close.type = 'button'; close.className = 'flow-btn'; close.textContent = '확인 후 닫기'; close.addEventListener('click', () => { modal.hidden = true; root().body?.classList.remove('modal-open'); }, { once: true }); foot.append(' ', close); }
          d.onError?.(error);
          return undefined;
        } finally {
          if (renderPoll != null) d.clearInterval(renderPoll);
          if (renderBtn) { renderBtn.disabled = false; renderBtn.removeAttribute('aria-busy'); renderBtn.textContent = '최종 영상 제작'; }
        }
      } finally { running = false; }
    }

    return { start, isRunning: () => running };
  }
  return { create };
}));
