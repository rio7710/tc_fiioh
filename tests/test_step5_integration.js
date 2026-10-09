const assert = require('node:assert/strict');
const fs = require('node:fs');

const partialPath = '01_app/pages/steps/step05-calendar.html';
const cssPath = '01_app/assets/steps/step05/step05-calendar.css';
const jsPath = '01_app/assets/steps/step05/step05-calendar.js';
const storePath = '01_app/assets/steps/step05/step05-calendar-store.js';
const viewControllerPath = '01_app/assets/steps/step05/step05-calendar-view-controller.js';
const rendererPath = '01_app/assets/steps/step05/step05-calendar-renderer.js';
const dragControllerPath = '01_app/assets/steps/step05/step05-calendar-drag-controller.js';
const settingsControllerPath = '01_app/assets/steps/step05/step05-calendar-settings-controller.js';
const previewControllerPath = '01_app/assets/steps/step05/step05-calendar-preview-controller.js';
const exportControllerPath = '01_app/assets/steps/step05/step05-calendar-export-controller.js';
const productionCalendarControllerPath = '01_app/assets/steps/step05/step05-production-calendar-controller.js';
const presentationControllerPath = '01_app/assets/steps/step05/step05-calendar-presentation-controller.js';
const dataControllerPath = '01_app/assets/steps/step05/step05-calendar-data-controller.js';
const latestExportControllerPath = '01_app/assets/steps/step05/step05-latest-export-controller.js';
[partialPath, cssPath, jsPath, storePath, viewControllerPath, rendererPath, dragControllerPath, settingsControllerPath, previewControllerPath, exportControllerPath, productionCalendarControllerPath, presentationControllerPath, dataControllerPath, latestExportControllerPath].forEach(file => assert.ok(fs.existsSync(file), `${file} must exist`));

const html = fs.readFileSync(partialPath, 'utf8');
const shellMarkup = fs.readFileSync('01_app/P1_title_design_preview.html', 'utf8');
const appBootstrap = fs.readFileSync('01_app/assets/core/app-bootstrap.js', 'utf8');
const shell = `${shellMarkup}\n${appBootstrap}`;
const projectHydration = fs.readFileSync('01_app/assets/core/project-brand-platform-hydrator.js', 'utf8');
const presentationController = fs.readFileSync(presentationControllerPath, 'utf8');
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
assert.match(shell, /step05-calendar\.js\?v=20261009_v63/, 'shell cache-busts Step 5 calendar helpers');
assert.match(shell, /step05-calendar-store\.js\?v=20261009_v64/, 'shell cache-busts Step 5 calendar store');
assert.match(shell, /step05-calendar-view-controller\.js\?v=20261009_v65/, 'shell cache-busts calendar view controller');
assert.match(shell, /step05-calendar-renderer\.js\?v=20261009_v66/, 'shell cache-busts calendar renderer');
assert.match(shell, /step05-calendar-drag-controller\.js\?v=20261009_v67/, 'shell cache-busts calendar drag controller');
assert.match(shell, /step05-calendar-settings-controller\.js\?v=20261009_v68/, 'shell cache-busts calendar settings controller');
assert.match(shell, /step05-calendar-preview-controller\.js\?v=20261009_v69/, 'shell cache-busts calendar preview controller');
assert.match(shell, /step05-calendar-export-controller\.js\?v=20261009_v70/, 'shell cache-busts calendar export controller');
assert.match(shell, /step05-production-calendar-controller\.js\?v=20261009_v71/, 'shell cache-busts production calendar controller');
assert.match(shell, /step05-calendar-presentation-controller\.js\?v=20261009_v72/, 'shell cache-busts calendar presentation controller');
assert.match(shell, /step05-calendar-data-controller\.js\?v=20261009_v73/, 'shell cache-busts calendar data controller');
assert.match(shell, /step05-latest-export-controller\.js\?v=20261009_v74/, 'shell cache-busts latest export controller');
assert.ok(shell.indexOf('step05-calendar.js') < shell.indexOf('step05-calendar-store.js'), 'calendar domain helpers load before store');
assert.ok(shell.indexOf('step05-calendar-store.js') < shell.indexOf('step05-calendar-view-controller.js'), 'calendar view controller loads after calendar store');
assert.ok(shell.indexOf('step05-calendar-view-controller.js') < shell.indexOf('step05-calendar-renderer.js'), 'calendar renderer loads after view controller');
assert.ok(shell.indexOf('step05-calendar-renderer.js') < shell.indexOf('step05-calendar-drag-controller.js'), 'calendar drag controller loads after renderer');
assert.ok(shell.indexOf('step05-calendar-drag-controller.js') < shell.indexOf('step05-calendar-settings-controller.js'), 'calendar settings controller loads after drag controller');
assert.ok(shell.indexOf('step05-calendar-settings-controller.js') < shell.indexOf('step05-calendar-preview-controller.js'), 'calendar preview controller loads after settings controller');
assert.ok(shell.indexOf('step05-calendar-preview-controller.js') < shell.indexOf('step05-calendar-export-controller.js'), 'calendar export controller loads after preview controller');
assert.ok(shell.indexOf('step05-calendar-export-controller.js') < shell.indexOf('step05-production-calendar-controller.js'), 'production calendar controller loads after export controller');
assert.ok(shell.indexOf('step05-production-calendar-controller.js') < shell.indexOf('step05-calendar-presentation-controller.js'), 'calendar presentation controller loads after production controller');
assert.ok(shell.indexOf('step05-calendar-presentation-controller.js') < shell.indexOf('step05-calendar-data-controller.js'), 'calendar data controller loads after presentation controller');
assert.ok(shell.indexOf('step05-calendar-data-controller.js') < shell.indexOf('step05-latest-export-controller.js'), 'latest export controller loads after calendar data controller');
assert.match(shell,/const calendarStore=Step05CalendarStore\.create\(\{storage:localStorage,storageKey:CALENDAR_STORAGE_KEY,request:\(\.\.\.args\)=>api\(\.\.\.args\),collapseDuplicates:Step05Calendar\.collapseDuplicates,uniquenessKey:Step05Calendar\.uniquenessKey\}\)/,'shell wires calendar store to canonical uniqueness helpers');
assert.match(shell,/function loadCalendarEntries\(\)\{\s*return calendarDataController\.load\(\);\s*\}/,'local calendar load is a thin data-controller delegate');
assert.match(shell,/async function hydrateCalendarEntries\(\)\{\s*return calendarDataController\.hydrate\(\);\s*\}/,'server calendar hydration is a thin data-controller delegate');
assert.match(shell,/function saveCalendarEntries\(\)\{\s*return calendarDataController\.save\(\);\s*\}/,'calendar save is a thin data-controller delegate');
assert.doesNotMatch(shell,/function loadCalendarEntries\(\)\{[^}]*JSON\.parse|function hydrateCalendarEntries\(\)\{[^}]*serverLegacyKeys/,'shell has no calendar persistence implementation');
assert.match(shell,/const calendarDataController=Step05CalendarDataController\.create\(\{store:calendarStore,getEntries:\(\)=>calendarEntries,setEntries:entries=>\{calendarEntries=entries\},render:renderCalendar\}\)/,'shell explicitly composes calendar data lifecycle');
assert.doesNotMatch(shell,/calendarEntries=calendarStore\.load\(\)\.entries|calendarStore\.hydrate\(calendarEntries\)|calendarStore\.save\(calendarEntries\)/,'shell has no duplicate persistence lifecycle body');
assert.match(shell,/function showLatestExport\(result\)\{\s*return latestExportController\.show\(result\);\s*\}/,'latest export show remains a thin compatibility wrapper');
assert.match(shell,/function loadLatestExport\(\)\{\s*return latestExportController\.load\(\);\s*\}/,'latest export load remains a thin compatibility wrapper');
assert.match(shell,/const latestExportController=Step05LatestExportController\.create\(\{section:latestExport,list:latestExportList,[\s\S]*?storageKey:LATEST_EXPORT_STORAGE_KEY/,'shell explicitly composes latest export workflow');
assert.doesNotMatch(shell,/function exportPreviewClass|latestExportList\.replaceChildren\(\)|localStorage\.setItem\(LATEST_EXPORT_STORAGE_KEY/,'shell has no duplicate latest export implementation');
assert.doesNotMatch(shell,/function loadCalendarUi|function saveCalendarUi|function moveCalendarPeriod|let calendarCursor=|let calendarView=/,'shell has no duplicate calendar view lifecycle');
assert.match(presentationController,/deps\.viewController\.load\(\)/,'presentation controller owns calendar UI loading');
assert.match(presentationController,/deps\.renderer\.render\(\{/,'presentation controller delegates markup to pure renderer');
assert.doesNotMatch(shell,/function renderCalendarStickers|function calendarDayMarkup|function renderCalendarTimeGrid|const weekdays=\['SUN'/,'shell has no duplicate calendar markup implementation');
assert.match(shell,/const calendarDragController=Step05CalendarDragController\.create\(\{grid:calendarGrid,[\s\S]*?contentIdentity:Step05Calendar\.contentIdentity,[\s\S]*?collapseDuplicates:Step05Calendar\.collapseDuplicates,[\s\S]*?shiftTimestampDate:Step05Calendar\.shiftTimestampDate,dateKey:Step05Calendar\.dateKey/,'shell injects canonical calendar helpers into drag controller');
assert.match(shell,/if\(calendarDragController\.consumeDidDrag\(\)\)return;/,'shell click path consumes drag suppression explicitly');
assert.doesNotMatch(shell,/function shiftCalendarTimestampDate|function moveCalendarGroupToDate|function calendarDropMinute|function clearCalendarDropTargets|calendarGrid\.addEventListener\('dragstart'/,'shell has no duplicate drag implementation');
assert.match(shell,/const calendarSettingsController=Step05CalendarSettingsController\.create\(\{grid:calendarGrid,[\s\S]*?contentIdentity:Step05Calendar\.contentIdentity/,'shell injects canonical identity into calendar settings controller');
assert.match(shell,/calendarSettingsController\.getActiveEntries\(\)\.find/,'content preview reads the active settings group through the controller');
assert.match(shell,/if\(calendarSettingsController\.consumeLongPressOpened\(\)\)return;/,'grid click consumes long-press suppression explicitly');
assert.doesNotMatch(shell,/function openCalendarSettings|function closeCalendarSettings|calendarGrid\.addEventListener\('contextmenu'|calendarLongPressTimer|calendarSettingsGroup/,'shell has no duplicate settings interaction implementation');
assert.match(shell,/const calendarPreviewController=Step05CalendarPreviewController\.create\(\{previewModal:calendarPreviewModal,[\s\S]*?contentIdentity:Step05Calendar\.contentIdentity,[\s\S]*?contentVersions:Step05Calendar\.calendarContentVersions/,'shell injects canonical preview helpers');
assert.match(shell,/onError:\(feature,error\)=>console\.warn\(`\[CalendarPreview:\$\{feature\}\]`,error\)/,'preview autoplay policy failures are warning-level diagnostics');
assert.doesNotMatch(shell,/onError:\(feature,error\)=>console\.error\(`\[CalendarPreview:/,'preview autoplay policy failures are not public console errors');
assert.match(shell,/calendarPreviewController\.open\(sticker\.dataset\.groupId\)/,'sticker click delegates preview opening');
assert.match(shell,/calendarPreviewController\.openUnavailable\(\)/,'settings content view delegates unavailable modal');
assert.doesNotMatch(shell,/function openCalendarPreview|function closeCalendarPreview|function selectCalendarPreviewTab|function selectCalendarPreviewVersion|calendarPreviewVersions|calendarPreviewVersionIndex|calendarPreviewMeta\.addEventListener\('click'/,'shell has no duplicate preview lifecycle');
assert.match(shell,/const calendarExportController=Step05CalendarExportController\.create\(\{button:document\.querySelector\('#calendarExport'\),[\s\S]*?contentIdentity:Step05Calendar\.contentIdentity,[\s\S]*?collapseDuplicates:Step05Calendar\.collapseDuplicates/,'shell injects canonical helpers into calendar export controller');
assert.match(shell,/calendarExportController\.mount\(\)/,'shell mounts calendar export controller');
assert.doesNotMatch(shell,/function exportCalendarIcs|calendarExport'\)\.addEventListener\('click'/,'shell has no duplicate ICS implementation or listener');
assert.match(shell,/function recordCurrentProduction\(result\)\{\s*return productionCalendarController\.record\(result\);\s*\}/,'production callback remains a thin compatibility wrapper');
assert.match(shell,/const productionCalendarController=Step05ProductionCalendarController\.create\(\{getEntries:\(\)=>calendarEntries,[\s\S]*?collapseDuplicates:Step05Calendar\.collapseDuplicates/,'shell injects production calendar state and canonical uniqueness');
assert.doesNotMatch(shell,/function recordCurrentProduction\(result\)\{[\s\S]*?targets\.forEach/,'shell has no production calendar implementation body');
assert.match(shell,/function renderCalendar\(options\)\{\s*return calendarPresentationController\.render\(options\);\s*\}/,'calendar render remains a thin compatibility wrapper');
assert.match(shell,/const calendarPresentationController=Step05CalendarPresentationController\.create\(\{grid:calendarGrid,[\s\S]*?viewController:calendarViewController,renderer:calendarRenderer/,'shell explicitly composes calendar presentation');
assert.match(shell,/calendarPresentationController\.selectDate\(day\.dataset\.date\)/,'day routing delegates through calendar presentation');
assert.doesNotMatch(shell,/function loadCalendarUi|function saveCalendarUi|function moveCalendarPeriod|calendarPrev'\)\.addEventListener|calendarNext'\)\.addEventListener|document\.querySelectorAll\('\.calendar-view-btn'\)\.forEach\(button=>button\.addEventListener/,'shell has no duplicate calendar presentation lifecycle');
assert.equal((shell.match(/id="step5"/g) || []).length, 0, 'Step 5 markup is not duplicated inline');
assert.equal((shell.match(/id="calendarSettingsModal"/g) || []).length, 0, 'Step 5 modals are not duplicated inline');
assert.match(shell, /ThinkCastApiClient\.createApiClient\(\)/, 'shell delegates JSON requests to the shared API client');
assert.doesNotMatch(shell, /if\(path==='\/api\/brand-assets'&&Array\.isArray\(result\.selections\)\)/, 'shared API adapter has no hidden brand selection mutation');
const brandHydrateIndex = projectHydration.indexOf('deps.hydrateBrandSelections({assets:result.brand_assets||[],selections:result.brand_selections||[]})');
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
assert.equal(Calendar.dateKey(new Date(2026, 0, 2, 12)), '2026-01-02');
const rawVersions=[{url:'/v1.mp4'},null];
assert.deepEqual(Calendar.calendarContentVersions({extendedProps:{contentVersions:rawVersions,contentUrl:'/v2.mp4',filename:'v2.mp4'}}).map(item=>item.url),['/v1.mp4','/v2.mp4']);
const uncollapsed=Calendar.groupCalendarEntries([duplicateOld,duplicateNew,secondPlatform]);
assert.equal(uncollapsed.length,1);assert.equal(uncollapsed[0].items.length,3,'UI grouping preserves input entries without duplicate collapse');
const statusItem={extendedProps:{status:'scheduled',createdAt:'2026-10-07T01:00:00+09:00',scheduledAt:'2026-10-07T11:30:00+09:00'}};
assert.equal(Calendar.calendarStatusTimestamp(statusItem),statusItem.extendedProps.scheduledAt);
assert.equal(Calendar.formatCalendarTime(statusItem.extendedProps.scheduledAt),'11:30');
assert.equal(Calendar.formatCalendarTime('invalid'),'--:--');assert.equal(Calendar.formatCalendarTime(null),'--:--');
assert.equal(Calendar.calendarTimeInputValue(statusItem),'11:30');assert.equal(Calendar.calendarMinuteOfDay(statusItem),11*60+30);assert.equal(Calendar.calendarMinuteOfDay({extendedProps:{}}),9*60);
assert.equal(Calendar.icsEscape('a\\b;c,d\ne'),'a\\\\b\\;c\\,d\\ne');
for(const name of ['dateKey','nextDateKey','calendarContentVersions','groupCalendarEntries','calendarStatusTimestamp','formatCalendarTime','calendarTimeInputValue','calendarMinuteOfDay','icsEscape'])assert.match(shell,new RegExp(`function ${name}\\([^)]*\\)\\{\\s*return Step05Calendar\\.${name}\\(`),`${name} remains a thin shell delegate`);
assert.doesNotMatch(shell,/function groupCalendarEntries\(entries\)\{\s*const groups=|function formatCalendarTime\(value\)\{\s*if\(!value\)|function icsEscape\(value\)\{return String/,'shell has no duplicate calendar helper bodies');

console.log('Step 5 fragment and calendar contract tests passed.');
