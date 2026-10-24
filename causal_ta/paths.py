"""随包安装的只读资源与可写学习数据分开。"""
import os
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
SOURCE_ROOT = PACKAGE_DIR.parent
COURSES_DIR = PACKAGE_DIR / 'coursepacks'
STATIC_DIR = PACKAGE_DIR / 'static'


def default_data_dir():
    explicit = os.environ.get('CAUSALTA_DATA_DIR')
    if explicit:
        return Path(explicit).expanduser().resolve()
    if (SOURCE_ROOT / 'pyproject.toml').is_file() and (SOURCE_ROOT / 'causal_ta') == PACKAGE_DIR:
        return SOURCE_ROOT / '.data'
    return Path.home() / '.causal-ta'
