from copy import deepcopy
import json
import unittest

from causal_ta.engine import Course, Session, load_courses
from causal_ta.server import Store


class LearningTests(unittest.TestCase):
    def setUp(self):
        self.courses = load_courses()
        self.session = Session(self.courses['linear-functions'], 5)

    def test_wrong_answer_routes_to_targeted_followup(self):
        session = self.session
        session.check_understanding('offset-initial', 1)
        view = session.view()
        self.assertEqual(view['concept_check']['id'], 'offset-followup')
        hypothesis = view['learner']['hypotheses'][0]
        self.assertEqual(hypothesis['evidence_ids'], ['offset-initial'])
        self.assertFalse(hypothesis['followup_passed'])
        self.assertIn('不是确诊', hypothesis['status'])
        session.check_understanding('offset-followup', 0)
        view = session.view()
        self.assertTrue(view['learner']['hypotheses'][0]['followup_passed'])
        self.assertEqual(view['learner']['objectives'][0]['correct'], 1)
        self.assertEqual(view['learner']['objectives'][0]['attempted'], 2)
        self.assertEqual(session.transfer_results, [])

    def test_repeated_check_and_out_of_order_check_cannot_fabricate_evidence(self):
        self.session.check_understanding('offset-initial', 0)
        for check_id in ['offset-initial', 'offset-followup', 'does-not-exist']:
            with self.assertRaises(ValueError):
                self.session.check_understanding(check_id, 0)
        self.assertEqual(len(self.session.events), 1)

    def test_check_does_not_replace_required_experiment(self):
        self.session.check_understanding('offset-initial', 0)
        with self.assertRaises(ValueError):
            self.session.diagnose(self.session.world)

    def test_transfer_is_separate_and_cannot_get_check_feedback(self):
        self.session.experiment('observe-zero', 0)
        self.session.diagnose(self.session.world)
        self.assertIsNone(self.session.view()['concept_check'])
        with self.assertRaises(ValueError):
            self.session.check_understanding('offset-initial', 0)
        self.assertEqual(self.session.view()['learner']['hypotheses'], [])

    def test_wrong_answer_without_mapping_keeps_uncertainty(self):
        session = Session(self.courses['container-network'], 1)
        session.check_understanding('expose-initial', 0)
        session.check_understanding('expose-followup', 2)  # 与目标误概念不特异关联。
        self.assertIsNone(session.events[-1]['hypothesis'])
        self.assertEqual(len(session.view()['learner']['hypotheses']), 1)

    def test_schema_rejects_unknown_reference_or_answer_mapping(self):
        for field, value in [('references', ['invented']), ('wrong_map', {'0': 'offset-scaled'})]:
            data = deepcopy(self.session.course.data)
            data['pedagogy']['checks'][0][field] = value
            with self.assertRaisesRegex(ValueError, 'pedagogy.checks'):
                Course(data)

    def test_course_snapshot_survives_edits_and_removal(self):
        store = Store(':memory:')
        self.addCleanup(store.db.close)
        old_version = self.session.course.version
        self.session.check_understanding('offset-initial', 1)
        store.save('example', self.session)
        changed = deepcopy(self.session.course.data)
        changed['title'] = '已修改标题'
        changed['pedagogy']['checks'][0]['feedback'] = '已修改反馈'
        restored = store.get('example', {'linear-functions': Course(changed)})
        self.assertEqual(restored.course.version, old_version)
        self.assertNotEqual(restored.course.data['title'], changed['title'])
        self.assertEqual(restored.view()['concept_check']['id'], 'offset-followup')
        self.assertEqual(store.get('example', {}).course.version, old_version)

    def test_legacy_session_does_not_claim_original_course_verified(self):
        store = Store(':memory:')
        self.addCleanup(store.db.close)
        state = {k:v for k,v in vars(self.session).items() if k not in ('course','course_provenance','tutor_turns','used')}
        state.update(course_id='linear-functions', used=[])
        store.db.execute('INSERT INTO sessions VALUES (?,?)', ('old',json.dumps(state)))
        restored = store.get('old',self.courses)
        self.assertEqual(restored.course_provenance, 'legacy_current_course_unverified')
        self.assertEqual(restored.tutor_turns, [])


if __name__ == '__main__':
    unittest.main()
