import os
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from causal_ta.paths import COURSES_DIR, STATIC_DIR, default_data_dir


class PathsTests(unittest.TestCase):
    def test_shipped_resources_are_inside_package(self):
        self.assertEqual(len(list(COURSES_DIR.glob('*.json'))),6)
        for filename in ('index.html','author.html','style.css','app.js','author.js'):
            self.assertTrue((STATIC_DIR/filename).is_file())
        self.assertEqual(COURSES_DIR.parent,STATIC_DIR.parent)

    def test_environment_override_is_independent_of_install_location(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ,{'CAUSALTA_DATA_DIR':folder}):
            self.assertEqual(default_data_dir(),Path(folder).resolve())

    def test_installed_default_never_uses_site_packages_for_data(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ,{'CAUSALTA_DATA_DIR':''}):
            location=Path(folder)/'site-packages';location.mkdir()
            with patch('causal_ta.paths.SOURCE_ROOT',location), patch('causal_ta.paths.Path.home',return_value=Path(folder)/'user'):
                self.assertEqual(default_data_dir(),Path(folder)/'user'/'.causal-ta')

    def test_source_default_preserves_existing_data_directory(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ,{'CAUSALTA_DATA_DIR':''}):
            root=Path(folder);(root/'pyproject.toml').write_text('')
            with patch('causal_ta.paths.SOURCE_ROOT',root), patch('causal_ta.paths.PACKAGE_DIR',root/'causal_ta'):
                self.assertEqual(default_data_dir(),root/'.data')

    def test_courses_load_without_locale_dependent_text_decoding(self):
        env={**os.environ,'PYTHONUTF8':'0','PYTHONCOERCECLOCALE':'0','LC_ALL':'C'}
        code='import json; from causal_ta.engine import load_courses; from causal_ta.paths import COURSES_DIR; from causal_ta.validate import check_course; print(json.dumps({"title":load_courses()["linear-functions"].data["title"],"valid":check_course(COURSES_DIR/"linear-functions.json")["ok"]}))'
        result=subprocess.run([sys.executable,'-c',code],env=env,capture_output=True,timeout=10,check=True)
        data=json.loads(result.stdout)
        self.assertEqual(data['title'],'同一个函数值，能确定同一条直线吗？')
        self.assertTrue(data['valid'])


if __name__=='__main__':unittest.main()
