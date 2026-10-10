(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ThinkCastProviderUsageController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(dependencies) {
    const deps = dependencies || {};
    if (typeof deps.request !== 'function') throw new TypeError('ProviderUsageController requires request');
    if (typeof deps.onError !== 'function') throw new TypeError('ProviderUsageController requires onError');
    let nodes = null;
    let generation = 0;

    function formatNumber(value, maximumFractionDigits = 0) {
      const number = Number(value);
      return Number.isFinite(number)
        ? number.toLocaleString('ko-KR', {maximumFractionDigits})
        : '0';
    }

    function mount(rootNode) {
      if (!rootNode || typeof rootNode.querySelector !== 'function') throw new TypeError('ProviderUsageController requires a DOM root');
      nodes = Object.fromEntries(['providerUsageStrip', 'gptUsageMonth', 'gptUsageTotal', 'klingVideoUsage', 'klingImageUsage']
        .map(id => [id, rootNode.querySelector(`#${id}`)]));
      const missing = Object.entries(nodes).filter(([, node]) => !node).map(([id]) => `#${id}`);
      if (missing.length) throw new Error(`ProviderUsageController missing ${missing.join(', ')}`);
      return true;
    }

    function render(result) {
      if (!nodes) throw new Error('ProviderUsageController is not mounted');
      const month = result?.openai?.month || {};
      const total = result?.openai?.total || {};
      nodes.gptUsageMonth.textContent = `${formatNumber(month.total_tokens)} tokens`;
      nodes.gptUsageTotal.textContent = `누적 ${formatNumber(total.total_tokens)} · ${formatNumber(total.requests)}회`;
      const summary = result?.kling?.summary;
      if (result?.kling?.available && summary) {
        nodes.klingVideoUsage.textContent = `영상 ${formatNumber(summary.video?.used, 2)} / ${formatNumber(summary.video?.total, 2)} U`;
        nodes.klingImageUsage.textContent = `이미지 ${formatNumber(summary.image?.used, 2)} / ${formatNumber(summary.image?.total, 2)} U`;
      } else {
        nodes.klingVideoUsage.textContent = '사용량 조회 불가';
        nodes.klingImageUsage.textContent = result?.kling?.error || 'Kling API 연결을 확인해 주세요.';
      }
      nodes.providerUsageStrip.dataset.state = 'ready';
      return result;
    }

    async function refresh() {
      if (!nodes) return null;
      const current = ++generation;
      nodes.providerUsageStrip.dataset.state = 'loading';
      try {
        const result = await deps.request('/api/provider-usage');
        if (current !== generation) return null;
        return render(result);
      } catch (error) {
        if (current !== generation) return null;
        nodes.providerUsageStrip.dataset.state = 'error';
        nodes.gptUsageMonth.textContent = '조회 불가';
        nodes.gptUsageTotal.textContent = '사용량 API를 확인해 주세요.';
        nodes.klingVideoUsage.textContent = '조회 불가';
        nodes.klingImageUsage.textContent = 'Kling 연결을 확인해 주세요.';
        deps.onError(error);
        return null;
      }
    }

    return Object.freeze({mount, refresh, render});
  }

  return Object.freeze({create});
});
