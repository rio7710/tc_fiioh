/* Durable final-render submission and terminal-status recovery. */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Step04RenderJobClient = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  async function body(response) {
    const payload = await response.json();
    if (!response.ok) {
      const error = new Error(payload?.error || '변환 작업을 등록하지 못했습니다.');
      error.keepPending = false;
      throw error;
    }
    return payload;
  }

  function terminalError(job) {
    return job?.error?.message || job?.detail || (
      job?.status === 'cancelled' ? '최종 영상 제작이 취소되었습니다.' : '최종 영상 제작에 실패했습니다.'
    );
  }

  async function poll(options, jobId, requestError) {
    const attempts = Math.max(1, Number(options.maxAttempts) || 1200);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const job = await options.api(`/api/render/status?job_id=${encodeURIComponent(jobId)}`);
        options.onStatus?.(job);
        if (job.status === 'succeeded' && job.response) return job.response;
        if (job.status === 'failed' || job.status === 'cancelled') {
          const error = new Error(terminalError(job)); error.keepPending = false; throw error;
        }
      } catch (error) {
        if (!String(error.message).includes('찾을 수 없습니다')) throw error;
      }
      await options.sleep(500);
    }
    if (requestError) { requestError.keepPending = true; throw requestError; }
    const timeout = new Error('최종 영상 작업 상태 확인 시간이 초과되었습니다.');
    timeout.keepPending = true;
    throw timeout;
  }

  async function resolve(options) {
    let response;
    try {
      response = await options.request;
    } catch (requestError) {
      return poll(options, options.jobId, requestError);
    }
    const payload = await body(response);
    if (response.status !== 202 && !payload.status_url) return payload;
    const acceptedJobId = String(payload.job_id || options.jobId);
    options.onAccepted?.(acceptedJobId, payload);
    return poll(options, acceptedJobId);
  }

  return { resolve };
}));
