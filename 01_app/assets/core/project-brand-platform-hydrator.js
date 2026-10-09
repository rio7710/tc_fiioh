(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.ThinkCastProjectBrandPlatformHydrator=api})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  function create(dependencies){const deps=dependencies||{};for(const name of ['hydrateBrandSelections','renderBrandChoices','getPlatformButtons','getSelectedPlatforms','setPlatformPreview'])if(typeof deps[name]!=='function')throw new TypeError(`ThinkCastProjectBrandPlatformHydrator requires ${name}`);
    function applyContent(result){deps.hydrateBrandSelections({assets:result.brand_assets||[],selections:result.brand_selections||[]});deps.renderBrandChoices();if(Array.isArray(result.automation_editor?.channels)){const buttons=deps.getPlatformButtons(),channels=result.automation_editor.channels.filter(channel=>buttons.some(button=>button.dataset.platform===channel)),selectedPlatforms=deps.getSelectedPlatforms();selectedPlatforms.clear();channels.forEach(channel=>selectedPlatforms.add(channel));buttons.forEach(button=>button.setAttribute('aria-pressed',String(selectedPlatforms.has(button.dataset.platform))));if(channels.length)deps.setPlatformPreview(channels[0])}return result}
    return Object.freeze({applyContent})}
  return Object.freeze({create});
});
