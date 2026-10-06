import random
import tempfile
import unittest
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from test_pipeline_contracts import load_render_server

server = load_render_server()
from keyword_pool import load_month_pool, draw_shuffle_bag


class KeywordPoolTests(unittest.TestCase):
    def test_file_and_random_cycle(self):
        pool=load_month_pool('2026-10')
        ids=[item['id'] for item in pool['keywords']]
        self.assertEqual(len(ids),100)
        queue=None
        last=[]
        seen=[]
        for _ in range(34):
            batch,queue,cycled=draw_shuffle_bag(ids,queue,last,3,random.Random(len(seen)))
            self.assertEqual(len(set(batch)),3)
            self.assertFalse(set(batch)&set(last))
            seen.extend(batch)
            last=batch
        self.assertEqual(len(set(seen[:100])),100)
        self.assertNotEqual(seen[:99],ids[:99])
        self.assertTrue(cycled)

    def test_validation_and_missing_month(self):
        for month in ['../../x','2026-13','2026-1',None]:
            with self.assertRaises(ValueError):load_month_pool(month)
        self.assertIsNone(load_month_pool('2026-11'))
        with self.assertRaises(ValueError):draw_shuffle_bag(['one'],count=3)

    def test_restart_isolation_and_concurrent_draws(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'pool.sqlite'
            store=server.AuthStore(path)
            user=store.create_user('pool-owner','password123')['user_id']
            stranger=store.create_user('pool-stranger','password123')['user_id']
            project=store.ensure_project(user,'pool-test-project','월별 추첨 테스트')['project_id']
            pool=load_month_pool('2026-10')
            first=store.draw_monthly_keywords(user,pool,3,project,'2026-09-30')
            store=server.AuthStore(path)
            second=store.draw_monthly_keywords(user,pool,3,project,'2026-09-30')
            self.assertEqual(second['remaining'],94)
            self.assertFalse({k['id'] for k in first['keywords']}&{k['id'] for k in second['keywords']})
            with self.assertRaises(ValueError):store.draw_monthly_keywords(stranger,pool,3,project,'2026-09-30')
            with ThreadPoolExecutor(max_workers=4) as executor:
                results=list(executor.map(lambda _:store.draw_monthly_keywords(user,pool,3,project,'2026-09-30'),range(8)))
            self.assertEqual(len({k['id'] for result in results for k in result['keywords']}),24)
            self.assertEqual(len(store.seasonal_keywords(project,'2026-09-30')),30)
            self.assertEqual(store.usage_summary(user)['requests'],0)
            preview=store.draw_monthly_keywords(user,pool,3)
            self.assertEqual(preview['remaining'],97)
