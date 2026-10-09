(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.ThinkCastProjectMediaHydrator=api})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  function create(dependencies){const deps=dependencies||{};for(const name of ['setSceneCropPositions','setStoryboardImages','setStoryboardImageCandidates','setStoryboardVoiceClips','setStoryboardVideos','setStoryboardVideoCandidates','setVoiceProfile'])if(typeof deps[name]!=='function')throw new TypeError(`ThinkCastProjectMediaHydrator requires ${name}`);
    function contentProfile(result){return result.voice_profile||'warm_female'}function stateProfile(result){return result.content?.voice_profile||'warm_female'}
    function applyCropPositions(result){if(result.scene_crop_positions)deps.setSceneCropPositions(result.scene_crop_positions)}
    function applyMedia(result,voiceProfile){deps.setStoryboardImages(new Map((result.storyboard_images||[]).map(item=>[item.scene_id,item])));deps.setStoryboardImageCandidates(result.storyboard_image_candidates||[]);deps.setStoryboardVoiceClips(new Map((result.storyboard_voice_clips||[]).filter(item=>!item.profile_id||item.profile_id===voiceProfile).map(item=>[item.scene_id,item])));deps.setStoryboardVideos(new Map((result.storyboard_videos||[]).map(item=>[item.scene_id,item])));deps.setStoryboardVideoCandidates(result.storyboard_video_candidates||[])}
    function applyVoiceProfile(voiceProfile){deps.setVoiceProfile(voiceProfile)}
    return Object.freeze({contentProfile,stateProfile,applyCropPositions,applyMedia,applyVoiceProfile})}
  return Object.freeze({create});
});
