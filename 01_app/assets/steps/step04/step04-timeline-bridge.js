/* Step 03 -> Step 04 timeline and narration bridge. */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Step04TimelineBridge = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_NARRATION_TRACKS = [
    { rate: 1, src: '/02_media/narration/audio_0.mp3' },
    { rate: 1.1, src: '/02_media/narration/audio_1.mp3' },
    { rate: 1, src: '/02_media/narration/audio_2.mp3' },
    { rate: 1, src: '/02_media/narration/audio_3.mp3' },
    { rate: 1, src: '/02_media/narration/audio_4.mp3' },
    { rate: 1, src: '/02_media/narration/audio_5.mp3' },
    { rate: 1, src: '/02_media/narration/audio_6.mp3' },
    { rate: 1.02, src: '/02_media/narration/audio_7.mp3' },
    { rate: 1.02, src: '/02_media/narration/audio_8.mp3' },
    { rate: 1, src: '/02_media/narration/audio_9.mp3' },
    { rate: 1, src: '/02_media/narration/audio_10.mp3' },
    { rate: 1.1, src: '/02_media/narration/audio_11.mp3' },
    { rate: 1, src: '/02_media/narration/audio_12.mp3' },
    { rate: 1.16, src: '/02_media/narration/audio_13.mp3' }
  ];

  function normalizeNarrationSrc(src) {
    if (!src) return '';
    const value = String(src);
    const match = value.match(/^(?:https?:\/\/[^/]+)?(\/02_media\/narration\/audio_\d+)/i);
    if (match) return `${match[1]}.mp3`;
    return value.replace(/\/02_media\/narration\/audio_(\d+).*\.mp3$/i, '/02_media/narration/audio_$1.mp3');
  }

  function create(initialDependencies) {
    let dependencies = {};
    let scenes = [];
    let titleSceneIndexes = [];
    let narrationTracks = [];
    let narrations = [];
    let narrationAudios = [];

    function configure(next) {
      if (next && typeof next === 'object') dependencies = { ...dependencies, ...next };
      return api;
    }

    function pauseAudios() {
      narrationAudios.forEach(audio => {
        if (audio && typeof audio.pause === 'function') audio.pause();
      });
    }

    function createAudio(track) {
      if (!track.src) return null;
      const audio = dependencies.createAudio ? dependencies.createAudio(track.src) : new Audio(track.src);
      audio.preload = 'auto';
      audio.volume = .95;
      audio.playbackRate = track.rate;
      return audio;
    }

    function notifyEditor() {
      if (typeof dependencies.setEditorNarrationTracks === 'function') {
        dependencies.setEditorNarrationTracks({ narrations: narrations.slice(), narrationAudios: narrationAudios.slice() });
      }
    }

    function setNarrationTracks(tracks) {
      pauseAudios();
      if (typeof dependencies.resetActiveNarration === 'function') dependencies.resetActiveNarration();
      const list = Array.isArray(tracks) && tracks.length ? tracks : narrationTracks;
      narrationTracks = list.map(item => ({ rate: Number(item?.rate) || 1, src: normalizeNarrationSrc(item?.src) }));
      narrationAudios = narrationTracks.map(createAudio);
      notifyEditor();
      return getNarrationTracks();
    }

    function rebuildNarrations() {
      titleSceneIndexes = scenes.map((scene, index) => scene.scriptLineIndex == null ? null : index).filter(index => index != null);
      if (titleSceneIndexes.length && titleSceneIndexes.length !== narrationTracks.length) {
        setNarrationTracks(titleSceneIndexes.map((_, index) => narrationTracks[index] || { rate: 1, src: '' }));
      }
      narrations = titleSceneIndexes.map((sceneIndex, index) => ({
        start: scenes[sceneIndex].cueStart,
        end: scenes[sceneIndex].cueEnd,
        ...narrationTracks[index]
      }));
      notifyEditor();
    }

    function applyTimeline(timeline) {
      const source = Array.isArray(timeline?.scenes) ? timeline.scenes : [];
      if (!source.length) throw new Error('이전 단계의 장면 타임라인이 없습니다.');
      if (Array.isArray(timeline?.narration_tracks)) setNarrationTracks(timeline.narration_tracks);
      scenes = source.map((item, index) => ({
        id: item.id || `scene-${index + 1}`,
        name: item.name || `장면 ${index + 1}`,
        mediaType: item.media_type === 'video' ? 'video' : 'image',
        image: item.preview_uri || '',
        start: Number(item.start), end: Number(item.end),
        cueStart: item.cue_start == null ? null : Number(item.cue_start),
        cueEnd: item.cue_end == null ? null : Number(item.cue_end),
        scriptLineIndex: item.script_line_index == null ? null : Number(item.script_line_index),
        text: ''
      }));
      rebuildNarrations();
      if (typeof dependencies.applyEditorTimeline === 'function') dependencies.applyEditorTimeline({ scenes: getScenes() });
      if (typeof dependencies.onTimelineApplied === 'function') dependencies.onTimelineApplied(getScenes());
      return snapshot();
    }

    function connectStoryboardAssetsToEditor(sourceScenes) {
      scenes = (Array.isArray(sourceScenes) ? sourceScenes : scenes).map(scene => {
        const image = dependencies.getStoryboardImage?.(scene.id);
        const generatedVideo = dependencies.getStoryboardVideo?.(scene.id);
        return { ...scene, image: image?.uri || scene.image, storyboardImage: image || null, generatedVideo: generatedVideo || null };
      });
      const connected = titleSceneIndexes.map((sceneIndex, index) => {
        const voice = dependencies.getSceneVoice?.(scenes[sceneIndex].id);
        return { rate: Number(narrationTracks[index]?.rate) || 1, src: voice?.uri || narrationTracks[index]?.src || '' };
      });
      setNarrationTracks(connected);
      rebuildNarrations();
      if (typeof dependencies.applyEditorTimeline === 'function') dependencies.applyEditorTimeline({ scenes: getScenes() });
      if (typeof dependencies.onTimelineApplied === 'function') dependencies.onTimelineApplied(getScenes());
      return snapshot();
    }

    function applyScript(script) {
      const lines = Array.isArray(script?.lines) ? script.lines : [];
      scenes = scenes.map(scene => ({
        ...scene,
        text: scene.scriptLineIndex == null ? scene.text : (lines[scene.scriptLineIndex] || '')
      }));
      if (typeof dependencies.applyEditorTimeline === 'function') dependencies.applyEditorTimeline({ scenes: getScenes() });
      return snapshot();
    }

    function reset() {
      scenes = [];
      titleSceneIndexes = [];
      narrations = [];
      narrationTracks = DEFAULT_NARRATION_TRACKS.map(track => ({ ...track }));
      setNarrationTracks(narrationTracks);
      return snapshot();
    }

    const getScenes = () => scenes.map(scene => ({ ...scene }));
    const getTitleSceneIndexes = () => titleSceneIndexes.slice();
    const getNarrationTracks = () => narrationTracks.map(track => ({ ...track }));
    const getNarrations = () => narrations.map(item => ({ ...item }));
    const getNarrationAudios = () => narrationAudios.slice();
    const snapshot = () => ({ scenes: getScenes(), titleSceneIndexes: getTitleSceneIndexes(), narrationTracks: getNarrationTracks(), narrations: getNarrations(), narrationAudios: getNarrationAudios() });
    const api = { configure, normalizeNarrationSrc, setNarrationTracks, applyTimeline, connectStoryboardAssetsToEditor, applyScript, reset, getScenes, getTitleSceneIndexes, getNarrationTracks, getNarrations, getNarrationAudios, snapshot };
    configure(initialDependencies);
    narrationTracks = DEFAULT_NARRATION_TRACKS.map(track => ({ ...track }));
    setNarrationTracks(narrationTracks);
    return api;
  }

  return { create, normalizeNarrationSrc, DEFAULT_NARRATION_TRACKS: DEFAULT_NARRATION_TRACKS.map(track => ({ ...track })) };
}));
