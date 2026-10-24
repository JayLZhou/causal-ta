from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from causal_ta.engine import Session, load_courses
from causal_ta.learning import next_check
from causal_ta.server import Store, make_server
from causal_ta.study import StudyRegistry, digest
from causal_ta.tutor import TutorService, offline_reply


class PolicyTests(unittest.TestCase):
    def test_policy_changes_only_followup_choice_and_logs_prior_evidence(self):
        course=load_courses()['linear-functions']
        diagnostic,fixed=Session(course,3),Session(course,3,policy='fixed')
        self.assertEqual(diagnostic.world,fixed.world)
        for s in (diagnostic,fixed):
            s.check_understanding('offset-initial',1)
            event=s.events[-1]
            self.assertEqual(event['selection']['prior_checks'],[])
            self.assertEqual(event['selection']['pending_hypotheses'],[])
            self.assertFalse(event['selection']['randomized'])
            self.assertEqual(event['selection']['probability'],1)
        self.assertEqual(diagnostic.view()['concept_check']['id'],'offset-followup')
        self.assertEqual(fixed.view()['concept_check']['id'],'point-initial')
        self.assertNotEqual(offline_reply(diagnostic)['question'],offline_reply(fixed)['question'])
        with self.assertRaises(ValueError):fixed.check_understanding('offset-followup',0)
        next_id=fixed.view()['concept_check']['id'];fixed.check_understanding(next_id,1)
        self.assertEqual(fixed.events[-1]['selection']['prior_checks'],['offset-initial'])
        self.assertIn('offset-scaled',fixed.events[-1]['selection']['pending_hypotheses'])
        self.assertNotIn('answer',next_check(course,[],policy='fixed'))


class StudyTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=Path(self.tmp.name)/'sessions.sqlite3'
        self.store=Store(self.path);self.registry=StudyRegistry(self.store)
        self.course=load_courses()['linear-functions']
        self.registry.create('pilot-demo',self.course,'软件演练','验证软件流程','开发者',True)

    def tearDown(self):
        self.store.db.close();self.tmp.cleanup()

    def complete(self,sid,session,score):
        session.experiment('observe-zero',0);session.diagnose(session.world)
        for i,q in enumerate(session.course.data['transfer']):
            session.answer_transfer(q['answer'] if i<score else (q['answer']+1)%len(q['options']))
        self.store.save(sid,session)

    def test_explicit_consent_and_single_randomization_under_concurrency(self):
        code=self.registry.invite('pilot-demo',1)[0]
        for value in (False,None,'true',1):
            with self.assertRaises(ValueError):self.registry.join(code,value)
        self.assertEqual(self.registry.report('pilot-demo')['unused_invites'],1)
        with patch('causal_ta.study.secrets.randbelow',return_value=0) as draw:
            with ThreadPoolExecutor(max_workers=4) as pool:
                joined=list(pool.map(lambda _:self.registry.join(code,True),range(4)))
            self.assertEqual(draw.call_count,1)
        self.assertEqual(len({sid for sid,_ in joined}),1)
        self.assertEqual(joined[0][1].study_assignment['probability'],.5)
        self.assertEqual(joined[0][1].teaching_policy,'diagnostic')
        raw=self.store.db.execute('SELECT token_hash FROM enrollments').fetchone()[0]
        self.assertNotEqual(raw,code);self.assertEqual(raw,digest(code))
        self.assertNotIn('course_snapshot',self.registry.info(code))

    def test_frozen_protocol_persistent_assignment_and_close(self):
        codes=self.registry.invite('pilot-demo',2)
        sid,session=self.registry.join(codes[0],True)
        self.course.data['title']='later edit'
        self.assertNotEqual(session.course.data['title'],self.course.data['title'])
        self.registry.close('pilot-demo')
        with self.assertRaises(ValueError):self.registry.join(codes[1],True)
        with self.assertRaises(ValueError):self.registry.invite('pilot-demo',1)
        self.store.db.close();self.store=Store(self.path);self.registry=StudyRegistry(self.store)
        restored_id,restored=self.registry.join(codes[0],True)
        self.assertEqual(restored_id,sid);self.assertEqual(restored.teaching_policy,session.teaching_policy)
        self.assertEqual(restored.course.version,session.course.version)
        with self.assertRaises(ValueError):self.registry.create('pilot-demo',self.course,'x','x','x')

    def test_separate_database_connections_assign_once(self):
        code=self.registry.invite('pilot-demo',1)[0]
        other=Store(self.path)
        try:
            second=StudyRegistry(other)
            with patch('causal_ta.study.secrets.randbelow',return_value=1) as draw:
                with ThreadPoolExecutor(max_workers=2) as pool:
                    futures=[pool.submit(registry.join,code,True) for registry in (self.registry,second)]
                    results=[f.result(timeout=5) for f in futures]
                self.assertEqual(draw.call_count,1)
                self.assertEqual(results[0][0],results[1][0])
        finally:other.db.close()

    def test_complete_missing_and_withdrawn_denominators_and_bounds(self):
        codes=self.registry.invite('pilot-demo',7)
        with patch('causal_ta.study.secrets.randbelow',side_effect=[0,0,0,1,1,1]):
            rows=[self.registry.join(code,True) for code in codes[:6]]
        for index,score in [(0,2),(1,1),(3,0),(4,1)]:self.complete(*rows[index],score)
        sid,partial=rows[2];partial.tutor_turns=[{'student':'PRIVATE-SENTINEL'}];self.store.save(sid,partial)
        self.registry.forget(rows[5][0])
        report=self.registry.report('pilot-demo')
        self.assertEqual(report['unused_invites'],1)
        self.assertEqual(report['groups']['diagnostic']['assigned'],3)
        self.assertEqual(report['groups']['fixed']['withdrawn'],1)
        self.assertEqual(report['groups']['diagnostic']['incomplete'],1)
        self.assertAlmostEqual(report['observed_completer_difference'],.5)
        self.assertIsNone(report['all_assigned_mean_difference'])
        self.assertAlmostEqual(report['missing_outcome_difference_bounds'][0],0)
        self.assertAlmostEqual(report['missing_outcome_difference_bounds'][1],2/3)
        exported=json.dumps(report)
        for token in [*codes,'PRIVATE-SENTINEL',rows[0][0]]:self.assertNotIn(token,exported)
        with self.assertRaises(ValueError):self.registry.join(codes[5],True)
        with self.assertRaises(KeyError):self.store.get(rows[5][0],{})

    def test_full_outcomes_and_empty_arms(self):
        empty=self.registry.report('pilot-demo')
        self.assertIsNone(empty['missing_outcome_difference_bounds'])
        codes=self.registry.invite('pilot-demo',2)
        with patch('causal_ta.study.secrets.randbelow',side_effect=[0,1]):
            rows=[self.registry.join(c,True) for c in codes]
        self.complete(*rows[0],2);self.complete(*rows[1],0)
        report=self.registry.report('pilot-demo')
        self.assertEqual(report['all_assigned_mean_difference'],1)
        self.assertEqual(report['missing_outcome_difference_bounds'],[1,1])

    def test_study_rejects_remote_calls_and_changed_policy_version(self):
        code=self.registry.invite('pilot-demo',1)[0];sid,s=self.registry.join(code,True)
        with self.assertRaisesRegex(ValueError,'离线'):TutorService().respond(s,'解释一下',True)
        self.assertEqual(s.tutor_turns,[])
        other=self.registry.invite('pilot-demo',1)[0]
        with patch('causal_ta.study.POLICY_VERSION','future'):
            with self.assertRaises(ValueError):self.registry.join(other,True)
            with self.assertRaises(ValueError):self.registry.join(code,True)
        with patch('causal_ta.server.POLICY_VERSION','future'):
            with self.assertRaises(ValueError):self.store.get(sid,{})
        self.assertEqual(self.registry.report('pilot-demo')['unused_invites'],1)

    def test_report_rejects_inconsistent_assignment(self):
        code=self.registry.invite('pilot-demo',1)[0];sid,s=self.registry.join(code,True)
        s.teaching_policy='fixed' if s.teaching_policy=='diagnostic' else 'diagnostic'
        self.store.save(sid,s)
        with self.assertRaisesRegex(ValueError,'完整性'):self.registry.report('pilot-demo')

    def test_report_rejects_changed_snapshot_and_incorrect_grading(self):
        code=self.registry.invite('pilot-demo',1)[0];sid,s=self.registry.join(code,True)
        self.complete(sid,s,2)
        s.transfer_results[0]['correct']=False;self.store.save(sid,s)
        with self.assertRaisesRegex(ValueError,'评分'):self.registry.report('pilot-demo')
        s.transfer_results[0]['correct']=True
        s.course.data['title']='changed after randomization';self.store.save(sid,s)
        with self.assertRaisesRegex(ValueError,'完整性'):self.registry.report('pilot-demo')

    def test_closed_study_and_invalid_codes_do_not_allocate(self):
        for value in (None,[],{},'not-a-code','0'*32):
            with self.assertRaises(ValueError):self.registry.join(value,True)
        self.assertEqual(self.registry.report('pilot-demo')['unused_invites'],0)


class StudyHTTPTests(unittest.TestCase):
    def setUp(self):
        self.server=make_server(0,studies=True)
        self.server.studies.create('http-demo',load_courses()['linear-functions'],'测试','软件测试','开发者',True)
        self.code=self.server.studies.invite('http-demo',1)[0]
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.base=f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown();self.thread.join();self.server.server_close();self.server.store.db.close()

    def request(self,path,data=None):
        req=Request(self.base+path,data=None if data is None else json.dumps(data).encode())
        with urlopen(req,timeout=3) as response:return json.load(response)

    def test_join_resume_withdraw_and_nonstudy_forget(self):
        info=self.request('/api/study/info',{'code':self.code})
        self.assertEqual(info['data_kind'],'synthetic');self.assertNotIn('course_snapshot',info)
        with self.assertRaises(HTTPError):self.request('/api/study/join',{'code':self.code})
        first=self.request('/api/study/join',{'code':self.code,'consent':True,'arm':'injected'})
        again=self.request('/api/study/join',{'code':self.code,'consent':True})
        self.assertEqual(first['id'],again['id'])
        with self.assertRaises(HTTPError):self.request('/api/tutor',{'id':first['id'],'message':'test','use_remote':True})
        self.assertTrue(self.request('/api/forget',{'id':first['id']})['withdrawn'])
        for path,body in [('/api/study/join',{'code':self.code,'consent':True}),('/api/sessions/'+first['id'],None)]:
            with self.assertRaises(HTTPError):self.request(path,body)
        ordinary=self.request('/api/start',{'course':'linear-functions'})
        self.assertIsNone(ordinary['study_assignment'])
        self.assertFalse(self.request('/api/forget',{'id':ordinary['id']})['withdrawn'])
        self.assertEqual(self.server.studies.report('http-demo')['groups'][first['study_assignment']['arm']]['withdrawn'],1)


if __name__=='__main__':unittest.main()
