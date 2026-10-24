from copy import deepcopy
import unittest

from causal_ta.domain import binary_search, evaluate, loop_sum
from causal_ta.engine import Session, load_courses
from causal_ta.validate import check_data


class DomainTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.courses = load_courses()

    def test_loop_against_arithmetic_series(self):
        for start in (0, 1):
            for inclusive in (0, 1):
                for stop in range(9):
                    end = stop - 1 + inclusive
                    count = max(0, end - start + 1)
                    self.assertEqual(loop_sum(start, inclusive, stop), count * (start + end) // 2)
                    self.assertEqual(evaluate(['loop_count', start, inclusive, stop], {}), count)
        self.assertEqual(loop_sum(0, 0, 3), loop_sum(1, 0, 3))
        self.assertNotEqual(evaluate(['loop_count', 0, 0, 3], {}), evaluate(['loop_count', 1, 0, 3], {}))

    def test_correct_binary_search_matches_linear_oracle(self):
        for size in range(33):
            values = [i * 2 - 10 for i in range(size)]
            for target in range(-12, 58):
                expected = values.index(target) if target in values else -1
                self.assertEqual(binary_search(1, 1, values, target), expected)

    def test_binary_minimal_counterexamples_and_progress(self):
        self.assertEqual(binary_search(0, 1, [7], 7), -1)
        self.assertEqual(binary_search(1, 1, [7], 7), 0)
        self.assertEqual(binary_search(1, 0, [1, 3, 5], 6), -2)
        self.assertEqual(binary_search(1, 1, [1, 3, 5], 6), -1)
        for values in ([2,1], [1,1], [float('nan')]):
            with self.assertRaises(ValueError):
                binary_search(1, 1, values, 1)
        for args in [(0,1,-1), (False,1,3), (0,1,1001), (0,1,1.5)]:
            with self.assertRaises(ValueError):
                loop_sum(*args)

    def test_calculus_actions_against_polynomial_identities(self):
        course = self.courses['derivative-change']
        for world in course.worlds:
            a,b,c = (world[k] for k in ('a','b','c'))
            expected = {'value-zero':c, 'derivative-zero':b, 'secant-one':3*a+b,
                        'secant-half':2.5*a+b, 'shift-constant':2*a+b}
            for key,value in expected.items():
                self.assertEqual(course.result(world,course.actions[key]),value)
            derivative = 2*a+b
            full_error = course.result(world,course.actions['secant-one'])-derivative
            half_error = course.result(world,course.actions['secant-half'])-derivative
            self.assertEqual(full_error,2*half_error)

    def test_probability_actions_against_enumerated_samples(self):
        course = self.courses['conditional-probability']
        for world in course.worlds:
            samples = [(1,1)]*world['both']+[(1,0)]*world['a_only']+[(0,1)]*world['b_only']+[(0,0)]*2
            subset_a = [s for s in samples if s[0]]
            subset_b = [s for s in samples if s[1]]
            expected = {'count-population':len(samples), 'condition-b':sum(s[0] for s in subset_b)/len(subset_b),
                        'condition-a':sum(s[1] for s in subset_a)/len(subset_a), 'count-a':len(subset_a)}
            for key,value in expected.items():
                self.assertEqual(course.result(world,course.actions[key]),value)
            self.assertEqual(course.result(world,course.actions['change-intersection']),2/(2+world['b_only']))

    def test_rounding_tolerance_does_not_change_candidate_elimination(self):
        course = self.courses['conditional-probability']
        for prediction, correct in ((.6667,True),(.667,False)):
            session = next(s for seed in range(100) if (s:=Session(course,seed)).world['both']==2 and s.world['b_only']==1)
            session.experiment('condition-b',prediction)
            self.assertEqual(session.events[-1]['prediction_correct'],correct)
            self.assertIn(session.world,session.candidates)
            self.assertTrue(all(course.result(w,course.actions['condition-b'])==2/3 for w in session.candidates))

    def test_invalid_course_inputs_fail_before_execution(self):
        source=self.courses['linear-functions'].data
        bad=[('id','../escape'),('observation',['exec','print(1)']),('observation',['div',1,0]),
             ('observation',['div',1]),('observation','missing'),('observation',10**400),
             ('observation',float('inf')),('prediction_tolerance',1)]
        nested=1
        for _ in range(30): nested=['add',nested]
        bad.append(('observation',nested))
        for field,value in bad:
            with self.subTest(field=field):
                data=deepcopy(source);data[field]=value
                self.assertFalse(check_data(data)['ok'])


if __name__=='__main__':
    unittest.main()
