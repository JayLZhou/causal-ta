import unittest
from copy import deepcopy
from causal_ta.engine import Course, Session, evaluate, load_courses


class EngineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.courses = load_courses()

    def test_all_worlds_resolve_with_complete_evidence(self):
        """两个课程的每个世界，在完备观测下必须可辨识且不丢掉真值。"""
        for course in self.courses.values():
            for world in course.worlds:
                candidates = course.worlds[:]
                for action in course.actions.values():
                    outcome = course.result(world, action)
                    candidates = [w for w in candidates if course.result(w, action) == outcome]
                    self.assertIn(world, candidates)
                self.assertEqual(candidates, [world])

    def test_interventions_do_not_mutate_original_world(self):
        course = self.courses['container-network']
        world = {'running': 0, 'binding': 1, 'mapping': 0}
        self.assertEqual(course.result(world, course.actions['do-start']), 0)
        self.assertEqual(course.result(world, course.actions['do-map']), 0)
        self.assertEqual(world, {'running': 0, 'binding': 1, 'mapping': 0})
        self.assertEqual(course.result({**world, 'running': 1}, course.actions['do-map']), 1)

    def test_complete_learning_flow_and_no_transfer_retry(self):
        for course in self.courses.values():
            for seed in range(20):
                session = Session(course, seed)
                while len(session.candidates) > 1 or not session.events:
                    choices = session.choices()
                    self.assertTrue(choices)
                    action = choices[0]
                    session.experiment(action['id'], 0)
                    self.assertIn(session.world, session.candidates)
                self.assertTrue(session.diagnose(session.candidates[0]))
                self.assertNotIn('answer', session.view()['transfer'])
                for q in course.data['transfer']:
                    session.answer_transfer(q['answer'])
                self.assertEqual(session.stage, 'complete')
                self.assertTrue(all(r['correct'] for r in session.transfer_results))
                with self.assertRaises(ValueError):
                    session.answer_transfer(0)

    def test_prediction_required_and_actions_not_repeatable(self):
        session = Session(self.courses['linear-functions'], 3)
        for invalid in (None, True, float('nan'), float('inf'), '0'):
            with self.assertRaises(ValueError):
                session.experiment('observe-zero', invalid)
        session.experiment('observe-zero', 0)
        with self.assertRaises(ValueError):
            session.experiment('observe-zero', 0)

    def test_wrong_diagnosis_and_invalid_state(self):
        session = Session(self.courses['linear-functions'], 1)
        with self.assertRaises(ValueError):
            session.diagnose(session.world)
        session.experiment('observe-zero', 0)
        self.assertFalse(session.diagnose({'m': 2 if session.world['m'] != 2 else -2, 'b': 0}))
        self.assertEqual(session.stage, 'investigate')
        with self.assertRaises(ValueError):
            session.diagnose({'m': 300, 'b': 0})

    def test_function_transform_is_not_input_observation(self):
        course = self.courses['linear-functions']
        world = {'m': 2, 'b': -2}
        self.assertEqual(course.result(world, course.actions['observe-two']), 2)
        self.assertEqual(course.result(world, course.actions['replace-slope']), -2)
        self.assertEqual(evaluate(course.data['observation'], {**world, 'x': 1}), 0)

    def test_invalid_course_has_actionable_failure(self):
        original = self.courses['linear-functions'].data
        for field, value in [('start_filter', 0), ('transfer', []), ('semantics', 'causal-because-graph')]:
            data = deepcopy(original)
            data[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                Course(data)

    def test_candidate_limit_checked_before_enumeration(self):
        data = deepcopy(self.courses['linear-functions'].data)
        data['variables'] = {f'v{i}': {'label': str(i), 'domain': [0, 1]} for i in range(100)}
        with self.assertRaises(ValueError):
            Course(data)


if __name__ == '__main__':
    unittest.main()
