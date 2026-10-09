(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.Step01ContentIndexController=api})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  function create(dependencies){
    const deps=dependencies||{};for(const name of ['request','getProjects','getActiveProjectId','beginNav','setActiveProjectId','showStep','showBrandLibrary','navigateProjectStep','resetProjectScopedState','setKeywordStageLocked','setVoiceProfile','getKeywords','setVisibleKeywordIds','renderKeywords','refreshProjectIndex','confirm','alert'])if(typeof deps[name]!=='function')throw new TypeError(`Step01ContentIndexController requires ${name}`);if(!deps.view||['mount','unmount','renderDetail','applyFilter','setNote','setBusy'].some(name=>typeof deps.view[name]!=='function'))throw new TypeError('Step01ContentIndexController requires view');
    let mounted=false;
    function openProject(projectId,historyMode='push'){const project=deps.getProjects()[projectId];if(!project)return;deps.beginNav();deps.setActiveProjectId(projectId);deps.view.renderDetail(projectId,project);deps.showStep('project',historyMode)}
    function applyFilter(filter){deps.showBrandLibrary(false);deps.view.applyFilter(filter)}
    async function continueProject(targetStep='2'){try{await deps.navigateProjectStep(targetStep||'2')}catch(error){deps.view.setNote(error.message)}}
    async function deleteProject(){const activeProjectId=deps.getActiveProjectId();if(!activeProjectId)return;const project=deps.getProjects()[activeProjectId];if(!deps.confirm(`“${project?.title||'이 콘텐츠'}”를 삭제할까요?\n저장된 제작 데이터도 함께 삭제됩니다.`))return;deps.view.setBusy('delete',true);try{await deps.request('/api/project/delete',{method:'POST',body:JSON.stringify({project_id:activeProjectId})});deps.resetProjectScopedState();deps.setActiveProjectId(null);deps.setKeywordStageLocked(false);await deps.refreshProjectIndex();deps.showStep('index')}catch(error){deps.view.setNote(error.message)}finally{deps.view.setBusy('delete',false)}}
    async function createProject(){deps.view.setBusy('create',true);try{const result=await deps.request('/api/projects',{method:'POST',body:JSON.stringify({name:'새 콘텐츠'})});deps.resetProjectScopedState();deps.setActiveProjectId(result.project.project_id);deps.setKeywordStageLocked(false);deps.setVoiceProfile('warm_female');deps.setVisibleKeywordIds(deps.getKeywords().filter(item=>!item.seasonal).slice(0,8).map(item=>item.id));deps.renderKeywords();await deps.refreshProjectIndex();deps.showStep(2)}catch(error){deps.alert(error.message)}finally{deps.view.setBusy('create',false)}}
    function mount(rootNode){if(mounted)return true;try{deps.view.mount(rootNode,{openProject,applyFilter,continueProject,deleteProject,createProject});mounted=true;return true}catch(error){deps.view.unmount();throw error}}
    function unmount(){deps.view.unmount();mounted=false;return true}
    return Object.freeze({mount,unmount,openProject,applyFilter,continueProject,deleteProject,createProject});
  }
  return Object.freeze({create});
});
