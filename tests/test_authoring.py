from copy import deepcopy
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from causal_ta.library import CourseLibrary
from causal_ta.server import make_server
from causal_ta.validate import check_data


class LibraryTests(unittest.TestCase):
    def test_save_is_new_atomic_and_persistent(self):
        with tempfile.TemporaryDirectory() as folder:
            library=CourseLibrary(Path(folder)/'courses')
            draft=library.template('linear-functions');draft['id']='custom-linear'
            version=check_data(draft)['version']
            library.save_new(draft,version)
            with self.assertRaises(FileExistsError):library.save_new(draft,version)
            restored=CourseLibrary(Path(folder)/'courses')
            self.assertEqual(restored['custom-linear'].version,version)
            self.assertEqual(list((Path(folder)/'courses').glob('*.tmp')),[])
            self.assertEqual(len(list((Path(folder)/'courses').glob('*.json'))),1)
            draft['title']='改标题'
            with self.assertRaises(ValueError):library.save_new(draft,version)

    def test_competing_library_instances_cannot_overwrite(self):
        with tempfile.TemporaryDirectory() as folder:
            first,second=CourseLibrary(folder),CourseLibrary(folder)
            draft=first.template('python-loop-boundaries');draft['id']='custom-loop'
            version=check_data(draft)['version'];first.save_new(draft,version)
            changed=deepcopy(draft);changed['title']='第二份'
            with self.assertRaises(FileExistsError):second.save_new(changed,check_data(changed)['version'])
            self.assertEqual(CourseLibrary(folder)['custom-loop'].data['title'],draft['title'])


class AuthoringTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.start(True)

    def start(self,enabled):
        self.server=make_server(0,Path(self.tmp.name)/'sessions.sqlite3',authoring=enabled)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.base=f'http://127.0.0.1:{self.server.server_port}'

    def stop(self):
        self.server.shutdown();self.thread.join();self.server.server_close();self.server.store.db.close()

    def tearDown(self):
        self.stop();self.tmp.cleanup()

    def request(self,path,data=None,headers=None):
        request=Request(self.base+path,data=None if data is None else json.dumps(data).encode(),headers=headers or {})
        with urlopen(request,timeout=5) as r:return json.load(r)

    def test_authoring_flow_start_then_restart_retains_course_and_snapshot(self):
        self.assertTrue(self.request('/api/config')['authoring'])
        course=self.request('/api/authoring/templates/linear-functions');course['id']='teacher-linear'
        course['title']='教师示范'
        checked=self.request('/api/authoring/validate',{'course':course})
        result=self.request('/api/authoring/save',{'course':course,'version':checked['version']})
        self.assertEqual(result['course']['title'],'教师示范')
        state=self.request('/api/start',{'course':'teacher-linear'})
        self.stop();self.start(False)
        self.assertIn('teacher-linear',[c['id'] for c in self.request('/api/courses')])
        self.assertEqual(self.request('/api/sessions/'+state['id'])['course']['version'],checked['version'])
        with self.assertRaises(HTTPError) as e:self.request('/api/authoring/templates/teacher-linear')
        self.assertEqual(e.exception.code,403)

    def test_invalid_stale_duplicate_and_cross_site_requests(self):
        course=self.request('/api/authoring/templates/linear-functions')
        checked=self.request('/api/authoring/validate',{'course':course})
        with self.assertRaises(HTTPError) as e:self.request('/api/authoring/save',{'course':course,'version':checked['version']})
        self.assertEqual(e.exception.code,409)
        course['id']='teacher-new'
        with self.assertRaises(HTTPError) as e:self.request('/api/authoring/save',{'course':course,'version':checked['version']})
        self.assertEqual(e.exception.code,400)
        with self.assertRaises(HTTPError) as e:self.request('/api/authoring/validate',{'course':course},{'Origin':'https://evil.example'})
        self.assertEqual(e.exception.code,403)
        course['id']='../escape'
        with self.assertRaises(HTTPError) as e:self.request('/api/authoring/validate',{'course':course})
        self.assertEqual(e.exception.code,400)
        self.assertFalse((Path(self.tmp.name)/'courses').exists())

    def test_default_mode_rejects_authoring_and_serves_instruction_page(self):
        self.stop();self.start(False)
        for endpoint in ('validate','save'):
            with self.assertRaises(HTTPError) as e:self.request('/api/authoring/'+endpoint,{'course':{}})
            self.assertEqual(e.exception.code,403)
        with urlopen(self.base+'/teach',timeout=3) as r:self.assertIn('教师工作台',r.read().decode())


if __name__=='__main__':unittest.main()
