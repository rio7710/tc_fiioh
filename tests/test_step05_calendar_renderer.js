const assert = require('node:assert/strict');
const Calendar = require('../01_app/assets/steps/step05/step05-calendar.js');
const Renderer = require('../01_app/assets/steps/step05/step05-calendar-renderer.js');

(() => {
  const renderer = Renderer.create({
    dateKey: Calendar.dateKey,
    groupEntries: Calendar.groupCalendarEntries,
    statusTimestamp: Calendar.calendarStatusTimestamp,
    formatTime: Calendar.formatCalendarTime,
    minuteOfDay: Calendar.calendarMinuteOfDay,
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    statusLabels: {published: '배포 완료', scheduled: '배포 예약', draft: '미배포', deleted: '삭제·제거'},
    platformLabels: {youtube: 'YouTube', instagram: 'Instagram'},
    timeLabels: {published: '배포', scheduled: '예약', draft: '제작', deleted: '삭제'}
  });
  assert.equal(Object.isFrozen(renderer), true);
  assert.throws(() => Renderer.create(), /requires dateKey/);

  const item = (id, projectId, title, status, platform, contentUrl, time) => ({
    id, title, start: '2026-10-09',
    extendedProps: {projectId, status, platform, contentUrl, scheduledAt: time, createdAt: time}
  });
  const entries = [
    item('a<&', 'p1', '제목 <A>', 'scheduled', 'youtube', '/a.mp4', '2026-10-09T11:30:00+09:00'),
    item('a2', 'p1', '제목 <A>', 'published', 'instagram', null, '2026-10-09T09:00:00+09:00'),
    item('b', 'p2', 'B', 'draft', 'youtube', null, '2026-10-09T10:00:00+09:00'),
    item('c', 'p3', 'C', 'deleted', 'youtube', null, '2026-10-09T12:00:00+09:00')
  ];
  const before = JSON.stringify(entries);
  const month = renderer.render({view: 'month', cursor: new Date(2026, 9, 1, 12), entries, now: new Date(2026, 9, 9, 12)});
  assert.equal(Object.isFrozen(month), true);
  assert.equal(month.title, '2026. 10');
  assert.equal(month.className, 'calendar-grid view-month');
  assert.equal((month.html.match(/class="calendar-day /g) || []).length, 42);
  assert.match(month.html, /outside/);
  assert.match(month.html, /calendar-day[^>]*today[^>]*data-date="2026-10-09"/);
  assert.match(month.html, /외 1개/);
  assert.match(month.html, /data-status="published"/);
  assert.match(month.html, /data-media-ready="true"/);
  assert.match(month.html, /예약 11:30 · 배포 09:00/);
  assert.match(month.html, /제목 &lt;A&gt;/);
  assert.match(month.html, /data-group-id="a&lt;&amp;"/);
  assert.equal(JSON.stringify(entries), before, 'renderer does not mutate entries');

  const week = renderer.render({view: 'week', cursor: new Date(2026, 0, 1, 12), entries: [], now: new Date(2026, 0, 1, 12)});
  assert.equal(week.title, '2025. 12. 28 — 01. 03');
  assert.equal(week.calendarDays, '7');
  assert.equal((week.html.match(/calendar-time-column /g) || []).length, 7);
  const day = renderer.render({view: 'day', cursor: new Date(2026, 9, 9, 12), entries, now: new Date(2026, 9, 9, 12)});
  assert.equal(day.calendarDays, '1');
  assert.equal((day.html.match(/calendar-time-column /g) || []).length, 1);
  assert.match(day.html, /--event-top:468\.0px/, 'earliest grouped time controls event position');

  console.log('Step05 calendar renderer tests passed');
})();
