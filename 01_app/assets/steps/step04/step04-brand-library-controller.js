(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Step04BrandLibraryController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ROLE_LABELS = Object.freeze({intro: '인트로', outro: '아웃트로', watermark: '워터마크'});

  function create(dependencies) {
    const deps = dependencies || {};
    for (const name of ['request', 'isOutroRatioCompanion', 'openWatermarkPreview', 'openOutroPreview', 'readFileAsDataUrl', 'escapeHtml']) {
      if (typeof deps[name] !== 'function') throw new TypeError(`Step04BrandLibraryController requires ${name}`);
    }
    if (!deps.selectionController || typeof deps.selectionController.hydrate !== 'function' ||
      typeof deps.selectionController.getAssets !== 'function' || typeof deps.selectionController.renderChoices !== 'function') {
      throw new TypeError('Step04BrandLibraryController requires selectionController');
    }

    let mountedRoot = null;
    let listeners = [];

    function requireRoot() {
      if (!mountedRoot || typeof mountedRoot.querySelector !== 'function') {
        throw new Error('Step04BrandLibraryController is not mounted');
      }
      return mountedRoot;
    }

    function requireNode(selector) {
      const node = requireRoot().querySelector(selector);
      if (!node) throw new Error(`Step04BrandLibraryController missing ${selector}`);
      return node;
    }

    function show(visible) {
      const value = Boolean(visible);
      requireNode('#contentIndex').hidden = value;
      requireNode('#brandLibraryPanel').hidden = !value;
      requireNode('#brandLibraryOpen').classList.toggle('active', value);
    }

    async function refresh() {
      const result = await deps.request('/api/brand-assets');
      deps.selectionController.hydrate({assets: result.assets || [], selections: result.selections || []});
      const visibleAssets = deps.selectionController.getAssets().filter(item => !deps.isOutroRatioCompanion(item));
      requireNode('#brandVersionCount').textContent = String(visibleAssets.length).padStart(2, '0');
      requireNode('#brandLibraryList').innerHTML = visibleAssets.map(item => {
        const original = `/api/brand-asset?version_id=${encodeURIComponent(item.version_id)}`;
        const preview = item.role === 'watermark'
          ? `<i>|</i><button type="button" data-watermark-preview="${deps.escapeHtml(item.version_id)}">적용 미리보기</button>`
          : item.role === 'outro'
            ? `<i>|</i><button type="button" data-outro-preview="${deps.escapeHtml(item.version_id)}">적용 미리보기</button>`
            : '';
        return `<article class="brand-library-row"><strong>${deps.escapeHtml(ROLE_LABELS[item.role])}</strong><span>${deps.escapeHtml(item.name)} <small>v${item.version} · ${item.media_type === 'video' ? '영상' : '이미지'}</small></span><span class="brand-library-actions"><a href="${original}" target="_blank">원본 보기</a>${preview}</span></article>`;
      }).join('') || '<p class="flow-desc">등록된 개인 브랜드 리소스가 없습니다.</p>';
      deps.selectionController.renderChoices();
    }

    async function upload() {
      const message = requireNode('#brandLibraryMessage');
      const fileInput = requireNode('#brandUploadFile');
      const file = fileInput.files[0];
      if (!file) {
        message.textContent = '등록할 파일을 선택해 주세요.';
        return;
      }
      try {
        message.textContent = '업로드 중입니다.';
        const dataUrl = await deps.readFileAsDataUrl(file);
        await deps.request('/api/brand-assets/upload', {
          method: 'POST',
          body: JSON.stringify({
            role: requireNode('#brandUploadRole').value,
            name: requireNode('#brandUploadName').value,
            data_url: dataUrl
          })
        });
        fileInput.value = '';
        message.textContent = '새 버전을 등록했습니다.';
        await refresh();
      } catch (error) {
        message.textContent = error.message;
      }
    }

    function unmount() {
      listeners.forEach(({node, type, listener}) => node.removeEventListener(type, listener));
      listeners = [];
      mountedRoot = null;
    }

    function mount(rootNode) {
      if (mountedRoot) return true;
      if (!rootNode || typeof rootNode.querySelector !== 'function') throw new TypeError('Step04BrandLibraryController mount requires root');
      mountedRoot = rootNode;
      try {
        const open = requireNode('#brandLibraryOpen');
        const close = requireNode('#brandLibraryClose');
        const list = requireNode('#brandLibraryList');
        const uploadButton = requireNode('#brandUploadButton');
        const onOpen = async () => { show(true); await refresh(); };
        const onClose = () => show(false);
        const onList = event => {
          const watermarkButton = event.target.closest('[data-watermark-preview]');
          if (watermarkButton) {
            deps.openWatermarkPreview(watermarkButton.dataset.watermarkPreview);
            return;
          }
          const outroButton = event.target.closest('[data-outro-preview]');
          if (outroButton) deps.openOutroPreview(outroButton.dataset.outroPreview);
        };
        const onUpload = () => upload();
        [[open, 'click', onOpen], [close, 'click', onClose], [list, 'click', onList], [uploadButton, 'click', onUpload]].forEach(([node, type, listener]) => {
          node.addEventListener(type, listener);
          listeners.push({node, type, listener});
        });
        return true;
      } catch (error) {
        unmount();
        throw error;
      }
    }

    return Object.freeze({mount, unmount, refresh, show, upload});
  }

  return Object.freeze({create});
});
