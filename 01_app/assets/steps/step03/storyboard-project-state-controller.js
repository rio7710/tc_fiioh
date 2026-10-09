(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Step03StoryboardProjectStateController = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const required = [
    'getRoot', 'getScenes', 'setScenes', 'setCurrentScene', 'connectTimeline',
    'resetTimeline', 'setDemoTimeline', 'setCropPositions', 'setImages',
    'setImageCandidates', 'setVoiceClips', 'setVideos', 'setVideoCandidates',
    'clearKeywords', 'setActiveStoryboardDocument', 'resetEditorCrops',
    'getStep04VideoEditor', 'getFallbackSync', 'resetProjectStore'
  ];

  function create(dependencies) {
    const deps = dependencies || {};
    required.forEach(name => {
      if (typeof deps[name] !== 'function') throw new TypeError(`Step03StoryboardProjectStateController requires ${name}`);
    });

    function grouped(items, label) {
      if (!Array.isArray(items)) throw new TypeError(`Step03StoryboardProjectStateController requires ${label} array`);
      const result = new Map();
      items.forEach(item => {
        if (!item || item.scene_id === undefined || item.scene_id === null) throw new TypeError(`Step03StoryboardProjectStateController requires ${label} scene_id`);
        const group = result.get(item.scene_id) || [];
        group.push(item);
        result.set(item.scene_id, group);
      });
      return result;
    }

    function setImageCandidates(items) {
      const result = grouped(items, 'image candidates');
      deps.setImageCandidates(result);
      return result;
    }

    function setVideoCandidates(items) {
      const result = grouped(items, 'video candidates');
      deps.setVideoCandidates(result);
      return result;
    }

    function connect() {
      const scenes = deps.getScenes();
      if (!Array.isArray(scenes)) throw new TypeError('Step03StoryboardProjectStateController requires scenes array');
      const connected = deps.connectTimeline(scenes);
      if (!connected || !Array.isArray(connected.scenes)) throw new TypeError('Step03StoryboardProjectStateController requires connected scenes array');
      deps.setScenes(connected.scenes);
      deps.setCurrentScene(-1);
      const rootNode = deps.getRoot();
      if (!rootNode || typeof rootNode.querySelector !== 'function') throw new TypeError('Step03StoryboardProjectStateController requires a DOM root');
      const video = rootNode.querySelector('#video');
      if (video) video.currentTime = 0;
      const editor = deps.getStep04VideoEditor();
      if (editor && typeof editor.sync === 'function') editor.sync();
      else {
        const fallback = deps.getFallbackSync();
        if (typeof fallback === 'function') fallback();
      }
      return connected.scenes;
    }

    function reset() {
      deps.setScenes([]);
      deps.resetTimeline();
      deps.setDemoTimeline({scenes: []});
      deps.setCurrentScene(-1);
      deps.setCropPositions({});
      deps.setImages(new Map());
      deps.setImageCandidates(new Map());
      deps.setVoiceClips(new Map());
      deps.setVideos(new Map());
      deps.setVideoCandidates(new Map());
      deps.clearKeywords();
      deps.setActiveStoryboardDocument(null);
      deps.resetEditorCrops({});
      deps.resetProjectStore();
    }

    return Object.freeze({setImageCandidates, setVideoCandidates, connect, reset});
  }

  return Object.freeze({create});
}));
