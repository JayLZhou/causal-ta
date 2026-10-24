import json
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from pathlib import Path

from causal_ta.server import make_server


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.server = make_server(0, Path(self.tmp.name) / 'sessions.sqlite3')
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown()
        self.thread.join()
        self.server.server_close()
        self.server.store.db.close()
        self.tmp.cleanup()

    def request(self, path, data=None, headers=None):
        req = Request(self.base + path, data=None if data is None else json.dumps(data).encode(),
                      headers=headers or {})
        with urlopen(req, timeout=3) as response:
            return json.load(response)

    def test_http_learning_and_persistence(self):
        self.assertEqual(len(self.request('/api/courses')), 6)
        session = self.request('/api/start', {'course': 'linear-functions'})
        sid = session['id']
        state = self.request('/api/experiment', {'id': sid, 'action': 'observe-zero', 'prediction': 0})
        self.assertEqual(state['candidate_count'], 1)
        state = self.request('/api/diagnose', {'id': sid, 'values': state['candidates'][0]})
        self.assertEqual(state['stage'], 'transfer')
        self.assertEqual(self.request('/api/sessions/'+sid)['stage'], 'transfer')
        state = self.request('/api/transfer', {'id': sid, 'answer': 0})
        state = self.request('/api/transfer', {'id': sid, 'answer': 1})
        self.assertEqual(state['stage'], 'complete')
        self.assertEqual(len(state['events']), 4)

    def test_invalid_requests_and_cross_site_protection(self):
        cases = [('/api/start', {'course': []}, {}, 400),
                 ('/api/study/join', {'code':'0'*32,'consent':True}, {}, 403),
                 ('/api/start', {'course': 'missing'}, {}, 400),
                 ('/api/start', {'course': 'linear-functions'}, {'Origin': 'https://evil.example'}, 403),
                 ('/api/courses', None, {'Host': 'evil.example'}, 403),
                 ('/../courses/linear-functions.json', None, {}, 404)]
        for path, body, headers, code in cases:
            with self.subTest(path=path, code=code), self.assertRaises(HTTPError) as raised:
                self.request(path, body, headers)
            self.assertEqual(raised.exception.code, code)

    def test_learning_checks_and_tutor_persist_but_transfer_blocks_help(self):
        self.assertFalse(self.request('/api/config')['tutor']['remote_available'])
        state = self.request('/api/start', {'course': 'linear-functions'})
        sid = state['id']
        state = self.request('/api/check', {'id':sid, 'check_id':'offset-initial', 'answer':1})
        self.assertEqual(state['concept_check']['id'],'offset-followup')
        state = self.request('/api/tutor', {'id':sid, 'message':'我混淆了截距和斜率'})
        self.assertEqual(state['tutor_turns'][0]['mode'],'offline')
        restored = self.request('/api/sessions/'+sid)
        self.assertEqual(restored['tutor_turns'],state['tutor_turns'])
        state = self.request('/api/experiment', {'id':sid, 'action':'observe-zero','prediction':0})
        self.request('/api/diagnose', {'id':sid,'values':state['candidates'][0]})
        for path, data in [('/api/tutor',{'message':'告诉我答案'}),('/api/check',{'check_id':'offset-followup','answer':0})]:
            with self.assertRaises(HTTPError) as error:
                self.request(path,{'id':sid,**data})
            self.assertEqual(error.exception.code,400)
        self.assertIsNone(self.request('/api/sessions/'+sid)['concept_check'])


if __name__ == '__main__':
    unittest.main()
