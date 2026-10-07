/* Step 05 calendar state helpers. DOM binding remains in the shell until fragment loading is enabled. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Step05Calendar = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  function entryProps(entry) {
    return entry && typeof entry.extendedProps === 'object' && entry.extendedProps
      ? entry.extendedProps : {};
  }

  function contentIdentity(entry) {
    const props = entryProps(entry);
    return String(props.projectId || props.contentId || entry?.contentId || entry?.title || '');
  }

  function uniquenessKey(entry) {
    const props = entryProps(entry);
    return [contentIdentity(entry), String(entry?.start || ''), String(props.platform || 'youtube')].join('\u0000');
  }

  function timestamp(entry) {
    const props = entryProps(entry);
    const candidates = [props.updatedAt, props.distributedAt, props.scheduledAt, props.deletedAt, props.createdAt];
    for (const value of candidates) {
      const parsed = Date.parse(value || '');
      if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
  }

  function collapseDuplicates(entries) {
    const unique = new Map();
    (Array.isArray(entries) ? entries : []).forEach(entry => {
      if (!entry || !contentIdentity(entry) || !DATE_PATTERN.test(String(entry.start || ''))) return;
      const key = uniquenessKey(entry);
      const current = unique.get(key);
      if (!current || timestamp(entry) >= timestamp(current)) unique.set(key, entry);
    });
    return [...unique.values()];
  }

  function nextDateKey(value) {
    if (!DATE_PATTERN.test(String(value || ''))) return '';
    const date = new Date(`${value}T12:00:00`);
    date.setDate(date.getDate() + 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function shiftTimestampDate(value, nextDate) {
    if (!value || !DATE_PATTERN.test(String(nextDate || ''))) return value;
    const match = String(value).match(/T(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!match) return value;
    return `${nextDate}T${match[1]}:${match[2]}:${match[3] || '00'}+09:00`;
  }

  function moveContentGroup(entries, anchorId, nextDate) {
    const source = Array.isArray(entries) ? entries : [];
    if (!DATE_PATTERN.test(String(nextDate || ''))) return collapseDuplicates(source);
    const anchor = source.find(entry => String(entry?.id) === String(anchorId));
    if (!anchor) return collapseDuplicates(source);
    const identity = contentIdentity(anchor);
    const priorDate = anchor.start;
    const moved = source.map(entry => {
      if (contentIdentity(entry) !== identity || entry.start !== priorDate) return entry;
      const props = { ...entryProps(entry) };
      ['createdAt', 'scheduledAt', 'distributedAt', 'deletedAt', 'updatedAt'].forEach(key => {
        if (props[key]) props[key] = shiftTimestampDate(props[key], nextDate);
      });
      return { ...entry, start: nextDate, end: nextDateKey(nextDate), extendedProps: props };
    });
    return collapseDuplicates(moved);
  }

  function contentVersions(entry) {
    const props = entryProps(entry);
    const versions = [];
    const seen = new Set();
    const add = version => {
      if (!version?.url || seen.has(version.url)) return;
      seen.add(version.url);
      versions.push({ url: version.url, filename: version.filename || '', createdAt: version.createdAt || null });
    };
    (Array.isArray(props.contentVersions) ? props.contentVersions : []).forEach(add);
    add({ url: props.contentUrl, filename: props.filename, createdAt: props.createdAt });
    return versions;
  }

  function groupByContent(entries) {
    const groups = new Map();
    collapseDuplicates(entries).forEach(entry => {
      const key = contentIdentity(entry);
      if (!groups.has(key)) groups.set(key, { contentKey: key, title: entry.title, items: [] });
      groups.get(key).items.push(entry);
    });
    return [...groups.values()];
  }

  return { contentIdentity, uniquenessKey, collapseDuplicates, nextDateKey, shiftTimestampDate, moveContentGroup, contentVersions, groupByContent };
}));
