from contextlib import redirect_stdout
from copy import deepcopy
from io import StringIO
import json
from pathlib import Path
import tempfile
import unittest

from causal_ta.engine import load_courses
from causal_ta.paths import COURSES_DIR
from causal_ta.validate import check_course, main


class ValidationTests(unittest.TestCase):
    def test_bundled_courses_have_unique_observational_signatures(self):
        paths = list(COURSES_DIR.glob('*.json'))
        self.assertEqual(len(paths), 6)
        for path in paths:
            self.assertTrue(check_course(path)['ok'])

    def test_invalid_reference_and_unidentifiable_model_report_filename(self):
        source = load_courses()['linear-functions'].data
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'broken.json'
            data = deepcopy(source)
            data['pedagogy']['checks'][0]['references'] = ['unknown-reference']
            path.write_text(json.dumps(data))
            result = check_course(path)
            self.assertFalse(result['ok'])
            self.assertEqual(result['file'],str(path))
            self.assertIn('pedagogy.checks[0].references',result['error'])
            data = deepcopy(source)
            data['actions'] = []
            path.write_text(json.dumps(data))
            self.assertIn('actions:',check_course(path)['error'])

    def test_duplicate_id_produces_nonzero_cli_exit(self):
        source = load_courses()['linear-functions'].data
        with tempfile.TemporaryDirectory() as directory:
            for name in ('a.json','b.json'):
                (Path(directory)/name).write_text(json.dumps(source))
            stream = StringIO()
            with redirect_stdout(stream):
                self.assertEqual(main([directory]),1)
            self.assertIn('重复',stream.getvalue())


if __name__ == '__main__':
    unittest.main()
