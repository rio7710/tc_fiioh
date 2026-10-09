(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ThinkCastProjectHydrationController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(dependencies) {
    const deps = dependencies || {};
    for (const name of [
      'request', 'isStale', 'getActiveProjectId', 'setSceneCropPositions',
      'setDemoTimeline', 'mergeDemoState', 'setSelectedKeywords',
      'setActiveStoryboardDocument', 'setKeywordStageLocked',
      'setStoryboardImages', 'setStoryboardImageCandidates', 'setStoryboardVoiceClips',
      'setStoryboardVideos', 'setStoryboardVideoCandidates', 'setVoiceProfile',
      'hydrateBrandSelections', 'renderBrandChoices', 'getPlatformButtons',
      'getSelectedPlatforms', 'setPlatformPreview', 'applyTimeline',
      'connectStoryboardAssetsToEditor', 'fillScript', 'applyScript',
      'getDemoKeywords', 'setDemoKeywords', 'setSeasonalKeywordIds',
      'setVisibleKeywordIds', 'renderKeywords'
    ]) if (typeof deps[name] !== 'function') throw new TypeError(`ThinkCastProjectHydrationController requires ${name}`);

    async function loadContent(projectId, token) {
      const result = await deps.request(`/api/project-content?project_id=${encodeURIComponent(projectId)}`);
      if (deps.isStale(token) || projectId !== deps.getActiveProjectId()) return result;
      if (result.scene_crop_positions) deps.setSceneCropPositions(result.scene_crop_positions);
      deps.setDemoTimeline(result.timeline);
      deps.mergeDemoState({script: result.script, selected_keywords: result.selected_keyword_ids || []});
      deps.setSelectedKeywords(new Set(result.selected_keyword_ids || []));
      deps.setActiveStoryboardDocument(result.document || null);
      deps.setKeywordStageLocked(Boolean(result.document));
      deps.setStoryboardImages(new Map((result.storyboard_images || []).map(item => [item.scene_id, item])));
      deps.setStoryboardImageCandidates(result.storyboard_image_candidates || []);
      const voiceProfile = result.voice_profile || 'warm_female';
      deps.setStoryboardVoiceClips(new Map((result.storyboard_voice_clips || [])
        .filter(item => !item.profile_id || item.profile_id === voiceProfile)
        .map(item => [item.scene_id, item])));
      deps.setStoryboardVideos(new Map((result.storyboard_videos || []).map(item => [item.scene_id, item])));
      deps.setStoryboardVideoCandidates(result.storyboard_video_candidates || []);
      deps.setVoiceProfile(voiceProfile);
      deps.hydrateBrandSelections({assets: result.brand_assets || [], selections: result.brand_selections || []});
      deps.renderBrandChoices();
      if (Array.isArray(result.automation_editor?.channels)) {
        const buttons = deps.getPlatformButtons();
        const channels = result.automation_editor.channels.filter(channel => buttons.some(button => button.dataset.platform === channel));
        const selectedPlatforms = deps.getSelectedPlatforms();
        selectedPlatforms.clear();
        channels.forEach(channel => selectedPlatforms.add(channel));
        buttons.forEach(button => button.setAttribute('aria-pressed', String(selectedPlatforms.has(button.dataset.platform))));
        if (channels.length) deps.setPlatformPreview(channels[0]);
      }
      deps.applyTimeline(result.timeline);
      deps.connectStoryboardAssetsToEditor();
      deps.fillScript(result.script);
      deps.applyScript(result.script);
      return result;
    }

    async function loadState(projectId, token) {
      const result = await deps.request(`/api/project-state?project_id=${encodeURIComponent(projectId)}`);
      if (deps.isStale(token) || projectId !== deps.getActiveProjectId()) return result;
      if (result.scene_crop_positions) deps.setSceneCropPositions(result.scene_crop_positions);
      deps.setStoryboardImages(new Map((result.storyboard_images || []).map(item => [item.scene_id, item])));
      deps.setStoryboardImageCandidates(result.storyboard_image_candidates || []);
      const voiceProfile = result.content?.voice_profile || 'warm_female';
      deps.setStoryboardVoiceClips(new Map((result.storyboard_voice_clips || [])
        .filter(item => !item.profile_id || item.profile_id === voiceProfile)
        .map(item => [item.scene_id, item])));
      deps.setStoryboardVideos(new Map((result.storyboard_videos || []).map(item => [item.scene_id, item])));
      deps.setStoryboardVideoCandidates(result.storyboard_video_candidates || []);
      const keywordState = result.keywords || {};
      const ids = keywordState.selected_keyword_ids || [];
      const labels = keywordState.selected_keywords || [];
      const savedAi = Array.isArray(result.seasonal_keywords) ? result.seasonal_keywords : [];
      const keywords = [...deps.getDemoKeywords().filter(item => !item.seasonal), ...savedAi];
      ids.forEach((id, index) => {
        if (!keywords.some(item => item.id === id)) keywords.push({
          id, label: labels[index] || id, description: '저장된 AI 추천 키워드', image: 'warmth', seasonal: true
        });
      });
      deps.setDemoKeywords(keywords);
      const selectedKeywords = new Set(ids);
      deps.setSelectedKeywords(selectedKeywords);
      const aiItems = keywords.filter(item => item.seasonal);
      const aiIds = new Set(aiItems.map(item => item.id));
      const selectedAi = aiItems.filter(item => selectedKeywords.has(item.id));
      deps.setSeasonalKeywordIds(new Set(selectedAi.map(item => item.id)));
      const selectedBase = ids.filter(id => !aiIds.has(id));
      const basePool = [...new Set([...selectedBase, ...keywords.filter(item => !item.seasonal).map(item => item.id)])];
      deps.setVisibleKeywordIds([
        ...basePool.slice(0, Math.max(0, 8 - selectedAi.length)),
        ...selectedAi.map(item => item.id)
      ]);
      deps.renderKeywords();
      if (result.content) {
        deps.setKeywordStageLocked(true);
        deps.setActiveStoryboardDocument(result.content.document || null);
        deps.setVoiceProfile(voiceProfile);
        deps.setDemoTimeline(result.content.timeline);
        deps.mergeDemoState({script: result.content.script, selected_keywords: ids});
        deps.applyTimeline(result.content.timeline);
        deps.fillScript(result.content.script);
        deps.applyScript(result.content.script);
      } else deps.setKeywordStageLocked(false);
      return result;
    }

    return Object.freeze({loadContent, loadState});
  }

  return Object.freeze({create});
});
