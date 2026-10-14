(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ThinkCastAutomationProgressModel = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const phases = Object.freeze([
    Object.freeze({key:'prepare', label:'준비', percent:5, matches:['create_project','keywords_']}),
    Object.freeze({key:'script', label:'대본', percent:30, matches:['script_']}),
    Object.freeze({key:'voice', label:'음성', percent:47, matches:['voice_']}),
    Object.freeze({key:'image', label:'이미지', percent:62, matches:['image_']}),
    Object.freeze({key:'video', label:'영상', percent:78, matches:['video_']}),
    Object.freeze({key:'design', label:'디자인', percent:88, matches:['crop_','video_design']}),
    Object.freeze({key:'export', label:'최종 출력', percent:96, matches:['final_export_calendar']})
  ]);
  const statusLabels = Object.freeze({queued:'대기 중',running:'진행 중',succeeded:'완료',failed:'오류',cancelled:'중지'});

  function phaseFor(stage) {
    const value=String(stage||'create_project');
    return phases.find(phase=>phase.matches.some(prefix=>value===prefix||value.startsWith(prefix)))||phases[0];
  }

  function stageLabel(stage) {
    const value=String(stage||'create_project');
    if(value==='create_project')return '콘텐츠 준비';
    if(value==='keywords_select')return '키워드 선택';
    if(value==='keywords_confirm')return '키워드 확정';
    if(value==='script_plan')return '대본 구성';
    if(value==='script_generate')return '대본·콘티 생성';
    if(value==='script_confirm')return '대본 확정';
    if(value==='voice_select')return '음성 선택';
    if(value==='voice_prepare')return '음성 생성';
    if(value==='video_scene_selection')return '영상 장면 선택';
    if(value.startsWith('image_'))return '장면 이미지 생성';
    if(value.startsWith('video_submit_'))return 'Kling 변환 요청';
    if(value.startsWith('video_complete_'))return 'Kling 영상 변환';
    if(value.startsWith('crop_'))return '화면 비율 맞춤';
    if(value==='video_design')return '영상 디자인 저장';
    if(value==='final_export_calendar')return '최종 영상·캘린더 등록';
    return value.replaceAll('_',' ');
  }

  function view(snapshot) {
    const data=snapshot||{},runs=Array.isArray(data.runs)?data.runs:[];
    const active=runs.find(run=>run&&['queued','running'].includes(run.status))||null;
    const latest=active||runs[0]||null;
    const enabled=Boolean(data.settings?.enabled||active);
    const phase=phaseFor(latest?.stage);
    let percent=0,state='꺼짐',detail='자동 제작 스위치를 켜면 저장된 설정으로 시작합니다.';
    if(active){
      percent=active.status==='queued'?2:phase.percent;
      state=statusLabels[active.status];
      detail=active.status==='queued'?'실행 순서를 기다리고 있습니다.':`${stageLabel(active.stage)} 작업을 처리하고 있습니다.`;
    }else if(data.settings?.enabled){
      state='예약 중';detail=data.settings.next_run_at?'다음 실행이 예약되어 있습니다.':'다음 실행을 준비하고 있습니다.';
    }else if(latest?.status==='succeeded'){
      percent=100;state='최근 완료';detail='최근 자동 제작이 정상 완료됐습니다.';
    }else if(latest?.status==='failed'){
      percent=phase.percent;state='오류';detail=latest.error_message||`${stageLabel(latest.stage)} 단계에서 중지됐습니다.`;
    }else if(latest?.status==='cancelled'){
      percent=phase.percent;state='중지';detail=`${stageLabel(latest.stage)} 단계에서 중지됐습니다.`;
    }
    const activeIndex=phases.findIndex(item=>item.key===phase.key);
    return Object.freeze({
      enabled,active:Boolean(active),state,detail,percent,stage:latest?stageLabel(latest.stage):'대기',
      nextRunAt:data.settings?.next_run_at||null,latest,
      phases:phases.map((item,index)=>Object.freeze({...item,state:percent===100?'done':index<activeIndex?'done':index===activeIndex&&active?'active':'pending'})),
      runs
    });
  }

  return Object.freeze({view, phaseFor, stageLabel});
});
