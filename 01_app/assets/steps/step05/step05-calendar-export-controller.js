(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Step05CalendarExportController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  function create(dependencies) {
    const deps = dependencies || {};
    if (!deps.button || typeof deps.button.addEventListener !== 'function' || typeof deps.button.removeEventListener !== 'function') {
      throw new TypeError('Step05CalendarExportController requires button');
    }
    const requiredFunctions = [
      'getEntries', 'contentIdentity', 'collapseDuplicates', 'nextDateKey', 'dateKey',
      'icsEscape', 'now', 'createBlob', 'createObjectURL', 'revokeObjectURL',
      'createLink', 'setTimer', 'setHelp'
    ];
    requiredFunctions.forEach(name => {
      if (typeof deps[name] !== 'function') throw new TypeError(`Step05CalendarExportController requires ${name}`);
    });
    if (!deps.statusLabels || typeof deps.statusLabels !== 'object') throw new TypeError('Step05CalendarExportController requires statusLabels');

    let mounted = false;

    function timestamp(date) {
      return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    }

    function foldLine(line) {
      const chunks = [];
      let chunk = '';
      let chunkBytes = 0;
      let capacity = 75;
      for (const character of String(line)) {
        const bytes = new TextEncoder().encode(character).length;
        if (chunk && chunkBytes + bytes > capacity) {
          chunks.push(chunk);
          chunk = '';
          chunkBytes = 0;
          capacity = 74;
        }
        chunk += character;
        chunkBytes += bytes;
      }
      chunks.push(chunk);
      return chunks.map((value, index) => index === 0 ? value : ` ${value}`).join('\r\n');
    }

    function build(entries, current = deps.now()) {
      const source = Array.isArray(entries) ? entries : [];
      const valid = deps.collapseDuplicates(source).filter(entry => (
        entry
        && DATE_PATTERN.test(String(entry.start || ''))
        && deps.dateKey(new Date(`${entry.start}T12:00:00`)) === entry.start
        && deps.contentIdentity(entry)
        && deps.nextDateKey(entry.start)
      ));
      const groups = [];
      const byKey = new Map();
      valid.forEach(entry => {
        const key = `${deps.contentIdentity(entry)}\u0000${entry.start}`;
        let group = byKey.get(key);
        if (!group) {
          group = {start: entry.start, title: entry.title, items: []};
          byKey.set(key, group);
          groups.push(group);
        }
        group.items.push(entry);
      });

      const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Greenhill Content Studio//Content Calendar//KO',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:그린힐 콘텐츠 배포 캘린더'
      ];
      const stamp = timestamp(current);
      groups.forEach(group => {
        const statuses = group.items.map(item => item.extendedProps?.status || 'draft');
        const status = statuses.every(value => value === 'published')
          ? 'CONFIRMED'
          : statuses.every(value => value === 'deleted')
            ? 'CANCELLED'
            : 'TENTATIVE';
        const platforms = group.items.map(item => item.extendedProps?.platform || '미지정');
        const platformStates = group.items.map(item => {
          const platform = item.extendedProps?.platform || '미지정';
          const itemStatus = item.extendedProps?.status || 'draft';
          return `${platform}: ${deps.statusLabels[itemStatus]}`;
        }).join('\n');
        lines.push(
          'BEGIN:VEVENT',
          `UID:${deps.icsEscape(group.items[0].id)}@greenhill-content-demo`,
          `DTSTAMP:${stamp}`,
          `DTSTART;VALUE=DATE:${group.start.replaceAll('-', '')}`,
          `DTEND;VALUE=DATE:${deps.nextDateKey(group.start).replaceAll('-', '')}`,
          `SUMMARY:${deps.icsEscape(group.title)}`,
          `STATUS:${status}`,
          `DESCRIPTION:${deps.icsEscape(platformStates)}`,
          `CATEGORIES:GREENHILL,${platforms.map(item => deps.icsEscape(String(item).toUpperCase())).join(',')}`,
          `X-GREENHILL-PLATFORM-STATUS:${deps.icsEscape(platformStates.replaceAll('\n', ','))}`,
          'END:VEVENT'
        );
      });
      lines.push('END:VCALENDAR');
      return `\ufeff${lines.map(foldLine).join('\r\n')}`;
    }

    function exportCalendar() {
      const current = deps.now();
      const content = build(deps.getEntries(), current);
      const blob = deps.createBlob([content], {type: 'text/calendar;charset=utf-8'});
      const url = deps.createObjectURL(blob);
      const link = deps.createLink();
      link.href = url;
      link.download = `greenhill-content-calendar-${deps.dateKey(current)}.ics`;
      link.click();
      deps.setTimer(() => deps.revokeObjectURL(url), 1000);
      deps.setHelp('Google·Apple·Outlook 캘린더에서 가져올 수 있는 .ics 파일을 저장했습니다.');
      return {content, blob, url, filename: link.download};
    }

    function mount() {
      if (mounted) return true;
      deps.button.addEventListener('click', exportCalendar);
      mounted = true;
      return true;
    }

    function unmount() {
      if (!mounted) return false;
      deps.button.removeEventListener('click', exportCalendar);
      mounted = false;
      return true;
    }

    return Object.freeze({mount, unmount, build, serialize: build, export: exportCalendar});
  }

  return Object.freeze({create});
});
