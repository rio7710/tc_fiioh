/* Step 04 DOM event bindings. Each feature binds independently. */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Step04UIBindings = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const boundRoots = typeof WeakSet === 'function' ? new WeakSet() : null;

  function bind(options) {
    const doc = options?.document;
    const root = options?.root;
    if (!doc || !root) return { bound: false, errors: [] };
    if (boundRoots?.has(root)) return { bound: true, errors: [] };

    const errors = [];
    const one = selector => doc.querySelector(selector);
    const all = selector => Array.from(doc.querySelectorAll(selector));
    const report = (feature, error) => {
      errors.push({ feature, error });
      console.error(`[Step04:${feature}]`, error);
      const status = one('#renderStatus');
      if (status && !status.textContent) status.textContent = `${feature} 기능 초기화 오류`;
    };
    const feature = (name, callback) => {
      try { callback(); } catch (error) { report(name, error); }
    };
    const invoke = (name, callback) => {
      try {
        const result = callback();
        if (result && typeof result.catch === 'function') result.catch(error => report(name, error));
      } catch (error) { report(name, error); }
    };

    feature('render', () => {
      one('#renderBtn')?.addEventListener('click', () => invoke('render', options.startRender));
    });

    feature('image-regeneration', () => {
      one('#imageRegenerateBtn')?.addEventListener('click', options.openImageRegeneration);
      one('#imageRegenerationCancel')?.addEventListener('click', options.closeImageRegeneration);
      one('#imageRegenerationCreate')?.addEventListener('click', options.requestImageRegeneration);
      const modal = one('#imageRegenerationModal');
      modal?.addEventListener('pointerdown', event => {
        if (event.target === modal) options.closeImageRegeneration();
      });
    });

    feature('distribution-help', () => {
      one('#distributionHelp')?.addEventListener('click', options.openDistributionHelp);
    });

    feature('brand-overlays', () => {
      all('#brandIntroEnabled,#brandIntroVersion,#brandOutroEnabled,#brandOutroVersion,#brandWatermarkEnabled,#brandWatermarkVersion,#brandWatermarkOpacity')
        .forEach(control => control.addEventListener('change', event => invoke('brand-overlays', () => options.brandChanged(event))));
    });

    feature('style', () => {
      all('.type-btn').forEach(button => button.addEventListener('click', () => {
        options.setType(button.dataset.type);
        options.persistRenderSettings();
      }));
      all('.music-btn[data-music]').forEach(button => button.addEventListener('click', () => {
        options.setMusic(button.dataset.music);
        options.persistRenderSettings();
      }));
    });

    feature('ratio', () => {
      const selectRatio = button => {
        const platform = button.dataset.platform || options.platformForRatio(button.dataset.ratio);
        options.setPlatformPreview(platform);
        options.persistRenderSettings();
      };
      all('.platform-preview-btn').forEach(button => button.addEventListener('click', () => selectRatio(button)));
      all('.ratio-btn').forEach(button => button.addEventListener('click', () => selectRatio(button)));
    });

    feature('captions', () => {
      one('#captionSizeDown')?.addEventListener('click', () => {
        options.setCaptionSize(options.getCaptionSize() - 1);
        options.persistRenderSettings();
      });
      one('#captionSizeUp')?.addEventListener('click', () => {
        options.setCaptionSize(options.getCaptionSize() + 1);
        options.persistRenderSettings();
      });
    });

    feature('narration', () => {
      one('#narrationBtn')?.addEventListener('click', () => {
        options.setNarration(!options.getNarrationEnabled());
        options.persistRenderSettings();
      });
    });

    feature('volume', () => {
      one('#musicVolume')?.addEventListener('input', event => {
        options.setCurrentVolume(Number(event.currentTarget.value));
        options.persistRenderSettings();
      });
    });

    feature('distribution', () => {
      all('.distribution-btn').forEach(button => button.addEventListener('click', () => {
        options.toggleDistribution(button.dataset.platform, button);
        options.persistRenderSettings();
      }));
    });

    boundRoots?.add(root);
    return { bound: true, errors };
  }

  return { bind };
}));
