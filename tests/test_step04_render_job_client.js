const assert = require('node:assert/strict');
const Client = require('../01_app/assets/steps/step04/step04-render-job-client.js');

(async () => {
  let accepted = '';
  const states = [
    {status: 'queued'},
    {status: 'running', phase: 'audio_mux'},
    {status: 'succeeded', response: {ok: true, exports: [{url: '/final.mp4'}]}},
  ];
  const result = await Client.resolve({
    request: Promise.resolve({
      ok: true, status: 202,
      json: async () => ({job_id: 'existing-job', status_url: '/api/render/status?job_id=existing-job'}),
    }),
    jobId: 'requested-job', api: async () => states.shift(), sleep: async () => {},
    onAccepted: jobId => { accepted = jobId; },
  });
  assert.equal(accepted, 'existing-job');
  assert.equal(result.exports[0].url, '/final.mp4');

  await assert.rejects(
    Client.resolve({
      request: Promise.resolve({ok: true, status: 202, json: async () => ({job_id: 'failed-job'})}),
      jobId: 'failed-job', api: async () => ({status: 'failed', error: {message: 'safe failure'}}),
      sleep: async () => {}, maxAttempts: 1,
    }),
    /safe failure/,
  );

  const recovered = await Client.resolve({
    request: Promise.reject(new Error('gateway dropped')), jobId: 'recover-job',
    api: async () => ({status: 'succeeded', response: {ok: true, filename: 'recovered.mp4'}}),
    sleep: async () => {}, maxAttempts: 1,
  });
  assert.equal(recovered.filename, 'recovered.mp4');
  console.log('Step04 render job client tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
