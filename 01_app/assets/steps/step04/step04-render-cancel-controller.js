/* Final-render cancellation UI, isolated from the render workflow. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Step04RenderCancelController = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function bind(options) {
    const button = options.button;
    if (!button) return () => {};
    let busy = false;
    button.hidden = false;
    button.disabled = false;

    async function cancel() {
      if (busy || !options.confirm('현재 최종 영상 합성을 중지하시겠습니까?')) return;
      const jobId = String(options.getJobId() || '');
      if (!jobId) return;
      busy = true;
      button.disabled = true;
      options.onStatus('취소 요청을 전달하고 있습니다.');
      try {
        const result = await options.api('/api/render/cancel', {
          method: 'POST', body: JSON.stringify({ job_id: jobId })
        });
        options.onStatus(result.status === 'cancelled'
          ? '최종 영상 제작이 취소되었습니다.'
          : '현재 FFmpeg 작업을 안전하게 종료하고 있습니다.');
      } catch (error) {
        options.onStatus(error.message || '취소 요청을 처리하지 못했습니다.');
        button.disabled = false;
      } finally {
        busy = false;
      }
    }

    button.addEventListener('click', cancel);
    return () => {
      button.removeEventListener('click', cancel);
      button.hidden = true;
      button.disabled = false;
    };
  }

  return { bind };
}));
