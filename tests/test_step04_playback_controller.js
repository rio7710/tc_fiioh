const assert = require('node:assert/strict');
const PlaybackController = require('../01_app/assets/steps/step04/step04-playback-controller.js');

(async () => {

function media(initial = {}) {
  const listeners = {};
  return Object.assign({
    paused: true, currentTime: 0, duration: 0, readyState: 0, playCount: 0, pauseCount: 0, loadCount: 0,
    addEventListener(type, fn, options) { (listeners[type] ||= []).push({ fn, once: Boolean(options?.once) }); },
    emit(type) { const items = [...(listeners[type] || [])]; listeners[type] = (listeners[type] || []).filter(item => !item.once); items.forEach(item => item.fn()); },
    listenerCount(type) { return (listeners[type] || []).length; },
    play() { this.paused = false; this.playCount += 1; return Promise.resolve(); },
    pause() { this.paused = true; this.pauseCount += 1; }, load() { this.loadCount += 1; }
  }, initial);
}
function button(track) {
  const classes = new Set();
  return { dataset: { music: track }, attrs: {}, textContent: '', classList: { toggle(name, force) { force ? classes.add(name) : classes.delete(name); }, contains: name => classes.has(name) }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(type, fn) { this[type] = fn; } };
}

const video = media({ currentTime: 12, paused: true });
const bgm = media({ duration: 5, readyState: 1, currentTime: 1.7 });
const sceneVideo = media();
const playBtn = button();
const musicButtons = [button('satie'), button('none')];
const nodes = { '#video': video, '#bgm': bgm, '#sceneVideo': sceneVideo, '#playBtn': playBtn };
const root = { querySelector: selector => nodes[selector] || null, querySelectorAll: selector => selector === '.music-btn[data-music]' ? musicButtons : [] };
let selected = 'satie';
let catalog = { music: { satie: { uri: 'media/catalog-satie.mp3' } } };
let saves = 0, syncs = 0, stops = 0, narrationSyncs = 0, panUpdates = 0, errors = 0;
const controller = PlaybackController.create({
  root, getSelectedMusic: () => selected, setSelectedMusic: value => { selected = value; }, getCatalog: () => catalog,
  saveEditorSettings: () => { saves += 1; }, sync: () => { syncs += 1; }, stopNarration: () => { stops += 1; },
  syncNarration: (time, force) => { assert.equal(time, video.currentTime); assert.equal(force, true); narrationSyncs += 1; },
  updatePanAvailability: () => { panUpdates += 1; }, onError: () => { errors += 1; }
});

assert.equal(controller.mount(), true);
assert.equal(controller.mount(), true);
assert.equal(video.listenerCount('play'), 1, 'mount is idempotent');
assert.equal(playBtn.click ? 1 : 0, 1, 'play button is bound once');

controller.setMusic('satie');
assert.equal(bgm.src, '/media/catalog-satie.mp3', 'catalog URI gains a leading slash');
assert.equal(bgm.loadCount, 1);
assert.equal(musicButtons[0].classList.contains('active'), true);
assert.equal(musicButtons[0].attrs['aria-pressed'], 'true');
assert.equal(saves, 1);
video.paused = false; bgm.emit('loadedmetadata');
assert.equal(bgm.currentTime, 2, 'loaded metadata aligns BGM modulo video time');
assert.equal(bgm.playCount, 1, 'loaded metadata resumes BGM while video plays');

catalog = { music: {} };
controller.setMusic('custom');
assert.equal(bgm.src, '/02_media/music/custom.mp3', 'unknown catalog track uses legacy generic fallback');
const loadsBeforeNone = bgm.loadCount;
controller.setMusic('none');
assert.equal(bgm.loadCount, loadsBeforeNone, 'none does not load or play BGM');

selected = 'satie'; video.currentTime = 12; bgm.duration = 5; bgm.readyState = 1; bgm.currentTime = 2.25;
controller.alignMusic();
assert.equal(bgm.currentTime, 2.25, 'drift at 0.25 is preserved');
bgm.currentTime = 2.251; controller.alignMusic();
assert.equal(bgm.currentTime, 2, 'drift above 0.25 is corrected');

video.paused = true; controller.togglePlay(); assert.equal(video.playCount, 1);
video.paused = false; controller.togglePlay(); assert.equal(video.pauseCount, 1);
video.emit('play'); assert.equal(playBtn.textContent, '일시정지'); assert.equal(playBtn.attrs['aria-label'], '일시정지');
video.emit('pause'); assert.equal(playBtn.textContent, '재생'); assert.equal(sceneVideo.pauseCount, 1); assert.ok(bgm.pauseCount >= 1); assert.equal(stops, 1);
video.emit('seeked'); assert.equal(narrationSyncs, 1);
video.emit('loadedmetadata'); assert.equal(panUpdates, 1);
video.emit('ended'); assert.ok(bgm.pauseCount >= 2);
assert.ok(syncs >= 5, 'playback lifecycle synchronizes preview state');

video.play = () => Promise.reject(new Error('blocked'));
video.paused = true;
assert.doesNotThrow(() => controller.togglePlay());
await new Promise(resolve => setImmediate(resolve));
assert.equal(errors, 1, 'play rejection is reported and isolated');

assert.equal(PlaybackController.create({}).mount(), false, 'optional DOM is safe');
console.log('Step04 playback controller tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
