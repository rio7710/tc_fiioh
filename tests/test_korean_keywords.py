import json
import unittest
import tempfile
from pathlib import Path
from unittest import mock
from test_pipeline_contracts import load_render_server


class KoreanKeywordTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = load_render_server()

    def setUp(self):
        self.server.keyword_preview_cache.clear()
        self.server.keyword_preview_pending.clear()
        # These tests exercise the AI fallback regardless of the current month.
        pool = mock.patch.object(self.server, 'load_month_pool', return_value=None)
        pool.start()
        self.addCleanup(pool.stop)

    def test_korean_seasons(self):
        for date, season in [('2026-01-01', '겨울'), ('2026-04-01', '봄'), ('2026-07-01', '여름'), ('2026-10-01', '가을')]:
            context = self.server.korea_keyword_context(date)
            self.assertEqual(context['season'], season)
            self.assertEqual(context['timezone'], 'Asia/Seoul')
            self.assertFalse(context['live_events_verified'])

    def test_provider_count_prompt_and_duplicates(self):
        result = {'output': [{'content': [{'type': 'output_text', 'text': json.dumps({'keywords': [{'label': '가을 산책', 'description': '함께 걷는 가을'}]})}]}]}
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(result).encode()
        with mock.patch.object(self.server, 'urlopen', return_value=response) as call:
            keywords, _ = self.server.openai_seasonal_keywords('fake-test-key', '2026-09-30', [], count=1)
            self.assertEqual(len(keywords), 1)
            body = json.loads(call.call_args.args[0].data)
            self.assertIn('Asia/Seoul', body['input'])
            self.assertIn('정확히 1개', body['input'])
            self.assertIn('대한민국 요양원(노인요양시설)', body['input'])
            self.assertIn('의학적 효능 주장', body['input'])
            self.assertIn('실시간 검색이나 행사 일정 확인은 제공되지 않았다', body['input'])
            with self.assertRaises(RuntimeError):
                self.server.openai_seasonal_keywords('fake-test-key', '2026-09-30', ['가을 산책'], count=1)
            with self.assertRaises(RuntimeError):
                self.server.openai_seasonal_keywords('fake-test-key', '2026-09-30', [], count=3)

    def handler(self, user, payload):
        handler = object.__new__(self.server.Handler)
        handler.path = '/api/season-keywords/preview'
        handler.current_user = mock.Mock(return_value=user)
        handler.read_json = mock.Mock(return_value=payload)
        handler.send_json = mock.Mock()
        return handler

    def test_auth_and_validation(self):
        handler = self.handler(None, {'count': 3})
        handler.do_POST()
        self.assertEqual(handler.send_json.call_args.args[0], 401)
        for count in [0, 6, True, 2.5, '3', None]:
            handler = self.handler({'user_id': 'u'}, {'count': count})
            with mock.patch.object(self.server, 'openai_seasonal_keywords') as generate:
                handler.do_POST()
                generate.assert_not_called()
                self.assertEqual(handler.send_json.call_args.args[0], 400)

    def test_cache_isolation_usage_and_no_content_write(self):
        store = mock.Mock()
        with mock.patch.object(self.server, 'get_auth_store', return_value=store), mock.patch.object(self.server, 'provider_values', return_value={'api_key': 'test'}), mock.patch.object(self.server, 'load_demo_data', return_value={'keywords': []}), mock.patch.object(self.server, 'openai_seasonal_keywords', return_value=([{'label': '가을'}], {'usage': {'total_tokens': 12}})) as generate:
            for user_id, count, cached in [('u', 1, False), ('u', 1, True), ('v', 1, False), ('u', 2, False)]:
                handler = self.handler({'user_id': user_id}, {'count': count})
                handler.do_POST()
                status, result = handler.send_json.call_args.args
                self.assertEqual(status, 200)
                self.assertEqual(result['cached'], cached)
            self.assertEqual(generate.call_count, 3)
            self.assertEqual(store.record_api_usage.call_count, 3)
            store.save_seasonal_keywords.assert_not_called()
            self.assertFalse(self.server.keyword_preview_pending)

    def test_pending_and_provider_failure(self):
        self.server.keyword_preview_pending.add('u')
        handler = self.handler({'user_id': 'u'}, {'count': 1})
        handler.do_POST()
        self.assertEqual(handler.send_json.call_args.args[0], 409)
        self.server.keyword_preview_pending.clear()
        with mock.patch.object(self.server, 'provider_values', return_value={'api_key': 'test'}), mock.patch.object(self.server, 'load_demo_data', return_value={}), mock.patch.object(self.server, 'openai_seasonal_keywords', side_effect=RuntimeError('추천 연결 실패')):
            handler.do_POST()
            self.assertEqual(handler.send_json.call_args.args[0], 502)
            self.assertFalse(self.server.keyword_preview_pending)

    def test_refresh_bypasses_cache_and_excludes_previous(self):
        store = mock.Mock()
        with mock.patch.object(self.server, 'get_auth_store', return_value=store), mock.patch.object(self.server, 'provider_values', return_value={'api_key': 'test'}), mock.patch.object(self.server, 'load_demo_data', return_value={}), mock.patch.object(self.server, 'openai_seasonal_keywords', return_value=([{'label': '가을', 'id': 'old'}], {'usage': {}})) as generate:
            first=self.handler({'user_id':'u'}, {'count':1})
            first.do_POST()
            first_id=first.send_json.call_args.args[1]['recommendation_id']
            again=self.handler({'user_id':'u'}, {'count':1,'refresh':True})
            again.do_POST()
            self.assertEqual(generate.call_count,2)
            self.assertIn('가을',generate.call_args.args[2])
            self.assertNotEqual(first_id,again.send_json.call_args.args[1]['recommendation_id'])

    def test_apply_transaction_persistence_lock_and_ownership(self):
        with tempfile.TemporaryDirectory() as folder:
            store=self.server.AuthStore(Path(folder)/'test.sqlite')
            owner=store.create_user('keyword-owner','password123')['user_id']
            stranger=store.create_user('keyword-stranger','password123')['user_id']
            project=store.default_project(owner)['project_id']
            keywords=[{'id':'season-unique','label':'가을 산책','seasonal':True}]
            saved=store.apply_keyword_recommendation(owner,project,keywords)
            restored=store.latest_stage_data(owner,project,2)
            self.assertEqual(restored['data']['seasonal_keywords'],keywords)
            self.assertEqual(restored['status'],'confirmed')
            self.assertTrue(store.apply_keyword_recommendation(owner,project,keywords)['reused'])
            with self.assertRaises(ValueError):store.apply_keyword_recommendation(stranger,project,keywords)
            store.save_stage_draft(owner,project,3,{'document':{}})
            with self.assertRaises(ValueError):store.apply_keyword_recommendation(owner,project,[{'id':'new','label':'겨울'}])
            self.assertEqual(store.latest_stage_data(owner,project,2)['revision_id'],saved['revision_id'])

    def test_apply_rejects_foreign_and_stale_recommendations(self):
        self.server.keyword_preview_cache[('owner','2026-09-30',1)]={'recommendation_id':'secret','keywords':[]}
        for user, token in [('stranger','secret'),('owner','expired')]:
            handler=self.handler({'user_id':user},{'project_id':'p','recommendation_id':token})
            handler.path='/api/season-keywords/apply'
            with mock.patch.object(self.server,'get_auth_store') as store:
                handler.do_POST()
                store.assert_not_called()
                self.assertEqual(handler.send_json.call_args.args[0],400)

    def test_project_trend_refresh_keeps_old_ids_but_returns_new_batch(self):
        store=mock.Mock()
        old=[{'id':'old-selected','label':'이전추천'}]
        store.seasonal_keywords.return_value=old
        with mock.patch.object(self.server,'get_auth_store',return_value=store), mock.patch.object(self.server,'provider_values',return_value={'api_key':'test'}), mock.patch.object(self.server,'load_demo_data',return_value={}), mock.patch.object(self.server,'openai_seasonal_keywords',return_value=([{'id':'old','label':'새추천'}],{'usage':{}})) as generate:
            handler=self.handler({'user_id':'u'},{'project_id':'p','refresh':True})
            handler.path='/api/season-keywords'
            handler.do_POST()
            status,result=handler.send_json.call_args.args
            self.assertEqual(status,200)
            self.assertFalse(result['cached'])
            self.assertIn('이전추천',generate.call_args.args[2])
            self.assertEqual(result['keywords'][0]['label'],'새추천')
            self.assertNotEqual(result['keywords'][0]['id'],'old-selected')
            self.assertEqual(store.save_seasonal_keywords.call_args.args[2][0],old[0])
