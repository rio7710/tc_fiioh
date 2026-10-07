(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StepPartialLoader = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  async function readPartial(path, options) {
    const fetchImpl = options.fetchImpl;
    if (typeof fetchImpl === 'function') {
      const response = await fetchImpl(path);
      if (!response.ok) throw new Error(`단계 화면을 불러오지 못했습니다: ${path}`);
      return response.text();
    }
    if (typeof options.readFile === 'function') return options.readFile(path);
    throw new Error(`단계 화면 로더를 사용할 수 없습니다: ${path}`);
  }

  async function load(root, partials, options) {
    options = options || {};
    const fetchImpl = Object.prototype.hasOwnProperty.call(options, 'fetchImpl')
      ? options.fetchImpl
      : (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    let readFile = options.readFile;
    if (!fetchImpl && !readFile && typeof require === 'function' && typeof process !== 'undefined') {
      const fs = require('fs');
      const pathModule = require('path');
      readFile = path => fs.readFileSync(pathModule.resolve(path.replace(/^\//, '')), 'utf8');
    }
    const entries = await Promise.all(partials.map(async partial => ({
      ...partial,
      markup: await readPartial(partial.path, { fetchImpl, readFile })
    })));
    entries.forEach(entry => {
      const container = root.querySelector(entry.container);
      if (!container) throw new Error(`단계 화면 컨테이너가 없습니다: ${entry.container}`);
      container.innerHTML = entry.markup;
    });
    return entries.length;
  }

  return { load };
});
