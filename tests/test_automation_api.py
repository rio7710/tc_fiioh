import json
import tempfile
import threading
import unittest
import uuid
from pathlib import Path
from unittest import mock
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
from test_pipeline_contracts import load_render_server
from test_automation import config,BASE,NOW
from automation_runner import AutomationRunner,InternalAPI
from automation_store import AutomationStore


class AutomationAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.module=load_render_server()
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.auth=self.module.AuthStore(Path(self.tmp.name)/'auth.sqlite')
        self.user=self.auth.create_user('api_automation_test','strong-test-password')['user_id']
        self.token=self.auth.create_session(self.user)
        self.patch=mock.patch.object(self.module,'get_auth_store',return_value=self.auth);self.patch.start()
        self.http=ThreadingHTTPServer(('127.0.0.1',0),self.module.Handler)
        self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start()
        self.base='http://127.0.0.1:'+str(self.http.server_port)
    def tearDown(self):
        self.http.shutdown();self.http.server_close();self.thread.join();self.patch.stop();self.tmp.cleanup()
    def req(self,payload=None,token=None):
        body=json.dumps(payload).encode() if payload else None
        req=Request(self.base+'/api/automation',body,headers={'Content-Type':'application/json','Cookie':'thinkcast_session='+(self.token if token is None else token)})
        try:
            with urlopen(req,timeout=10) as response:return response.status,json.load(response)
        except HTTPError as exc:return exc.code,json.load(exc)
    def test_auth_validation_and_server_persistence(self):
        self.assertEqual(self.req(token='')[0],401)
        payload={'action':'save','request_id':str(uuid.uuid4()),'version':0,'config':config()}
        self.assertEqual(self.req(payload)[0],200)
        self.assertEqual(self.req()[1]['settings']['config']['keywords']['count'],3)
        self.assertEqual(self.req()[1]['runs'],[])
        payload['request_id']=str(uuid.uuid4())
        self.assertEqual(self.req(payload)[0],409)
        other=self.auth.create_user('api_other','strong-test-password')['user_id']
        self.assertIsNone(self.req(token=self.auth.create_session(other))[1]['settings'])
    def test_real_http_monthly_keywords_run_without_external_api(self):
        c=config();c['keywords'].update(ai=True,month='2026-10',count=5)
        payload={'action':'start','request_id':str(uuid.uuid4()),'version':0,'config':c}
        with mock.patch.object(self.module,'openai_seasonal_keywords',side_effect=AssertionError('Paid API must not run')):
            self.assertEqual(self.req(payload)[0],200)
            store=AutomationStore(self.auth);store.enqueue_due('2090-01-01T00:00:00+00:00')
            run=store.claim('http-integration-worker','2090-01-01T00:00:00+00:00')
            def factory(auth,user):
                api=InternalAPI(auth,user);api.base=self.base;return api
            AutomationRunner(store,factory,BASE).execute(run)
        latest=self.auth.latest_stage_data(self.user,run['project_id'],2)
        self.assertEqual(len(latest['data']['selected_keywords']),5)
        self.assertEqual(latest['status'],'confirmed')
        self.assertEqual(self.req()[1]['runs'][0]['status'],'succeeded')
        self.assertEqual(self.req({'action':'stop','request_id':str(uuid.uuid4())})[0],200)

if __name__=='__main__':unittest.main()
