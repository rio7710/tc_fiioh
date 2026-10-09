const assert = require('node:assert/strict');
const fs = require('node:fs');

const partialPath = '01_app/pages/steps/step05-calendar.html';
const cssPath = '01_app/assets/steps/step05/step05-calendar.css';
const jsPath = '01_app/assets/steps/step05/step05-calendar.js';
[partialPath, cssPath, jsPath].forEach(file => assert.ok(fs.existsSync(file), `${file} must exist`));

const html = fs.readFileSync(partialPath, 'utf8');
const shell = fs.readFileSync('01_app/P1_title_design_preview.html', 'utf8');
const projectHydration = fs.readFileSync('01_app/assets/core/project-hydration-controller.js', 'utf8');
[
  'step5', 'latestExport', 'latestExportList', 'calendarPrev', 'calendarMonthTitle',
  'calendarNext', 'calendarExport', 'calendarGrid', 'calendarHelp', 'calendarSettingsModal',
  'calendarSettingsTitle', 'calendarSettingsDate', 'calendarSettingsPlatforms',
  'calendarContentView', 'calendarSettingsCancel', 'calendarSettingsSave',
  'contentUnavailableModal', 'contentUnavailableClose', 'calendarPreviewModal',
  'calendarPreviewVideo', 'calendarPreviewMeta', 'calendarPreviewDownload',
  'calendarPreviewVersionPrev', 'calendarPreviewVersionNext', 'calendarPreviewVersionCount',
  'calendarPreviewClose'
].forEach(id => assert.match(html, new RegExp(`id="${id}"`), `fragment preserves #${id}`));
assert.doesNotMatch(html, /<script\b|onclick=/i, 'injectable fragment does not execute scripts');
assert.match(shell, /<div id="step05Container"><\/div>/, 'shell provides the Step 5 mount point');
assert.match(shell, /container:'#step05Container',path:'\/01_app\/pages\/steps\/step05-calendar\.html'/, 'Step 5 loads with the other partials before binding');
assert.match(shell, /assets\/steps\/step05\/step05-calendar\.css/, 'shell loads isolated Step 5 styles');
assert.match(shell, /assets\/steps\/step05\/step05-calendar\.js/, 'shell loads isolated Step 5 helpers');
assert.equal((shell.match(/id="step5"/g) || []).length, 0, 'Step 5 markup is not duplicated inline');
assert.equal((shell.match(/id="calendarSettingsModal"/g) || []).length, 0, 'Step 5 modals are not duplicated inline');
assert.match(shell, /ThinkCastApiClient\.createApiClient\(\)/, 'shell delegates JSON requests to the shared API client');
assert.doesNotMatch(shell, /if\(path==='\/api\/brand-assets'&&Array\.isArray\(result\.selections\)\)/, 'shared API adapter has no hidden brand selection mutation');
const brandHydrateIndex = projectHydration.indexOf('deps.hydrateBrandSelections({assets: result.brand_assets || [], selections: result.brand_selections || []})');
const brandRenderIndex = projectHydration.indexOf('deps.renderBrandChoices()');
assert.ok(brandHydrateIndex >= 0 && brandHydrateIndex < brandRenderIndex, 'project content load hydrates brand selections before rendering choices');
assert.match(shell, /Step04BrandLibraryController\.create\(\{[\s\S]*?selectionController:brandSelectionController/, 'brand library refresh receives the explicit brand selection owner');
assert.match(shell, /function refreshBrandLibrary\(\)\{return brandLibraryController\.refresh\(\)\}/, 'project index refresh delegates explicitly to the brand library controller');
assert.match(shell, /assets\/core\/project-store\.js/, 'project store is available for staged migration without duplicate writes');

const Calendar = require('../01_app/assets/steps/step05/step05-calendar.js');
const entry = (id, projectId, start, platform, updatedAt, extra = {}) => ({
  id, title: `Content ${projectId}`, start, end: Calendar.nextDateKey(start), allDay: true,
  extendedProps: { projectId, platform, createdAt: `${start}T09:00:00+09:00`, updatedAt, ...extra }
});

const duplicateOld = entry('old', 'project-a', '2026-10-07', 'youtube', '2026-10-07T09:00:00+09:00');
const duplicateNew = entry('new', 'project-a', '2026-10-07', 'youtube', '2026-10-07T10:00:00+09:00');
const secondPlatform = entry('instagram', 'project-a', '2026-10-07', 'instagram', '2026-10-07T09:00:00+09:00');
const sameTitleOtherProject = { ...entry('other', 'project-b', '2026-10-07', 'youtube', '2026-10-07T09:00:00+09:00'), title: duplicateNew.title };

const collapsed = Calendar.collapseDuplicates([duplicateOld, secondPlatform, duplicateNew, sameTitleOtherProject]);
assert.equal(collapsed.length, 3, 'uniqueness is content + local date + platform');
assert.ok(collapsed.includes(duplicateNew), 'newest legacy duplicate is retained');
assert.ok(collapsed.includes(secondPlatform), 'same content and date may target another platform');
assert.ok(collapsed.includes(sameTitleOtherProject), 'project identity prevents title collisions');

const moved = Calendar.moveContentGroup(collapsed, 'new', '2026-10-08');
assert.equal(moved.filter(item => item.extendedProps.projectId === 'project-a').length, 2);
assert.ok(moved.filter(item => item.extendedProps.projectId === 'project-a').every(item => item.start === '2026-10-08'));
assert.ok(moved.filter(item => item.extendedProps.projectId === 'project-a').every(item => item.end === '2026-10-09'));
assert.equal(moved.find(item => item.id === 'new').extendedProps.createdAt.slice(0, 10), '2026-10-08', 'local timestamp follows moved date');
assert.equal(moved.find(item => item.id === 'other').start, '2026-10-07', 'other content does not move');

const versions = Calendar.contentVersions(entry('versions', 'project-a', '2026-10-07', 'youtube', null, {
  contentUrl: '/exports/v2.mp4', filename: 'v2.mp4',
  contentVersions: [{ url: '/exports/v1.mp4', filename: 'v1.mp4' }, { url: '/exports/v2.mp4', filename: 'v2.mp4' }]
}));
assert.deepEqual(versions.map(item => item.url), ['/exports/v1.mp4', '/exports/v2.mp4'], 'artifact versions remain immutable and de-duplicated');
assert.equal(Calendar.groupByContent(moved).length, 2, 'calendar groups by stable content identity');
assert.equal(Calendar.nextDateKey('2026-12-31'), '2027-01-01');

console.log('Step 5 fragment and calendar contract tests passed.');
