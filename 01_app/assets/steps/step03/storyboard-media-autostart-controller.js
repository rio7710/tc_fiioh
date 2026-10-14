(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.Step03StoryboardMediaAutostartController=api})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const required=['getActiveProjectId','generateMissingVoices','generateMissingImages','setStatus','onError'];
  function create(dependencies){
    const deps=dependencies||{};required.forEach(name=>{if(typeof deps[name]!=='function')throw new TypeError(`Step03StoryboardMediaAutostartController requires ${name}`)});
    const runs=new Map();
    function start(){
      const projectId=deps.getActiveProjectId();
      if(!projectId)return Promise.resolve(false);
      if(runs.has(projectId))return runs.get(projectId);
      deps.setStatus('미생성 음성과 이미지를 자동으로 확인하고 생성합니다.');
      const tasks=[['voice',deps.generateMissingVoices],['image',deps.generateMissingImages]];
      const run=Promise.allSettled(tasks.map(([kind,operation])=>Promise.resolve().then(operation).catch(error=>{deps.onError(kind,error);throw error}))).then(results=>{
        if(deps.getActiveProjectId()!==projectId)return results;
        const failures=results.filter(result=>result.status==='rejected');
        deps.setStatus(failures.length?`자동 생성 중 ${failures.length}개 작업을 완료하지 못했습니다. 아래 오류를 확인한 뒤 다시 시도해 주세요.`:'미생성 음성과 이미지 자동 생성을 완료했습니다.');
        return results;
      }).finally(()=>{if(runs.get(projectId)===run)runs.delete(projectId)});
      runs.set(projectId,run);
      return run;
    }
    return Object.freeze({start,isRunning:projectId=>runs.has(projectId||deps.getActiveProjectId())});
  }
  return Object.freeze({create});
});
