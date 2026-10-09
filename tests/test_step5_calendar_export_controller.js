const assert = require('node:assert/strict');
const ExportController = require('../01_app/assets/steps/step05/step05-calendar-export-controller.js');
const Calendar = require('../01_app/assets/steps/step05/step05-calendar.js');

function buttonFixture() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    click() { for (const listener of listeners.get('click') || []) listener(); }
  };
}

function entry(id, projectId, title, start, platform, status, updatedAt = null) {
  return {
    id,
    title,
    start,
    end: Calendar.nextDateKey(start),
    extendedProps: {
      projectId,
      platform,
      status,
      createdAt: `${start}T09:00:00+09:00`,
      updatedAt
    }
  };
}

function harness(entries) {
  const button = buttonFixture();
  const blobs = [];
  const links = [];
  const timers = [];
  const revoked = [];
  const help = [];
  const fixedNow = new Date('2026-10-09T03:04:05.678Z');
  const controller = ExportController.create({
    button,
    getEntries: () => entries,
    contentIdentity: Calendar.contentIdentity,
    collapseDuplicates: Calendar.collapseDuplicates,
    nextDateKey: Calendar.nextDateKey,
    dateKey: Calendar.dateKey,
    icsEscape: Calendar.icsEscape,
    statusLabels: {draft: '미배포', scheduled: '배포 예약', published: '배포 완료', deleted: '삭제·제거'},
    now: () => fixedNow,
    createBlob(parts, options) { const blob = {parts, options}; blobs.push(blob); return blob; },
    createObjectURL(blob) { assert.equal(blob, blobs.at(-1)); return 'blob:calendar'; },
    revokeObjectURL(url) { revoked.push(url); },
    createLink() {
      const link = {href: '', download: '', clicks: 0, click() { this.clicks += 1; }};
      links.push(link);
      return link;
    },
    setTimer(callback, delay) { timers.push({callback, delay}); },
    setHelp(text) { help.push(text); }
  });
  return {controller, button, blobs, links, timers, revoked, help, fixedNow};
}

assert.throws(() => ExportController.create({}), /requires button/);

const source = [
  entry('a-old', 'project-a', '제목, 하나; 줄\n둘', '2026-10-09', 'youtube', 'published', '2026-10-09T09:00:00+09:00'),
  entry('a-new', 'project-a', '제목, 하나; 줄\n둘', '2026-10-09', 'youtube', 'published', '2026-10-09T10:00:00+09:00'),
  entry('a-instagram', 'project-a', '제목, 하나; 줄\n둘', '2026-10-09', 'instagram', 'published'),
  entry('b', 'project-b', '제목, 하나; 줄\n둘', '2026-10-09', 'youtube', 'deleted'),
  entry('c-youtube', 'project-c', '혼합', '2026-12-31', 'youtube', 'scheduled'),
  entry('c-instagram', 'project-c', '혼합', '2026-12-31', 'instagram', 'published'),
  entry('invalid-date', 'project-invalid', 'invalid', '2026-02-31', 'youtube', 'draft'),
  entry('invalid-identity', '', '', '2026-10-09', 'youtube', 'draft')
];
const snapshot = JSON.stringify(source);
const fixture = harness(source);
const content = fixture.controller.build(source, fixture.fixedNow);
assert.ok(content.startsWith('\ufeffBEGIN:VCALENDAR\r\n'));
assert.ok(content.endsWith('END:VCALENDAR'));
assert.equal((content.match(/BEGIN:VEVENT/g) || []).length, 3, 'same-title projects remain separate and invalid entries are excluded');
assert.equal((content.match(/UID:a-new@greenhill-content-demo/g) || []).length, 1, 'canonical duplicate collapse keeps newest platform entry');
assert.doesNotMatch(content, /UID:a-old@/);
assert.match(content, /STATUS:CONFIRMED/);
assert.match(content, /STATUS:CANCELLED/);
assert.match(content, /STATUS:TENTATIVE/);
assert.match(content, /DTSTAMP:20261009T030405Z/);
assert.match(content, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/);
assert.match(content, /SUMMARY:제목\\, 하나\\; 줄\\n둘/);
assert.match(content, /DESCRIPTION:youtube: 배포 완료\\ninstagram: 배포 완료/);
assert.match(content, /CATEGORIES:GREENHILL,YOUTUBE,INSTAGRAM/);
assert.equal(JSON.stringify(source), snapshot, 'source entries remain immutable');

const longTitle = '한글콘텐츠'.repeat(30);
const foldedFixture = harness([entry('long', 'long-project', longTitle, '2026-10-09', 'youtube', 'draft')]);
const folded = foldedFixture.controller.build(foldedFixture.controller ? [entry('long', 'long-project', longTitle, '2026-10-09', 'youtube', 'draft')] : []);
const physicalLines = folded.slice(1).split('\r\n');
physicalLines.forEach(line => {
  assert.ok(new TextEncoder().encode(line).length <= 75, `folded line exceeds 75 octets: ${line}`);
});
const unfolded = folded.slice(1).replace(/\r\n /g, '');
assert.match(unfolded, new RegExp(`SUMMARY:${longTitle}`), 'UTF-8 folding round-trips without splitting characters');

assert.equal(fixture.controller.mount(), true);
assert.equal(fixture.controller.mount(), true);
assert.equal(fixture.button.listeners.get('click').size, 1);
fixture.button.click();
assert.equal(fixture.links.length, 1);
assert.equal(fixture.links[0].clicks, 1);
assert.equal(fixture.links[0].href, 'blob:calendar');
assert.equal(fixture.links[0].download, 'greenhill-content-calendar-2026-10-09.ics');
assert.deepEqual(fixture.blobs[0].options, {type: 'text/calendar;charset=utf-8'});
assert.equal(fixture.blobs[0].parts[0][0], '\ufeff');
assert.equal(fixture.timers[0].delay, 1000);
fixture.timers[0].callback();
assert.deepEqual(fixture.revoked, ['blob:calendar']);
assert.deepEqual(fixture.help, ['Google·Apple·Outlook 캘린더에서 가져올 수 있는 .ics 파일을 저장했습니다.']);
assert.equal(fixture.controller.unmount(), true);
assert.equal(fixture.controller.unmount(), false);
fixture.button.click();
assert.equal(fixture.links.length, 1, 'unmount removes export listener');

console.log('Step 5 calendar export controller tests passed.');
