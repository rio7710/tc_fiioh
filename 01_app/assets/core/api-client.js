(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ThinkCastApiClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_MESSAGES = Object.freeze({
    invalidSuccess: '서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.',
    invalidError: '서버가 준비 중입니다. 잠시 후 다시 시도해 주세요.',
    emptySuccess: '서버 응답이 비어 있습니다. 잠시 후 다시 시도해 주세요.',
    requestFailed: '요청을 처리하지 못했습니다.'
  });

  function isTransientStatus(status) {
    return status === 408 || status === 429 || status >= 500;
  }

  function requestError(message, status, transient) {
    const error = new Error(message);
    if (status !== undefined) error.status = status;
    error.transient = Boolean(transient);
    return error;
  }

  function createApiClient(options) {
    const settings = options || {};
    const fetchImpl = settings.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    const messages = Object.assign({}, DEFAULT_MESSAGES, settings.messages || {});
    if (!fetchImpl) throw new TypeError('fetch implementation is required');

    return async function api(path, requestOptions) {
      const supplied = requestOptions || {};
      const headers = Object.assign({'Content-Type': 'application/json'}, supplied.headers || {});
      let response;
      try {
        response = await fetchImpl(path, Object.assign({}, supplied, {
          headers,
          credentials: supplied.credentials || 'same-origin'
        }));
      } catch (error) {
        error.transient = true;
        throw error;
      }

      const responseText = await response.text();
      let result = {};
      if (responseText.trim()) {
        try {
          result = JSON.parse(responseText);
        } catch (_parseError) {
          throw requestError(
            response.ok ? messages.invalidSuccess : messages.invalidError,
            response.status,
            response.status >= 500
          );
        }
      }
      if (!responseText.trim() && response.ok) {
        throw requestError(messages.emptySuccess, response.status, true);
      }
      if (!response.ok) {
        throw requestError(result.error || messages.requestFailed, response.status, isTransientStatus(response.status));
      }
      return result;
    };
  }

  return {DEFAULT_MESSAGES, createApiClient, isTransientStatus};
});
