(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Step05CalendarRenderer = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(dependencies) {
    const deps = dependencies || {};
    for (const name of ['dateKey', 'groupEntries', 'statusTimestamp', 'formatTime', 'minuteOfDay', 'escapeHtml']) {
      if (typeof deps[name] !== 'function') throw new TypeError(`Step05CalendarRenderer requires ${name}`);
    }
    for (const name of ['statusLabels', 'platformLabels', 'timeLabels']) {
      if (!deps[name] || typeof deps[name] !== 'object') throw new TypeError(`Step05CalendarRenderer requires ${name}`);
    }

    function stickers(entries, limit = Infinity) {
      const groups = deps.groupEntries(entries);
      const visible = groups.slice(0, limit);
      const html = visible.map((group, itemIndex) => {
        const statuses = group.items.map(item => item.extendedProps?.status || 'draft');
        const aggregate = statuses.every(status => status === 'deleted') ? 'deleted'
          : statuses.includes('published') ? 'published'
            : statuses.includes('scheduled') ? 'scheduled' : 'draft';
        const icons = group.items.map(item => {
          const status = item.extendedProps?.status || 'draft';
          const platform = item.extendedProps?.platform || 'youtube';
          const label = deps.statusLabels[status] || deps.statusLabels.draft;
          const mediaReady = Boolean(item.extendedProps?.contentUrl);
          const readiness = mediaReady ? '영상 제작 완료' : '영상 없음';
          return `<span class="calendar-platform-state" data-status="${status}" data-media-ready="${mediaReady}" title="${deps.platformLabels[platform] || platform} · ${readiness} · ${label}"><span class="calendar-platform" data-platform="${platform}" aria-label="${readiness} · ${label}"></span></span>`;
        }).join('');
        const times = group.items.map(item => `${deps.timeLabels[item.extendedProps?.status || 'draft']} ${deps.formatTime(deps.statusTimestamp(item))}`).join(' · ');
        const mediaReady = group.items.some(item => Boolean(item.extendedProps?.contentUrl));
        const readiness = mediaReady ? '영상 제작 완료' : '영상 없음';
        return `<div class="calendar-sticker" draggable="true" data-group-id="${deps.escapeHtml(group.items[0].id)}" data-status="${aggregate}" data-media-ready="${mediaReady}" title="${deps.escapeHtml(group.title)} · ${readiness} · ${deps.statusLabels[aggregate]} · 드래그하여 날짜 이동 · 우클릭하여 설정" style="--sticker-tilt:${itemIndex % 2 ? '.35deg' : '-.3deg'}"><span class="calendar-event-copy"><span class="calendar-event-title">${deps.escapeHtml(group.title)}</span><time class="calendar-event-time">${deps.escapeHtml(times)}</time></span><span class="calendar-platforms">${icons}</span></div>`;
      }).join('');
      return {html, extra: Math.max(0, groups.length - visible.length)};
    }

    function dayMarkup(date, entries, now, {outside = false, limit = Infinity} = {}) {
      const key = deps.dateKey(date);
      const rendered = stickers(entries.filter(item => item.start === key), limit);
      const more = rendered.extra ? `<button class="calendar-more" type="button" data-date="${key}">외 ${rendered.extra}개</button>` : '';
      return `<div class="calendar-day ${outside ? 'outside' : ''} ${key === deps.dateKey(now) ? 'today' : ''}" data-date="${key}"><span class="calendar-day-number">${date.getDate()}</span><div class="calendar-events">${rendered.html}${more}</div></div>`;
    }

    function timeGrid(dates, entries, now) {
      const headers = dates.map(date => `<span>${date.toLocaleDateString('ko-KR', {month: 'numeric', day: 'numeric', weekday: 'short'})}</span>`).join('');
      const hours = Array.from({length: 24}, (_, hour) => `<span class="calendar-hour-label">${String(hour).padStart(2, '0')}:00</span>`).join('');
      const columns = dates.map(date => {
        const key = deps.dateKey(date);
        const groups = deps.groupEntries(entries.filter(item => item.start === key));
        const events = groups.map(group => {
          const minute = Math.min(...group.items.map(deps.minuteOfDay));
          return `<div class="calendar-timed-event" style="--event-top:${(minute * 52 / 60).toFixed(1)}px">${stickers(group.items).html}</div>`;
        }).join('');
        return `<div class="calendar-time-column ${key === deps.dateKey(now) ? 'today' : ''}" data-date="${key}">${events}</div>`;
      }).join('');
      return `<div class="calendar-time-head"><span class="time-zone">24H</span>${headers}</div><div class="calendar-time-body"><div class="calendar-hour-axis">${hours}</div><div class="calendar-time-columns">${columns}</div></div>`;
    }

    function render({view, cursor, entries, now}) {
      const safeCursor = new Date(cursor);
      const safeNow = new Date(now);
      const source = Array.isArray(entries) ? entries : [];
      if (view === 'month') {
        const year = safeCursor.getFullYear();
        const month = safeCursor.getMonth();
        const cells = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map(day => `<div class="calendar-weekday">${day}</div>`);
        const first = new Date(year, month, 1);
        const gridStart = new Date(year, month, 1 - first.getDay());
        for (let index = 0; index < 42; index += 1) {
          const date = new Date(gridStart);
          date.setDate(gridStart.getDate() + index);
          cells.push(dayMarkup(date, source, safeNow, {outside: date.getMonth() !== month, limit: 2}));
        }
        return Object.freeze({title: `${year}. ${String(month + 1).padStart(2, '0')}`, className: 'calendar-grid view-month', html: cells.join(''), calendarDays: null, timeScroll: false});
      }
      if (view === 'week') {
        const start = new Date(safeCursor); start.setDate(start.getDate() - start.getDay());
        const end = new Date(start); end.setDate(end.getDate() + 6);
        const dates = Array.from({length: 7}, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date; });
        return Object.freeze({title: `${start.getFullYear()}. ${String(start.getMonth() + 1).padStart(2, '0')}. ${String(start.getDate()).padStart(2, '0')} — ${String(end.getMonth() + 1).padStart(2, '0')}. ${String(end.getDate()).padStart(2, '0')}`, className: 'calendar-time-grid view-week', html: timeGrid(dates, source, safeNow), calendarDays: '7', timeScroll: true});
      }
      return Object.freeze({title: safeCursor.toLocaleDateString('ko-KR', {year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long'}), className: 'calendar-time-grid view-day', html: timeGrid([safeCursor], source, safeNow), calendarDays: '1', timeScroll: true});
    }

    return Object.freeze({render});
  }

  return Object.freeze({create});
});
