(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Step05CalendarPresentationController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(dependencies) {
    const deps = dependencies || {};
    const eventNodes = ['prevButton', 'nextButton'];
    eventNodes.forEach(name => {
      const node = deps[name];
      if (!node || typeof node.addEventListener !== 'function' || typeof node.removeEventListener !== 'function') {
        throw new TypeError(`Step05CalendarPresentationController requires ${name}`);
      }
    });
    if (!Array.isArray(deps.viewButtons) || deps.viewButtons.some(button => (
      !button || typeof button.addEventListener !== 'function' || typeof button.removeEventListener !== 'function'
    ))) throw new TypeError('Step05CalendarPresentationController requires viewButtons');
    ['grid', 'scroller', 'title'].forEach(name => {
      if (!deps[name] || typeof deps[name] !== 'object') throw new TypeError(`Step05CalendarPresentationController requires ${name}`);
    });
    if (!deps.grid.style || typeof deps.grid.style.setProperty !== 'function' || typeof deps.grid.style.removeProperty !== 'function') {
      throw new TypeError('Step05CalendarPresentationController requires grid style');
    }
    if (!deps.scroller.classList || typeof deps.scroller.classList.toggle !== 'function') {
      throw new TypeError('Step05CalendarPresentationController requires scroller classList');
    }
    if (deps.viewButtons.some(button => typeof button.setAttribute !== 'function')) {
      throw new TypeError('Step05CalendarPresentationController requires view button attributes');
    }
    if (!deps.viewController || ['snapshot', 'load', 'save', 'move', 'selectView', 'selectDate'].some(name => typeof deps.viewController[name] !== 'function')) {
      throw new TypeError('Step05CalendarPresentationController requires viewController');
    }
    if (!deps.renderer || typeof deps.renderer.render !== 'function') throw new TypeError('Step05CalendarPresentationController requires renderer');
    ['getEntries', 'now', 'requestFrame', 'cancelFrame', 'getPageScroll', 'scrollWindow'].forEach(name => {
      if (typeof deps[name] !== 'function') throw new TypeError(`Step05CalendarPresentationController requires ${name}`);
    });

    let mounted = false;
    let pendingFrame = null;

    function cancelPendingFrame() {
      if (pendingFrame === null) return;
      deps.cancelFrame(pendingFrame);
      pendingFrame = null;
    }

    function load() {
      return deps.viewController.load();
    }

    function render(options = {}) {
      cancelPendingFrame();
      const preserveScroll = options.preserveScroll === true;
      const snapshot = deps.viewController.snapshot();
      const page = deps.getPageScroll();
      const previous = {
        top: deps.scroller.scrollTop,
        left: deps.scroller.scrollLeft,
        pageX: page.x,
        pageY: page.y
      };
      const entries = deps.getEntries();
      const current = deps.now();
      const model = deps.renderer.render({
        view: snapshot.view,
        cursor: snapshot.cursor,
        entries,
        now: current
      });
      deps.viewButtons.forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.calendarView === snapshot.view));
      });
      deps.scroller.classList.toggle('time-scroll', model.timeScroll);
      deps.grid.className = model.className;
      deps.title.textContent = model.title;
      if (model.calendarDays == null) deps.grid.style.removeProperty('--calendar-days');
      else deps.grid.style.setProperty('--calendar-days', model.calendarDays);
      deps.grid.innerHTML = model.html;
      if (preserveScroll) {
        deps.scroller.scrollTop = previous.top;
        deps.scroller.scrollLeft = previous.left;
        deps.scrollWindow(previous.pageX, previous.pageY);
        const restore = () => {
          pendingFrame = null;
          deps.scroller.scrollTop = previous.top;
          deps.scroller.scrollLeft = previous.left;
          deps.scrollWindow(previous.pageX, previous.pageY);
        };
        pendingFrame = deps.requestFrame(restore);
      } else if (snapshot.view !== 'month' && deps.scroller.scrollTop === 0) {
        deps.scroller.scrollTop = 8 * 52;
      }
      deps.viewController.save();
      return model;
    }

    function move(direction) {
      deps.viewController.move(direction);
      return render();
    }

    function selectView(view) {
      deps.viewController.selectView(view);
      return render();
    }

    function selectDate(date) {
      deps.viewController.selectDate(date);
      return render();
    }

    function onPrevious() { move(-1); }
    function onNext() { move(1); }
    const viewListeners = deps.viewButtons.map(button => [button, () => selectView(button.dataset.calendarView)]);

    function mount() {
      if (mounted) return true;
      deps.prevButton.addEventListener('click', onPrevious);
      deps.nextButton.addEventListener('click', onNext);
      viewListeners.forEach(([button, listener]) => button.addEventListener('click', listener));
      mounted = true;
      return true;
    }

    function unmount() {
      const wasMounted = mounted;
      if (mounted) {
        deps.prevButton.removeEventListener('click', onPrevious);
        deps.nextButton.removeEventListener('click', onNext);
        viewListeners.forEach(([button, listener]) => button.removeEventListener('click', listener));
      }
      cancelPendingFrame();
      mounted = false;
      return wasMounted;
    }

    return Object.freeze({mount, unmount, load, render, move, selectView, selectDate});
  }

  return Object.freeze({create});
});
