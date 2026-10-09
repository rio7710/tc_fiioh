const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

console.log('--- Step 4 Partial Lifecycle & Strict Browser Runtime Safety Tests ---');

// 1. Structural File Integrity Verification
const partialPath = '01_app/pages/steps/step04-video.html';
const cssPath = '01_app/assets/steps/step04/step04-video.css';
const jsPath = '01_app/assets/steps/step04/step04-video.js';
const contentIndexControllerPath = '01_app/assets/steps/step01/step01-content-index-controller.js';
const projectIndexControllerPath = '01_app/assets/steps/step01/step01-project-index-controller.js';
const brandStatePath = '01_app/assets/steps/step04/step04-brand-state.js';
const brandSelectionControllerPath = '01_app/assets/steps/step04/step04-brand-selection-controller.js';
const brandLibraryControllerPath = '01_app/assets/steps/step04/step04-brand-library-controller.js';
const outroRatioAssetsPath = '01_app/assets/steps/step04/step04-outro-ratio-assets.js';
const brandStagePreviewPath = '01_app/assets/steps/step04/step04-brand-stage-preview.js';
const brandOverlayPath = '01_app/assets/steps/step04/step04-brand-overlay.js';
const storePath = '01_app/assets/steps/step04/step04-store.js';
const timelineBridgePath = '01_app/assets/steps/step04/step04-timeline-bridge.js';
const narrationControllerPath = '01_app/assets/steps/step04/step04-narration-controller.js';
const timelinePreviewControllerPath = '01_app/assets/steps/step04/step04-timeline-preview-controller.js';
const ratioCropControllerPath = '01_app/assets/steps/step04/step04-ratio-crop-controller.js';
const playbackControllerPath = '01_app/assets/steps/step04/step04-playback-controller.js';
const settingsControllerPath = '01_app/assets/steps/step04/step04-settings-controller.js';
const styleControllerPath = '01_app/assets/steps/step04/step04-style-controller.js';
const timelineOrchestratorPath = '01_app/assets/steps/step04/step04-timeline-orchestrator.js';
const lifecycleControllerPath = '01_app/assets/steps/step04/step04-lifecycle-controller.js';
const uiActionsControllerPath = '01_app/assets/steps/step04/step04-ui-actions-controller.js';
const renderControllerPath = '01_app/assets/steps/step04/step04-render-controller.js';
const navigationControllerPath = '01_app/assets/steps/step04/step04-navigation-controller.js';
const bindingsPath = '01_app/assets/steps/step04/step04-ui-bindings.js';
const videoEditorPath = '01_app/assets/video-editor/index.js';
const shellNavigationControllerPath = '01_app/assets/core/shell-navigation-controller.js';
const sessionBootstrapControllerPath = '01_app/assets/core/session-bootstrap-controller.js';
const authUIControllerPath = '01_app/assets/core/auth-ui-controller.js';
const projectHydrationControllerPath = '01_app/assets/core/project-hydration-controller.js';
const promptLabControllerPath = '01_app/assets/core/prompt-lab-controller.js';
const providerSettingsControllerPath = '01_app/assets/core/provider-settings-controller.js';
const scriptEditorControllerPath = '01_app/assets/steps/step03/step03-script-editor-controller.js';
const trendKeywordControllerPath = '01_app/assets/steps/step02/trend-keyword-controller.js';
const scriptGenerationControllerPath = '01_app/assets/steps/step02/script-generation-controller.js';

assert.ok(fs.existsSync(partialPath), 'step04-video.html partial file must exist');
assert.ok(fs.existsSync(cssPath), 'step04-video.css must exist');
assert.ok(fs.existsSync(jsPath), 'step04-video.js must exist');
assert.ok(fs.existsSync(contentIndexControllerPath), 'step01-content-index-controller.js must exist');
assert.ok(fs.existsSync(projectIndexControllerPath), 'step01-project-index-controller.js must exist');
assert.ok(fs.existsSync(brandStatePath), 'step04-brand-state.js must exist');
assert.ok(fs.existsSync(brandSelectionControllerPath), 'step04-brand-selection-controller.js must exist');
assert.ok(fs.existsSync(brandLibraryControllerPath), 'step04-brand-library-controller.js must exist');
assert.ok(fs.existsSync(outroRatioAssetsPath), 'step04-outro-ratio-assets.js must exist');
assert.ok(fs.existsSync(brandStagePreviewPath), 'step04-brand-stage-preview.js must exist');
assert.ok(fs.existsSync(brandOverlayPath), 'step04-brand-overlay.js must exist');
assert.ok(fs.existsSync(storePath), 'step04-store.js must exist');
assert.ok(fs.existsSync(timelineBridgePath), 'step04-timeline-bridge.js must exist');
assert.ok(fs.existsSync(narrationControllerPath), 'step04-narration-controller.js must exist');
assert.ok(fs.existsSync(timelinePreviewControllerPath), 'step04-timeline-preview-controller.js must exist');
assert.ok(fs.existsSync(ratioCropControllerPath), 'step04-ratio-crop-controller.js must exist');
assert.ok(fs.existsSync(playbackControllerPath), 'step04-playback-controller.js must exist');
assert.ok(fs.existsSync(settingsControllerPath), 'step04-settings-controller.js must exist');
assert.ok(fs.existsSync(styleControllerPath), 'step04-style-controller.js must exist');
assert.ok(fs.existsSync(timelineOrchestratorPath), 'step04-timeline-orchestrator.js must exist');
assert.ok(fs.existsSync(lifecycleControllerPath), 'step04-lifecycle-controller.js must exist');
assert.ok(fs.existsSync(uiActionsControllerPath), 'step04-ui-actions-controller.js must exist');
assert.ok(fs.existsSync(renderControllerPath), 'step04-render-controller.js must exist');
assert.ok(fs.existsSync(navigationControllerPath), 'step04-navigation-controller.js must exist');
assert.ok(fs.existsSync(bindingsPath), 'step04-ui-bindings.js must exist');
assert.ok(fs.existsSync(videoEditorPath), 'video-editor/index.js must exist');
assert.ok(fs.existsSync(shellNavigationControllerPath), 'shell-navigation-controller.js must exist');
assert.ok(fs.existsSync(sessionBootstrapControllerPath), 'session-bootstrap-controller.js must exist');
assert.ok(fs.existsSync(authUIControllerPath), 'auth-ui-controller.js must exist');
assert.ok(fs.existsSync(projectHydrationControllerPath), 'project-hydration-controller.js must exist');
assert.ok(fs.existsSync(promptLabControllerPath), 'prompt-lab-controller.js must exist');
assert.ok(fs.existsSync(providerSettingsControllerPath), 'provider-settings-controller.js must exist');
assert.ok(fs.existsSync(scriptEditorControllerPath), 'step03-script-editor-controller.js must exist');
assert.ok(fs.existsSync(trendKeywordControllerPath), 'trend-keyword-controller.js must exist');
assert.ok(fs.existsSync(scriptGenerationControllerPath), 'script-generation-controller.js must exist');

const partialHtml = fs.readFileSync(partialPath, 'utf8');
const step04Source = fs.readFileSync(jsPath, 'utf8');
const brandLibrarySource = fs.readFileSync(brandLibraryControllerPath, 'utf8');
const projectHydrationSource = fs.readFileSync(projectHydrationControllerPath, 'utf8');
assert.match(partialHtml, /id="step4"/, 'Partial HTML contains #step4');
assert.match(partialHtml, /id="imageRegenerationModal"/, 'Partial HTML contains #imageRegenerationModal');
assert.doesNotMatch(step04Source, /document\.addEventListener\('click',[\s\S]*\.ratio-btn/, 'ratio controls must not have a duplicate global click listener');
assert.doesNotMatch(step04Source, /function renderSceneList\(\)\s*\{[^}]*navigationController\.mount/, 'scene rendering must not pre-mount navigation before the partial DOM lifecycle');

console.log('✓ File integrity checks passed');

// 2. Headless VM Execution Test: Pre-Partial Script Evaluation MUST NOT Throw (No Null Query Errors)
const html = fs.readFileSync('01_app/P1_title_design_preview.html', 'utf8');
assert.match(html, /src="\/01_app\/assets\/core\/shell-navigation-controller\.js\?v=20261009_v32"/, 'HTML cache-busts shell navigation controller');
assert.match(html, /src="\/01_app\/assets\/core\/session-bootstrap-controller\.js\?v=20261009_v33"/, 'HTML cache-busts session bootstrap controller');
assert.match(html, /src="\/01_app\/assets\/core\/auth-ui-controller\.js\?v=20261009_v34"/, 'HTML cache-busts auth UI controller');
assert.match(html, /src="\/01_app\/assets\/core\/project-hydration-controller\.js\?v=20261009_v36"/, 'HTML cache-busts project hydration controller');
assert.match(html, /src="\/01_app\/assets\/core\/prompt-lab-controller\.js\?v=20261009_v37"/, 'HTML cache-busts prompt lab controller');
assert.match(html, /src="\/01_app\/assets\/core\/provider-settings-controller\.js\?v=20261009_v39"/, 'HTML cache-busts provider settings controller');
assert.match(html, /src="\/01_app\/assets\/steps\/step02\/trend-keyword-controller\.js\?v=20261009_v40"/, 'HTML cache-busts trend keyword controller');
assert.match(html, /src="\/01_app\/assets\/steps\/step02\/step02-keyword\.js\?v=20261009_v41"/, 'HTML cache-busts Step 2 keyword controller');
assert.match(html, /src="\/01_app\/assets\/steps\/step02\/script-generation-controller\.js\?v=20261009_v42"/, 'HTML cache-busts script generation controller');
assert.ok(html.indexOf('step02-keyword.js') < html.indexOf('trend-keyword-controller.js'), 'base Step 2 module loads before trend keyword controller');
assert.ok(html.indexOf('step02-keyword.js') < html.indexOf('script-generation-controller.js') && html.indexOf('script-generation-controller.js') < html.indexOf('trend-keyword-controller.js'), 'script generation loads between Step 2 keyword controllers');
assert.ok(html.indexOf('content-route.js') < html.indexOf('shell-navigation-controller.js'), 'content route helper loads before shell navigation');
assert.ok(html.indexOf('shell-navigation-controller.js') < html.indexOf('session-bootstrap-controller.js'), 'shell navigation loads before session bootstrap');
assert.ok(html.indexOf('session-bootstrap-controller.js') < html.indexOf('auth-ui-controller.js'), 'session bootstrap loads before auth UI controller');
assert.ok(html.indexOf('auth-ui-controller.js') < html.indexOf('project-hydration-controller.js'), 'auth UI loads before project hydration controller');
assert.ok(html.indexOf('project-hydration-controller.js') < html.indexOf('prompt-lab-controller.js'), 'project hydration loads before prompt lab controller');
assert.ok(html.indexOf('prompt-lab-controller.js') < html.indexOf('provider-settings-controller.js'), 'prompt lab loads before provider settings controller');
for (const contract of [
  /function readContentRoute\(\)\{\s*return shellNavigationController\.readRoute\(\);\s*\}/,
  /function writeContentRoute\(step,mode='push'\)\{\s*return shellNavigationController\.writeRoute\(step,mode\);\s*\}/,
  /function navigateProjectStep\(requestedTarget,\{historyMode='push'\}=\{\}\)\{\s*return shellNavigationController\.navigate\(requestedTarget,\{historyMode\}\);\s*\}/
]) assert.match(html, contract, 'P1 keeps thin shell navigation wrappers');
assert.match(html, /shellNavigationController\.mount\(document\)/, 'P1 mounts shell navigation after partial loading');
assert.doesNotMatch(html, /contentRouteSubscription|let navToken=|let restoredRouteUrl=|document\.addEventListener\('click',async event=>\{\s*const button=event\.target\.closest\('\[data-go\]'/, 'P1 removes duplicate shell navigation state and handlers');
assert.match(html, /async function restoreLoginSession\(\)\{\s*return sessionBootstrapController\.restore\(\);\s*\}/, 'P1 keeps a thin session restore wrapper');
assert.match(html, /const sessionBootstrapController=ThinkCastSessionBootstrapController\.create\(/, 'P1 wires the session bootstrap controller');
assert.ok(html.indexOf('sessionBootstrapController=') < html.indexOf('async function boot()'), 'session bootstrap is ready before boot');
assert.doesNotMatch(html, /async function restoreLoginSession\(\)\{\s*setLoginAccess\(false\)/, 'P1 removes the session bootstrap implementation');
assert.match(html, /function setLoginAccess\(enabled,account=null\)\{\s*return authUIController\.setAccess\(enabled,account\);\s*\}/, 'P1 keeps a thin login access wrapper');
assert.match(html, /function setAuthMode\(mode\)\{\s*return authUIController\.setMode\(mode\);\s*\}/, 'P1 keeps a thin auth mode wrapper');
assert.match(html, /const authUIController=ThinkCastAuthUIController\.create\(/, 'P1 wires the auth UI controller');
assert.match(html, /authUIController\.mount\(document\)/, 'P1 mounts auth UI after partial loading');
assert.match(html, /isLoggedIn:\(\)=>authUIController\.isLoggedIn\(\)/, 'shell navigation reads auth state from the controller');
assert.doesNotMatch(html, /document\.querySelector\('#loginForm'\)\.addEventListener|document\.querySelector\('#registerForm'\)\.addEventListener|document\.querySelector\('#logoutButton'\)\.addEventListener/, 'P1 removes inline auth event bodies');
assert.match(html, /async function loadProjectContent\(projectId,token\)\{\s*return projectHydrationController\.loadContent\(projectId,token\);\s*\}/, 'P1 keeps a thin project content hydration wrapper');
assert.match(html, /async function loadProjectState\(projectId,token\)\{\s*return projectHydrationController\.loadState\(projectId,token\);\s*\}/, 'P1 keeps a thin project state hydration wrapper');
assert.match(html, /const projectHydrationController=ThinkCastProjectHydrationController\.create\(/, 'P1 wires the project hydration controller');
assert.ok(html.indexOf('projectHydrationController=') < html.indexOf('shellNavigationController='), 'project hydration is wired before shell navigation');
assert.doesNotMatch(html, /\/api\/project-content\?project_id=/, 'P1 removes the project content hydration body');
assert.doesNotMatch(html, /\/api\/project-state\?project_id=/, 'P1 removes the project state hydration body');
assert.match(html, /const promptLabController=ThinkCastPromptLabController\.create\(/, 'P1 wires the prompt lab controller');
assert.match(html, /promptLabController\.mount\(document\)/, 'P1 mounts prompt lab interactions');
assert.doesNotMatch(html, /\/api\/prompt-harness\/(?:image|stream|test)|promptLabForm\.addEventListener|function closePromptLab\(/, 'P1 removes the prompt lab implementation');
assert.match(html, /const providerSettingsController=ThinkCastProviderSettingsController\.create\(/, 'P1 wires the provider settings controller');
assert.match(html, /providerSettingsController\.mount\(document\)/, 'P1 mounts provider settings interactions');
assert.match(html, /function refreshApiConnections\(\)\{return providerSettingsController\.refresh\(\)\}/, 'P1 keeps a thin provider refresh wrapper');
assert.match(html, /function closeApiSettings\(\)\{return providerSettingsController\.close\(\)\}/, 'P1 keeps a thin provider close wrapper');
assert.match(html, /function openApiSettings\(step\)\{return providerSettingsController\.open\(step\)\}/, 'P1 keeps a thin provider open wrapper');
assert.match(html, /function ensureStepApiReady\(step\)\{return providerSettingsController\.ensureStepReady\(step\)\}/, 'P1 keeps a thin provider readiness wrapper');
assert.doesNotMatch(html, /let apiConnectionConfig=|let activeApiStep=|const apiStepCopy=|document\.querySelector\('#apiSettingsForm'\)\.addEventListener/, 'P1 removes provider settings state and inline event implementation');
assert.match(html, /const trendKeywordController=Step02TrendKeywordController\.create\(/, 'P1 wires the trend keyword controller');
assert.match(html, /trendKeywordController\.mount\(document\)/, 'P1 mounts trend keyword interactions');
assert.doesNotMatch(html, /let trendKeywordChoices=|let trendKeywordSelection=|let trendRequestVersion=|function setTrendKeywordLoading\(|function renderTrendKeywords\(|document\.querySelector\('#trendKeywordOpen'\)\.addEventListener/, 'P1 removes trend keyword state and inline event implementation');
assert.match(html, /const keywordController=Step02Keyword\.create\(/, 'P1 wires the Step 2 keyword controller');
assert.match(html, /keywordController\.mount\(document\)/, 'P1 mounts Step 2 keyword interactions');
assert.match(html, /function renderKeywords\(\)\{\s*return keywordController\.render\(\);\s*\}/, 'P1 keeps a thin keyword render wrapper');
assert.match(html, /function refreshKeywordBatch\(\)\{\s*return keywordController\.refresh\(\);\s*\}/, 'P1 keeps a thin keyword refresh wrapper');
assert.doesNotMatch(html, /keywordTilts|document\.querySelector\('#keywordGrid'\)\.addEventListener|document\.querySelector\('#keywordRefresh'\)\.addEventListener|document\.querySelector\('#keywordNext'\)\.addEventListener/, 'P1 removes duplicate Step 2 state and listeners');
assert.match(html, /const scriptGenerationController=Step02ScriptGenerationController\.create\(/, 'P1 wires the script generation controller');
assert.match(html, /scriptGenerationController\.mount\(document\)/, 'P1 mounts script generation workflow');
assert.match(html, /async function runAiWorkflow\(\)\{\s*return scriptGenerationController\.run\(\);\s*\}/, 'P1 keeps a thin script generation wrapper');
assert.doesNotMatch(html, /activePhase=|waitingTimer=|configureWorkflowModal\('storyboard'\)/, 'P1 removes the storyboard workflow implementation');
assert.match(html, /production:\{[\s\S]*kicker:'AI IMAGE PRODUCTION TEAM'/, 'production workflow config remains in P1');
assert.match(html, /export:\{[\s\S]*kicker:'AI VIDEO & FINAL EXPORT TEAM'/, 'export workflow config remains in P1');
assert.match(html, /configureWorkflowModal\('production'\)/, 'production workflow keeps its modal configuration call');
assert.match(fs.readFileSync(renderControllerPath,'utf8'), /configureWorkflowModal\('export'\)/, 'export controller keeps its modal configuration call');
assert.match(html, /src="\/01_app\/assets\/steps\/step01\/step01-content-index-controller\.js\?v=20261009_v30"/, 'HTML cache-busts content index controller');
assert.match(html, /src="\/01_app\/assets\/steps\/step01\/step01-project-index-controller\.js\?v=20261009_v31"/, 'HTML cache-busts project index controller');
assert.ok(html.indexOf('step01-project-index-controller.js') < html.indexOf('step01-content-index-controller.js'), 'project index controller loads before interaction controller');
assert.match(html, /function renderProjectIndex\(projects\)\{\s*return projectIndexController\.render\(projects\);\s*\}/, 'P1 keeps a thin project index render wrapper');
assert.match(html, /function refreshProjectIndex\(\)\{return projectIndexController\.refresh\(\)\}/, 'P1 keeps a thin project index refresh wrapper');
assert.match(html, /projectIndexController\.startPolling\(\)/, 'P1 starts project polling after controller creation');
assert.doesNotMatch(html, /projectStatusPollBusy|setInterval\(async\(\)=>\{const holder=document\.querySelector\('#contentIndex'\)/, 'P1 does not retain raw project polling');
assert.match(html, /function openIndexProject\(projectId,historyMode='push'\)\{\s*return contentIndexController\.openProject\(projectId,historyMode\);\s*\}/, 'P1 keeps a thin project-open wrapper');
assert.match(html, /contentIndexController\.mount\(document\)/, 'P1 mounts content index interactions after partial loading');
assert.doesNotMatch(html, /document\.querySelector\('#projectDeleteButton'\)\.addEventListener|document\.querySelector\('#createProjectButton'\)\.addEventListener/, 'P1 does not retain create/delete event bodies');

assert.match(html, /href="\/01_app\/assets\/video-editor\/video-editor\.css(?:\?v=[^"]+)?"/, 'HTML links video-editor.css');
assert.match(html, /href="\/01_app\/assets\/steps\/step04\/step04-video\.css(?:\?v=[^"]+)?"/, 'HTML links step04-video.css');
const sceneNavigationScript = html.indexOf('/01_app/assets/video-editor/scene-navigation.js');
const ratioProfilesScript = html.indexOf('/01_app/assets/video-editor/ratio-profiles.js');
assert.match(html, /src="\/01_app\/assets\/video-editor\/ratio-profiles\.js\?v=20261008_v24"/, 'HTML cache-busts ratio profiles');
const brandSelectionScript = html.indexOf('/01_app/assets/video-editor/brand-selection.js');
const mobileSyncScript = html.indexOf('/01_app/assets/video-editor/mobile-sync.js');
const videoEditorIndexScript = html.indexOf('/01_app/assets/video-editor/index.js');
const step04BrandStateScript = html.indexOf('/01_app/assets/steps/step04/step04-brand-state.js');
const step04BrandSelectionControllerScript = html.indexOf('/01_app/assets/steps/step04/step04-brand-selection-controller.js');
const step04BrandLibraryControllerScript = html.indexOf('/01_app/assets/steps/step04/step04-brand-library-controller.js');
const step04OutroRatioAssetsScript = html.indexOf('/01_app/assets/steps/step04/step04-outro-ratio-assets.js');
const step04BrandStagePreviewScript = html.indexOf('/01_app/assets/steps/step04/step04-brand-stage-preview.js');
const step04BrandOverlayScript = html.indexOf('/01_app/assets/steps/step04/step04-brand-overlay.js');
const step04StoreScript = html.indexOf('/01_app/assets/steps/step04/step04-store.js');
const step04TimelineBridgeScript = html.indexOf('/01_app/assets/steps/step04/step04-timeline-bridge.js');
const step04NarrationControllerScript = html.indexOf('/01_app/assets/steps/step04/step04-narration-controller.js');
const step04TimelinePreviewScript = html.indexOf('/01_app/assets/steps/step04/step04-timeline-preview-controller.js');
const step04RatioCropScript = html.indexOf('/01_app/assets/steps/step04/step04-ratio-crop-controller.js');
const step04PlaybackScript = html.indexOf('/01_app/assets/steps/step04/step04-playback-controller.js');
const step04SettingsScript = html.indexOf('/01_app/assets/steps/step04/step04-settings-controller.js');
const step04StyleScript = html.indexOf('/01_app/assets/steps/step04/step04-style-controller.js');
const step04TimelineOrchestratorScript = html.indexOf('/01_app/assets/steps/step04/step04-timeline-orchestrator.js');
const step04LifecycleScript = html.indexOf('/01_app/assets/steps/step04/step04-lifecycle-controller.js');
const step04UIActionsScript = html.indexOf('/01_app/assets/steps/step04/step04-ui-actions-controller.js');
const step04RenderScript = html.indexOf('/01_app/assets/steps/step04/step04-render-controller.js');
const step04NavigationScript = html.indexOf('/01_app/assets/steps/step04/step04-navigation-controller.js');
const step04BindingsScript = html.indexOf('/01_app/assets/steps/step04/step04-ui-bindings.js');
assert.ok(sceneNavigationScript >= 0, 'HTML loads browser scene navigation dependency');
assert.ok(ratioProfilesScript >= 0, 'HTML loads browser ratio profiles dependency');
assert.ok(brandSelectionScript >= 0, 'HTML loads browser brand selection dependency');
assert.ok(mobileSyncScript >= 0, 'HTML loads browser mobile sync dependency');
assert.ok(Math.max(sceneNavigationScript, ratioProfilesScript, brandSelectionScript, mobileSyncScript) < videoEditorIndexScript, 'browser dependencies load before video-editor index.js');
assert.ok(videoEditorIndexScript < step04BindingsScript, 'Step 4 UI bindings load after video editor dependencies');
assert.ok(videoEditorIndexScript < step04BrandStateScript, 'Step 4 brand state loads after video editor dependencies');
assert.ok(step04BrandStateScript < step04BrandSelectionControllerScript && step04BrandSelectionControllerScript < step04BrandLibraryControllerScript && step04BrandLibraryControllerScript < step04OutroRatioAssetsScript && step04OutroRatioAssetsScript < step04BrandStagePreviewScript && step04BrandStagePreviewScript < step04BrandOverlayScript, 'Step 4 brand dependencies load before overlay controller');
assert.ok(step04BrandOverlayScript < step04StoreScript, 'Step 4 overlay controller loads before related Step 4 scripts');
assert.ok(step04StoreScript < step04NavigationScript, 'Step 4 navigation controller loads after state dependencies');
assert.ok(step04StoreScript < step04TimelineBridgeScript && step04TimelineBridgeScript < step04NavigationScript, 'timeline bridge loads between Step 4 state and controllers');
assert.ok(step04TimelineBridgeScript < step04NarrationControllerScript && step04NarrationControllerScript < step04NavigationScript, 'narration controller loads before Step 4 controllers');
assert.ok(step04NarrationControllerScript < step04TimelinePreviewScript && step04TimelinePreviewScript < step04NavigationScript, 'timeline preview controller loads before Step 4 controllers');
assert.ok(step04TimelinePreviewScript < step04RatioCropScript && step04RatioCropScript < step04NavigationScript, 'ratio crop controller loads before Step 4 controllers');
assert.ok(step04RatioCropScript < step04PlaybackScript && step04PlaybackScript < step04NavigationScript, 'playback controller loads before Step 4 controllers');
assert.ok(step04PlaybackScript < step04SettingsScript && step04SettingsScript < step04NavigationScript, 'settings controller loads before Step 4 controllers');
assert.ok(step04SettingsScript < step04StyleScript && step04StyleScript < step04NavigationScript, 'style controller loads before Step 4 controllers');
assert.ok(step04StyleScript < step04TimelineOrchestratorScript && step04TimelineOrchestratorScript < step04NavigationScript, 'timeline orchestrator loads before Step 4 controllers');
assert.ok(step04TimelineOrchestratorScript < step04LifecycleScript && step04LifecycleScript < step04NavigationScript, 'lifecycle controller loads before Step 4 controllers');
assert.ok(step04LifecycleScript < step04UIActionsScript && step04UIActionsScript < step04NavigationScript, 'UI actions controller loads before Step 4 controllers');
assert.ok(step04PlaybackScript < step04RenderScript && step04RenderScript < step04NavigationScript, 'render controller loads before Step 4 controllers');
assert.ok(step04NavigationScript < step04BindingsScript, 'Step 4 navigation controller loads before UI bindings');
assert.ok(videoEditorIndexScript < step04StoreScript, 'Step 4 store loads after video editor dependencies');
assert.ok(step04StoreScript < html.indexOf('/01_app/assets/steps/step04/step04-video.js'), 'Step 4 store loads before the controller');
assert.ok(step04BindingsScript < html.indexOf('/01_app/assets/steps/step04/step04-video.js'), 'Step 4 UI bindings load before the controller');
assert.match(html, /src="\/01_app\/assets\/video-editor\/index\.js(?:\?v=[^"]+)?"/, 'HTML loads video-editor index.js');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-video\.js(?:\?v=[^"]+)?"/, 'HTML loads step04-video.js');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-brand-state\.js\?v=20261007_v5"/, 'HTML cache-busts step04-brand-state.js');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-brand-selection-controller\.js\?v=20261009_v28"/, 'HTML cache-busts brand selection controller');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-brand-library-controller\.js\?v=20261009_v29"/, 'HTML cache-busts brand library controller');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-outro-ratio-assets\.js\?v=20261009_v26"/, 'HTML cache-busts outro ratio policy');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-brand-stage-preview\.js\?v=20261009_v27"/, 'HTML cache-busts brand stage preview');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-brand-overlay\.js\?v=20261008_v25"/, 'HTML cache-busts step04-brand-overlay.js');
assert.match(html, /function ensureOutroRatioAssets\(item,options\)\{return outroRatioAssets\.ensure\(item,options\)\}/, 'P1 keeps only the compatible outro ratio policy wrapper');
assert.doesNotMatch(html, /const force=options\.force===true/, 'P1 does not retain the outro ratio policy implementation');
assert.match(html, /function updateWatermarkPreview\(\)\{return brandStagePreview\.updateWatermark\(\)\}/, 'P1 keeps the watermark preview compatibility wrapper');
assert.match(html, /function updateCommonOutroPreview\(\)\{return brandStagePreview\.updateOutro\(\)\}/, 'P1 keeps the outro preview compatibility wrapper');
assert.doesNotMatch(html, /function updateCommonOutroPreview\(\)\{const controls=/, 'P1 does not retain the common outro preview implementation');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-navigation-controller\.js\?v=20261007_v7"/, 'HTML cache-busts navigation controller');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-ui-bindings\.js\?v=20261007_v7"/, 'HTML cache-busts UI bindings');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-timeline-bridge\.js\?v=20261007_v8"/, 'HTML cache-busts timeline bridge');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-narration-controller\.js\?v=20261008_v17"/, 'HTML cache-busts narration controller');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-timeline-preview-controller\.js\?v=20261007_v10"/, 'HTML cache-busts timeline preview controller');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-ratio-crop-controller\.js\?v=20261008_v11"/, 'HTML cache-busts ratio crop controller');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-playback-controller\.js\?v=20261008_v12"/, 'HTML cache-busts playback controller');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-settings-controller\.js\?v=20261008_v23"/, 'HTML cache-busts settings controller');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-style-controller\.js\?v=20261008_v15"/, 'HTML cache-busts style controller');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-timeline-orchestrator\.js\?v=20261008_v22"/, 'HTML cache-busts timeline orchestrator');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-lifecycle-controller\.js\?v=20261008_v18"/, 'HTML cache-busts lifecycle controller');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-ui-actions-controller\.js\?v=20261008_v25"/, 'HTML cache-busts UI actions controller');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-render-controller\.js\?v=20261008_v13"/, 'HTML cache-busts render controller');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-video\.js\?v=20261008_v22"/, 'HTML cache-busts Step 4 controller');
assert.doesNotMatch(fs.readFileSync(bindingsPath, 'utf8'), /#prevBtn|#nextBtn|#mobileSceneSelect|#sceneList/, 'UI bindings do not duplicate navigation listeners');
assert.doesNotMatch(fs.readFileSync(bindingsPath, 'utf8'), /feature\('playback'|#playBtn|addEventListener\('play'|addEventListener\('pause'/, 'UI bindings do not duplicate playback listeners');
assert.doesNotMatch(html, /const watermarkPreviewRatios=|let watermarkPreviewItem=|let outroPreviewItem=|function activateWatermarkRatio\(|function renderOutroPreviewSlide\(/, 'P1 does not retain overlay controller state or implementation');
assert.match(html, /src="\/01_app\/assets\/steps\/step04\/step04-store\.js\?v=20261007_v4"/, 'HTML cache-busts step04-store.js');
assert.match(html, /Object\.assign\(window,\{[\s\S]*updateCommonOutroPreview[\s\S]*updateWatermarkPreview[\s\S]*\}\)/, 'shell exposes Step 4 preview callbacks after async isolation');
assert.match(html, /Object\.defineProperty\(window,'brandAssets',[\s\S]*get:\(\)=>brandSelectionController\.getAssets\(\)/, 'shell exposes current brand assets through the controller live getter');
assert.doesNotMatch(html, /let brandAssets=\[\]|let brandSelections=\[\]/, 'P1 does not duplicate brand asset or selection ownership');
assert.match(html, /function renderBrandChoices\(\)\{return brandSelectionController\.renderChoices\(\)\}/, 'P1 keeps a thin brand choices wrapper');
assert.match(html, /function currentBrandSelections\(\)\{return brandSelectionController\.serializeSelections\(\)\}/, 'P1 keeps a thin brand serialization wrapper');
assert.match(html, /function saveBrandSelections\(\)\{return brandSelectionController\.saveSelections\(\)\}/, 'P1 keeps a thin brand save wrapper');
assert.match(html, /function refreshBrandLibrary\(\)\{return brandLibraryController\.refresh\(\)\}/, 'P1 keeps a thin brand library refresh wrapper');
assert.match(html, /function showBrandLibrary\(show\)\{return brandLibraryController\.show\(show\)\}/, 'P1 keeps a thin brand library visibility wrapper');
assert.match(html, /brandLibraryController\.mount\(document\)/, 'P1 mounts the brand library controller after partials load');
assert.doesNotMatch(html, /document\.querySelector\('#brandUploadButton'\)\.addEventListener/, 'P1 does not retain the brand upload implementation');
assert.doesNotMatch(html, /if\(path==='\/api\/brand-assets'&&Array\.isArray\(result\.selections\)\)/, 'generic API has no hidden brand selection mutation');
assert.match(projectHydrationSource, /deps\.hydrateBrandSelections\(\{assets: result\.brand_assets \|\| \[\], selections: result\.brand_selections \|\| \[\]\}\)/, 'project content load hydrates brand data explicitly');
assert.match(brandLibrarySource, /selectionController\.hydrate\(\{assets: result\.assets \|\| \[\], selections: result\.selections \|\| \[\]\}\)/, 'brand library refresh hydrates brand data explicitly');
const brandStateDeclaration = "const brandOverlayState=Step04BrandState.create();";
assert.ok(html.indexOf(brandStateDeclaration) > 0 && html.indexOf(brandStateDeclaration) < html.indexOf('function activeWatermarkProfile'), 'brand state is initialized before Step 4 settings restore');
assert.doesNotMatch(html, /let (?:watermarkPosition|watermarkWidthRatio|watermarkProfiles|outroPosition|outroWidthRatio|outroBackground|outroBackgroundOpacity|outroProfiles)=/, 'brand overlay state must not be duplicated in P1 globals');
assert.doesNotMatch(html, /window\.startRenderWorkflow=async function/, 'P1 does not retain the large render workflow implementation');
assert.match(html, /window\.startRenderWorkflow=\(\)=>renderController\.start\(\);/, 'P1 keeps a thin render workflow compatibility wrapper');
for (const shellAction of ['openImageRegeneration','closeImageRegeneration','requestImageRegeneration']) {
  assert.match(html, new RegExp(`(?:async )?function ${shellAction}\\(`), `P1 retains the real ${shellAction} shell implementation`);
}
assert.match(step04Source, /hasShellFeature:\s*name\s*=>\s*typeof window !== 'undefined'\s*&&\s*typeof window\[name\] === 'function'/, 'Step 4 wires explicit shell feature detection');
assert.match(step04Source, /callShellFeature:\s*\(name, \.\.\.args\)\s*=>\s*callShellFeature\(name, \.\.\.args\)/, 'Step 4 wires the shell feature adapter');
assert.equal((html.match(/function renderSceneList\(\)/g) || []).length, 1, 'P1 keeps only the final Step04VideoEditor renderSceneList compatibility wrapper');
assert.match(html, /function applyScript\(script\)\{\s*scenes=timelineBridge\.applyScript\(script\)\.scenes;/, 'P1 script application delegates scene text ownership to timeline bridge');

// Verify top-level script contains no direct querySelector('#video') causing null binding at startup
assert.doesNotMatch(html, /const video=document\.querySelector\('#video'\);/, 'HTML must not query #video at top-level script parse time');
assert.doesNotMatch(html, /const stage=document\.querySelector\('#stage'\);/, 'HTML must not query #stage at top-level script parse time');

console.log('✓ Pre-partial parse safety verified (No top-level null DOM queries)');

// DOM Stub simulating browser environment before partial HTML injection
function createPrePartialContext() {
  const elements = new Map();
  const listeners = new Map();

  const step4OnlyIds = new Set([
    '#step4', '#projectTitle', '#aiPersonCrop', '#aiPersonCropStatus',
    '#narrationBtn', '#musicVolume', '#brandIntroEnabled', '#brandIntroVersion',
    '#brandOutroEnabled', '#brandOutroVersion', '#brandWatermarkEnabled',
    '#brandWatermarkVersion', '#brandWatermarkOpacity', '#stageCard', '#previewFormatBadge',
    '#stage', '#video', '#sceneImage', '#sceneVideo', '#prevBtn', '#playBtn', '#nextBtn',
    '#imageGenerationMosaic', '#imageGenerationStatus', '#imageGenerationStatusText',
    '#imageRegenerateBtn', '#imageVariantCount', '#bgm', '#sceneResourceBadge',
    '#cropHint', '#formatSafeZone', '#titleText', '#brandWatermarkPreview',
    '#brandOutroPreview', '#brandOutroPreviewImage', '#brandOutroPreviewVideo',
    '#progress', '#progressFill', '#clock', '#captionStatus', '#statusText',
    '#captionSizeDown', '#captionSizeValue', '#captionSizeUp', '#distributionTitle',
    '#distributionHelp', '#distributionPlatforms', '#sceneTimelineSummary',
    '#mobileSceneSelect', '#mobilePrevScene', '#mobileNextScene', '#sceneList',
    '#renderBtn', '#imageRegenerationModal', '#imageRegenerationCancel', '#imageRegenerationCreate',
    '#imageAdditionalPrompt', '#imageBaseGuide', '#imageRegenerationFeedback',
    '#imageRegenerationSceneNo', '#imageRegenerationTitle', '#renderStatus'
  ]);

  function createGenericStub(selector = '') {
    const stub = {
      id: selector.replace(/^#/, ''),
      classList: {
        add() {}, remove() {}, toggle() {}, contains() { return false; }
      },
      setAttribute() {},
      getAttribute() { return null; },
      removeAttribute() {},
      style: { setProperty() {}, getPropertyValue() { return ''; } },
      addEventListener(type, fn) {
        const list = listeners.get(type) || [];
        list.push(fn);
        listeners.set(type, list);
      },
      removeEventListener(type, fn) {
        const list = listeners.get(type) || [];
        listeners.set(type, list.filter(f => f !== fn));
      },
      focus() {},
      setLoggedIn() {},
      closest() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      replaceChildren() {},
      textContent: '',
      innerHTML: '',
      hidden: false,
      disabled: false,
      value: '',
      files: [],
      scrollTop: 0,
      scrollLeft: 0,
      dataset: new Proxy({}, {
        get(target, prop) {
          return target[prop] || '';
        }
      }),
      elements: new Proxy({}, {
        get(target, prop) {
          return target[prop] || [];
        }
      })
    };
    stub.parentElement = stub;
    return stub;
  }

  const container = {
    id: 'step4Container',
    innerHTML: '',
    appendChild(child) {},
    querySelectorAll() { return []; },
    querySelector() { return null; }
  };
  elements.set('#step4Container', container);

  const documentStub = {
    createElement(selector) { return createGenericStub(selector); },
    querySelector(selector) {
      if (elements.has(selector)) return elements.get(selector);
      if (step4OnlyIds.has(selector)) return null;
      return createGenericStub(selector);
    },
    querySelectorAll(selector) {
      if (step4OnlyIds.has(selector)) return [];
      return [createGenericStub(selector)];
    },
    addEventListener(type, fn) {
      const list = listeners.get(type) || [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) || [];
      listeners.set(type, list.filter(f => f !== fn));
    },
    body: { classList: { add() {}, remove() {} } }
  };

  const context = vm.createContext({
    console,
    URL,
    ThinkCastContentRoute: require('../01_app/assets/core/content-route.js'),
    ThinkCastShellNavigationController: require('../01_app/assets/core/shell-navigation-controller.js'),
    ThinkCastSessionBootstrapController: require('../01_app/assets/core/session-bootstrap-controller.js'),
    ThinkCastAuthUIController: require('../01_app/assets/core/auth-ui-controller.js'),
    ThinkCastProjectHydrationController: require('../01_app/assets/core/project-hydration-controller.js'),
    ThinkCastPromptLabController: require('../01_app/assets/core/prompt-lab-controller.js'),
    ThinkCastProviderSettingsController: require('../01_app/assets/core/provider-settings-controller.js'),
    Step03ScriptEditorController: require('../01_app/assets/steps/step03/step03-script-editor-controller.js'),
    Step02Keyword: require('../01_app/assets/steps/step02/step02-keyword.js'),
    Step02ScriptGenerationController: require('../01_app/assets/steps/step02/script-generation-controller.js'),
    Step02TrendKeywordController: require('../01_app/assets/steps/step02/trend-keyword-controller.js'),
    Step01ContentIndexController: require('../01_app/assets/steps/step01/step01-content-index-controller.js'),
    Step01ProjectIndexController: require('../01_app/assets/steps/step01/step01-project-index-controller.js'),
    Step04BrandState: require('../01_app/assets/steps/step04/step04-brand-state.js'),
    Step04BrandSelectionController: require('../01_app/assets/steps/step04/step04-brand-selection-controller.js'),
    Step04BrandLibraryController: require('../01_app/assets/steps/step04/step04-brand-library-controller.js'),
    Step04OutroRatioAssets: require('../01_app/assets/steps/step04/step04-outro-ratio-assets.js'),
    Step04BrandStagePreview: require('../01_app/assets/steps/step04/step04-brand-stage-preview.js'),
    BrandOverlayController: require('../01_app/assets/steps/step04/step04-brand-overlay.js'),
    Step04TimelineBridge: require('../01_app/assets/steps/step04/step04-timeline-bridge.js'),
    Step04RenderController: require('../01_app/assets/steps/step04/step04-render-controller.js'),
    Step04NavigationController: require('../01_app/assets/steps/step04/step04-navigation-controller.js'),
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: (fn) => {
      if (typeof fn === 'function') {
        try { fn(); } catch (e) {}
      }
      return 1;
    },
    clearTimeout: () => {},
    document: documentStub,
    window: { scrollTo() {}, addEventListener() {}, StepPartialLoader: { load: async () => 0 } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    location: { href: 'https://tc.test/app.html' },
    fetch: async () => ({ ok: true, text: async () => partialHtml }),
    Audio: class { constructor() {} load() {} play() { return Promise.resolve(); } pause() {} },
    Image: class { constructor() {} },
    ResizeObserver: class { constructor() {} observe() {} }
  });

  return { context, elements, listeners };
}

const prePartialEnv = createPrePartialContext();
const scriptStart = html.indexOf('<script>') + '<script>'.length;
const scriptEnd = html.indexOf('async function boot()');
const scriptMatch = `${html.slice(scriptStart, scriptEnd > 0 ? scriptEnd : html.lastIndexOf('</script>'))}\n})();`;

assert.doesNotThrow(() => {
  vm.runInContext(scriptMatch, prePartialEnv.context);
}, 'Script evaluation before partial DOM insertion MUST NOT throw null reference errors');

console.log('✓ Pre-partial headless VM script evaluation completed without errors');

// 3. Post-Partial Load & Idempotent Init Test
const Step04VideoEditor = require('../01_app/assets/steps/step04/step04-video.js');
const VideoEditor = require('../01_app/assets/video-editor/index.js');

assert.equal(typeof Step04VideoEditor.initStep4UI, 'function', 'initStep4UI must be a function');
assert.equal(typeof Step04VideoEditor.setNarrationTracks, 'function', 'narration bridge target must be public');

// Simulate Partial Injection into DOM Container
const mockContainer = {
  innerHTML: partialHtml
};

assert.match(mockContainer.innerHTML, /id="sceneList"/, 'Container contains #sceneList after partial load');

// Test Pure Module Functions with Timeline Data
const sampleTimeline = {
  scenes: [
    { id: 'sc1', name: 'Scene 1', start: 0, end: 5, cueStart: 0.5, cueEnd: 4.5, text: '도입 타이틀' },
    { id: 'sc2', name: 'Scene 2', start: 5, end: 12, cueStart: 5.5, cueEnd: 11.5, text: '두 번째 타이틀' }
  ]
};

Step04VideoEditor.applyTimeline(sampleTimeline);
const duration = VideoEditor.SceneNav.calculateTimelineDuration(sampleTimeline.scenes);
assert.equal(duration, 12, 'Timeline duration should be 12 seconds');

// State Transitions (OUT -> Scene -> OUT)
let navState = VideoEditor.SceneNav.createInitialNavigationState(sampleTimeline.scenes, { initialTime: 0 });
assert.equal(navState.currentSceneIndex, 0);

navState = VideoEditor.SceneNav.navigateScene(sampleTimeline.scenes, navState, 'NEXT_SCENE');
assert.equal(navState.currentSceneIndex, 1);

navState = VideoEditor.SceneNav.navigateScene(sampleTimeline.scenes, navState, 'NEXT_SCENE');
assert.equal(navState.isOutro, true, 'Transition to OUT state');

navState = VideoEditor.SceneNav.navigateScene(sampleTimeline.scenes, navState, 'PREV_SCENE');
assert.equal(navState.isOutro, false);
assert.equal(navState.currentSceneIndex, 1);

// Mobile Sync State Calculation
const mSync = VideoEditor.MobileSync.computeMobileSyncState(sampleTimeline.scenes, 1, false, 6.0, 12.0);
assert.equal(mSync.selectedValue, '1');
assert.equal(mSync.options.length, 3, '2 scenes + 1 outro');
assert.equal(mSync.displayLabel, 'SCENE 02 / 02');

// Ratio Profiles Check (16:9, 9:16, 4:5, 1:1)
['16x9', '9x16', '4x5', '1x1'].forEach(fmt => {
  const profile = VideoEditor.RatioProfiles.getProfileByKey(fmt);
  assert.equal(profile.key, fmt);
});

// Phase 3: Configure, Payload Wrapping & Unit Conversion Tests
assert.equal(typeof Step04VideoEditor.configure, 'function', 'configure must be a function');
assert.equal(typeof Step04VideoEditor.persistRenderSettings, 'function', 'persistRenderSettings must be a function');

const testCatalog = {
  ratio_profiles: {
    custom_ratio: { key: '16x9', className: 'preview-landscape', label: 'Custom 16:9', safe: '' }
  },
  platform_preview_formats: {
    threads: { formatKey: '9x16', className: 'preview-portrait', label: 'Threads Custom', safe: 'SAFE' }
  }
};

const testEffective = {
  type: 'minimal',
  music: 'debussy',
  volume: 0.7,
  narration: true,
  preview_platform: 'threads',
  platforms: ['youtube', 'threads'],
  video_pan_x: 0.6, // 0..1 API unit => should map to 60 UI percent
  scene_dissolve_seconds: 1.0,
  caption_size: 2
};

Step04VideoEditor.configure(testEffective, testCatalog);
assert.equal(Step04VideoEditor.isConfigured(), true, 'isConfigured should return true after configure call');
assert.equal(Step04VideoEditor.getConfiguredSettings().type, 'minimal');

// Verify unit conversion in getEffectiveSettingsPayload (60% UI pan -> 0.6 API pan, numeric volume)
const payload = Step04VideoEditor.getEffectiveSettingsPayload();
assert.equal(payload.type, 'minimal', 'type should be minimal from configured settings');
assert.equal(payload.music, 'debussy', 'music should be debussy from configured settings');
assert.equal(typeof payload.volume, 'number', 'volume must be numeric');
assert.equal(payload.volume, 0.7, 'volume should be 0.7');
assert.equal(payload.video_pan_x, 0.6, 'video_pan_x should convert back to 0..1 decimal unit');
assert.equal(payload.scene_dissolve_seconds, 1.0, 'scene_dissolve_seconds preserved');
assert.deepEqual(payload.platforms, ['youtube', 'threads'], 'platforms list should match configured effective settings');

// Verify setSceneCropPositions & getSceneCropPositions deep copy export
assert.equal(typeof Step04VideoEditor.getSceneCropPositions, 'function', 'getSceneCropPositions must be exported');
assert.equal(typeof Step04VideoEditor.setSceneCropPositions, 'function', 'setSceneCropPositions must be exported');
Step04VideoEditor.setSceneCropPositions({ sc1: { '9x16': 65 } });
const cropPositions = Step04VideoEditor.getSceneCropPositions();
assert.equal(typeof cropPositions, 'object', 'getSceneCropPositions should return an object');
assert.deepEqual(cropPositions.sc1, { '9x16': 65 }, 'setSceneCropPositions should populate crop positions');

console.log('✓ Phase 3 & 4 settings configuration, unit conversion, and payload wrapping tests passed');
console.log('✓ Strict lifecycle, pre-partial safety, and post-partial init tests passed');
