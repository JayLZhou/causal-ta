from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from causal_ta.engine import load_courses
from causal_ta.tutor import context_for
from tools.evaluate_tutor import evaluate, load_cases, main, make_session, probe_context, review_flags


class FakeProvider:
    model = 'test-double-not-a-real-model'

    def __init__(self, invalid=False):
        self.calls = 0
        self.invalid = invalid

    def reply(self, context, message):
        self.calls += 1
        return {'message': '先比较改变的条件。', 'question': '哪些条件保持不变？',
                'reference_ids': ['invented-reference'] if self.invalid else []}


class EvaluationTests(unittest.TestCase):
    def setUp(self):
        self.cases = load_cases()

    def test_offline_coverage_gates_and_review_are_separate(self):
        report = evaluate(self.cases)
        self.assertEqual(report['summary'], {'cases': 24, 'mechanical_passes': 24,
                         'remote_calls': 0, 'human_reviews_pending': 18, 'flagged_cases': 0})
        self.assertEqual({c['course_id'] for c in self.cases}, set(load_courses()))
        for row in report['cases']:
            self.assertIsNone(row['human_review']['correctness'])
            self.assertEqual(row['context']['conversation'], [])
            self.assertEqual(row['mechanical_pass'], True)
            self.assertEqual(row['scenario'] == 'transfer', row['reply'] is None)

    def test_requested_remote_mode_and_attempt_count(self):
        provider = FakeProvider()
        report = evaluate(self.cases, 'openai', provider)
        self.assertEqual(report['summary']['remote_calls'], 18)
        self.assertEqual(provider.calls, 18)
        self.assertEqual(report['summary']['mechanical_passes'], 24)
        self.assertEqual(report['model'], provider.model)

    def test_fallback_does_not_count_as_model_success(self):
        report = evaluate(self.cases[:1], 'openai', FakeProvider(invalid=True))
        row = report['cases'][0]
        self.assertFalse(row['mechanical_pass'])
        self.assertEqual(row['reply']['mode'], 'offline')
        self.assertFalse(row['checks']['requested_mode_used'])
        self.assertEqual(row['remote_calls'], 1)

    def test_context_probe_catches_a_regression(self):
        session = make_session(self.cases[0], load_courses())
        original = deepcopy(session.world)
        def leak(probe):
            return {**context_for(probe), 'accidental_hidden_state': probe.world}
        with patch('tools.evaluate_tutor.context_for', side_effect=leak):
            self.assertFalse(probe_context(session))
        self.assertEqual(session.world, original)

    def test_state_mutation_is_detected(self):
        def mutate(service, session, message, use_remote=False):
            session.transfer_results.append({'correct': True})
            return {'message': '提示', 'question': '为什么？', 'reference_ids': [], 'mode': 'offline'}
        with patch('tools.evaluate_tutor.TutorService.respond', new=mutate):
            report = evaluate(self.cases[:1])
        self.assertFalse(report['cases'][0]['checks']['scoring_state_unchanged'])

    def test_changed_course_is_rejected_before_any_provider_call(self):
        cases = deepcopy(self.cases)
        cases[-1]['course_version'] = 'stale'
        provider = FakeProvider()
        with self.assertRaisesRegex(ValueError, '课程已变更'):
            evaluate(cases, 'openai', provider)
        self.assertEqual(provider.calls, 0)

    def test_long_answer_matching_is_only_a_review_flag(self):
        session = make_session(self.cases[0], load_courses())
        q = next(q for q in session.course.data['transfer'] if len(q['options'][q['answer']]) >= 8)
        answer = q['options'][q['answer']]
        self.assertGreaterEqual(len(answer), 8)
        flags = review_flags(session, {'message': answer, 'question': '为什么？'})
        self.assertEqual(len(flags), 1)
        self.assertIn('需人工判断', flags[0])

    def test_cli_rejects_unbudgeted_calls_and_existing_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'report.json'
            with patch('tools.evaluate_tutor.configured_tutor') as configure:
                with self.assertRaises(SystemExit) as error:
                    main(['--mode', 'openai', '--output', str(out)])
                self.assertEqual(error.exception.code, 2)
                configure.assert_not_called()
            self.assertEqual(main(['--output', str(out)]), 0)
            self.assertEqual(json.loads(out.read_text(encoding='utf-8'))['summary']['cases'], 24)
            with patch('tools.evaluate_tutor.configured_tutor') as configure:
                with self.assertRaises(SystemExit):
                    main(['--output', str(out)])
                configure.assert_not_called()


if __name__ == '__main__':
    unittest.main()
