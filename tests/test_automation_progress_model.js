const assert = require('node:assert/strict');
const Model = require('../01_app/assets/core/automation-progress-model.js');

let value=Model.view({settings:null,runs:[]});
assert.equal(value.enabled,false);
assert.equal(value.percent,0);
assert.equal(value.stage,'대기');

value=Model.view({settings:{enabled:1,next_run_at:'2030-01-01T00:00:00Z'},runs:[{status:'running',stage:'script_generate',attempt:1}]});
assert.equal(value.enabled,true);
assert.equal(value.active,true);
assert.equal(value.stage,'대본·콘티 생성');
assert.equal(value.percent,30);
assert.equal(value.phases.find(item=>item.key==='script').state,'active');

value=Model.view({settings:{enabled:0,config:{endpoint:'4'}},runs:[]});
assert.deepEqual(value.phases.map(item=>item.state),['configured','configured','configured','configured','configured','configured','pending']);

value=Model.view({settings:{enabled:0},runs:[{status:'failed',stage:'video_complete_scene-02',error_message:'Kling 오류'}]});
assert.equal(value.state,'오류');
assert.equal(value.stage,'Kling 영상 변환');
assert.equal(value.detail,'Kling 오류');
assert.equal(value.percent,78);

value=Model.view({settings:{enabled:0,config:{endpoint:'3'}},runs:[{status:'succeeded',stage:'script_confirm'}]});
assert.equal(value.percent,100);
assert.deepEqual(value.phases.map(item=>item.state),['done','done','pending','pending','pending','pending','pending']);
console.log('Automation progress model tests passed');
