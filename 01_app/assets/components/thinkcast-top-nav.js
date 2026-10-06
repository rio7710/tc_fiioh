class ThinkcastTopNav extends HTMLElement {
  connectedCallback() {
    const workflow = this.getAttribute('mode') === 'workflow';
    const current = this.getAttribute('current') || '1';
    const steps = [
      {id: '1', number: '01', label: 'LOGIN'},
      {id: 'index', number: '01-1', label: 'INDEX', authOnly: true},
      {id: '2', number: '02', label: 'KEYWORD'},
      {id: '3', number: '03', label: 'SCRIPT'},
      {id: '4', number: '04', label: 'VIDEO'},
      {id: '5', number: '05', label: 'CALENDAR'},
    ];
    const currentIndex = steps.findIndex(step => step.id === current);
    const stepItems = steps.map((step, index) => {
      const state = step.id === current ? ' active' : index < currentIndex && workflow ? ' done' : '';
      const body = `<span class="step-dot">${step.number}</span><span class="step-label">${step.label}</span>`;
      const authOnly = step.authOnly ? ' data-auth-only hidden' : '';
      return workflow
        ? `<li${authOnly}><button class="step-item${state}" type="button" data-step="${step.id}" aria-current="${step.id === current ? 'step' : 'false'}">${body}</button></li>`
        : `<li${authOnly}><a class="step-item${state}" href="/01_app/P1_title_design_preview.html#${step.id === 'index' ? 'index' : `step${step.id}`}">${body}</a></li>`;
    }).join('');
    this.innerHTML = `<div class="app-top">
      <a class="brand" href="/01_app/P1_title_design_preview.html" aria-label="생각담 데모로 돌아가기"><img class="brand-logo" src="/01_app/assets/brand/thinkcast-user-logo-inverse.png" alt="생각담 ThinkCast"></a>
      <nav class="step-nav" aria-label="생각담 메뉴">
        <ol class="steps" aria-label="콘텐츠 제작 단계">${stepItems}</ol>
      </nav>
    </div>`;
    if (workflow) {
      this.querySelectorAll('[data-step]').forEach(item => item.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('thinkcast-step-change', {bubbles: true, detail: {step: item.dataset.step}}));
      }));
    }
  }

  setActive(step) {
    const activeId = String(step);
    this.setAttribute('current', activeId);
    const items = [...this.querySelectorAll('[data-step]')];
    const activeIndex = items.findIndex(item => item.dataset.step === activeId);
    items.forEach((item, index) => {
      const active = item.dataset.step === activeId;
      item.classList.toggle('active', active);
      item.classList.toggle('done', activeIndex >= 0 && index < activeIndex);
      item.setAttribute('aria-current', active ? 'step' : 'false');
    });
  }

  setLoggedIn(enabled) {
    this.querySelectorAll('[data-auth-only]').forEach(item => { item.hidden = !enabled; });
  }
}

customElements.define('thinkcast-top-nav', ThinkcastTopNav);
