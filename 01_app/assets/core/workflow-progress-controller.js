(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ThinkCastWorkflowProgressController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const workflowConfigs = Object.freeze({
    export: Object.freeze({
      kicker: 'AI VIDEO & FINAL EXPORT TEAM',
      title: '최종 영상 제작 중',
      summary: '콘티에서 확정한 장면 미디어를 선택 설정으로 최종 파일에 합성하고 있습니다.',
      engines: Object.freeze([
        Object.freeze({mark: 'FF', kind: 'encoder', name: 'FFmpeg Worker', status: '내부 모듈'}),
        Object.freeze({mark: 'H', kind: 'internal', name: 'H.264 Encoder', status: '모바일 호환'}),
        Object.freeze({mark: 'SNS', kind: 'videoai', name: 'Platform Preset', status: '배포 규격'})
      ]),
      roles: Object.freeze([
        Object.freeze({name: '콘티 미디어 확정', description: '장면별 선택 이미지·영상 · 순서 · 타이밍 잠금', engine: 'Production Orchestrator'}),
        Object.freeze({name: '자막 PNG 생성', description: '선택한 자막 디자인을 문장별 투명 PNG로 렌더링', engine: 'Browser Caption Renderer'}),
        Object.freeze({name: '최종 영상 합성', description: '타임라인 조립 · 비율별 크롭 · H.264/AAC 모바일 호환 출력', engine: 'FFmpeg Worker · Platform Preset'}),
        Object.freeze({name: '배포 파일 등록', description: 'MP4 다운로드 파일 생성 · 콘텐츠 캘린더 기록', engine: 'Distribution Worker'})
      ])
    })
  });

  function requireText(value, label) {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(`Workflow config requires ${label}`);
    return value;
  }

  function validateConfig(config) {
    if (!config || typeof config !== 'object') throw new TypeError('Workflow config is required');
    requireText(config.kicker, 'kicker');
    requireText(config.title, 'title');
    requireText(config.summary, 'summary');
    if (!Array.isArray(config.engines) || !config.engines.length) throw new TypeError('Workflow config requires engines');
    if (!Array.isArray(config.roles) || !config.roles.length) throw new TypeError('Workflow config requires roles');
    config.engines.forEach((engine, index) => {
      requireText(engine?.mark, `engines[${index}].mark`);
      requireText(engine?.kind, `engines[${index}].kind`);
      requireText(engine?.name, `engines[${index}].name`);
      requireText(engine?.status, `engines[${index}].status`);
    });
    config.roles.forEach((role, index) => {
      requireText(role?.name, `roles[${index}].name`);
      requireText(role?.description, `roles[${index}].description`);
      requireText(role?.engine, `roles[${index}].engine`);
    });
    return config;
  }

  function create(dependencies) {
    const deps = dependencies || {};
    if (typeof deps.getRoot !== 'function') throw new TypeError('ThinkCastWorkflowProgressController requires getRoot');
    let mounted = false;
    let nodes = null;

    function mount() {
      if (mounted) return true;
      const document = deps.getRoot();
      if (!document || typeof document.querySelector !== 'function' || typeof document.createElement !== 'function') {
        throw new TypeError('ThinkCastWorkflowProgressController requires a DOM root');
      }
      const selectors = {
        modal: '#aiWorkflowModal',
        kicker: '#aiWorkflowKicker',
        title: '#aiWorkflowTitle',
        summary: '#aiWorkflowSummary',
        engines: '#aiEngines',
        roles: '#aiRoleList'
      };
      const resolved = {};
      Object.entries(selectors).forEach(([name, selector]) => {
        resolved[name] = document.querySelector(selector);
        if (!resolved[name]) throw new Error(`Workflow progress DOM missing ${selector}`);
      });
      resolved.document = document;
      nodes = resolved;
      mounted = true;
      return true;
    }

    function unmount() {
      if (!mounted) return false;
      nodes = null;
      mounted = false;
      return true;
    }

    function element(tag, className, text) {
      const node = nodes.document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function configure(type, override) {
      if (!mounted || !nodes) throw new Error('Workflow progress controller is not mounted');
      const config = validateConfig(override || workflowConfigs[type]);
      requireText(type, 'type');
      nodes.modal.dataset.workflow = type;

      const liveDot = element('span', 'ai-live-dot');
      nodes.kicker.replaceChildren(liveDot, nodes.document.createTextNode(config.kicker));
      nodes.title.textContent = config.title;
      nodes.summary.textContent = config.summary;

      const engineNodes = config.engines.map(engine => {
        const chip = element('span', 'ai-engine-chip');
        const mark = element('span', `ai-engine-mark ${engine.kind}`, engine.mark);
        const status = element('em', '', engine.status);
        chip.append(mark, nodes.document.createTextNode(engine.name + ' '), status);
        return chip;
      });
      nodes.engines.replaceChildren(...engineNodes);

      const roleNodes = config.roles.map((role, index) => {
        const item = element('li', 'ai-role');
        const number = element('span', 'ai-role-no', String(index + 1).padStart(2, '0'));
        const copy = element('div', 'ai-role-copy');
        copy.append(
          element('strong', '', role.name),
          element('small', '', role.description),
          element('span', 'ai-role-engine', role.engine),
          element('p', 'ai-role-result')
        );
        item.append(number, copy, element('span', 'ai-role-state', '대기'));
        return item;
      });
      nodes.roles.replaceChildren(...roleNodes);
      return nodes.modal;
    }

    return Object.freeze({mount, unmount, configure});
  }

  return Object.freeze({create});
});
