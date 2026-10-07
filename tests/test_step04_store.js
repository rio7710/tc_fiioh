const assert = require('node:assert/strict');
const Step04Store = require('../01_app/assets/steps/step04/step04-store.js');

const store = Step04Store.create({
  currentScene: 2,
  selectedPlatforms: new Set(['youtube']),
  sceneCropPositions: {scene1: {'9x16': 35}}
});

assert.equal(store.get('currentScene'), 2);
assert.deepEqual([...store.get('selectedPlatforms')], ['youtube']);

const platforms = store.get('selectedPlatforms');
platforms.add('instagram');
assert.deepEqual([...store.get('selectedPlatforms')], ['youtube'], 'get does not expose a mutable Set');

const cropPositions = store.get('sceneCropPositions');
cropPositions.scene1['9x16'] = 90;
assert.equal(store.get('sceneCropPositions').scene1['9x16'], 35, 'get does not expose a mutable object');

const notifications = [];
const unsubscribe = store.subscribe((snapshot, changedKeys) => {
  notifications.push({snapshot, changedKeys});
  snapshot.sceneCropPositions.changed = true;
});
store.set('videoPanX', 72);
store.patch({captionSizeLevel: 3, narrationEnabled: false});
assert.equal(store.get('videoPanX'), 72);
assert.equal(store.get('captionSizeLevel'), 3);
assert.equal(store.get('narrationEnabled'), false);
assert.deepEqual(notifications.map(item => item.changedKeys), [
  ['videoPanX'],
  ['captionSizeLevel', 'narrationEnabled']
]);
assert.equal(store.get('sceneCropPositions').changed, undefined, 'subscriber snapshots are isolated');

unsubscribe();
store.set('currentVolume', 0.2);
assert.equal(notifications.length, 2, 'unsubscribe stops notifications');

const snapshot = store.snapshot();
snapshot.selectedPlatforms.add('naver');
assert.deepEqual([...store.get('selectedPlatforms')], ['youtube'], 'snapshot is isolated');

store.reset({currentType: 'minimal'});
assert.equal(store.get('currentType'), 'minimal');
assert.equal(store.get('currentScene'), -1, 'reset restores unspecified defaults');
assert.deepEqual([...store.get('selectedPlatforms')], ['youtube', 'instagram', 'naver']);

assert.throws(() => store.get('brandAssets'), /Unknown Step04Store key/);
assert.throws(() => store.set('brandAssets', []), /Unknown Step04Store key/);
assert.throws(() => store.patch({outroProfiles: {}}), /Unknown Step04Store key/);

console.log('Step 4 store isolation tests passed.');
