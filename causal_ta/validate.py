"""课程作者的只读检查入口：python -m causal_ta.validate [文件或目录]。"""
import argparse
import json
from pathlib import Path

from .engine import Course, evaluate
from .paths import COURSES_DIR
from . import __version__


def describe_course(course):
    signatures = {}
    for world in course.worlds:
        context = {**course.data['context'], **world}
        if not evaluate(course.data.get('start_filter', 1), context):
            continue
        signature = (evaluate(course.data['observation'], context),
                     *(course.result(world, action) for action in course.actions.values()))
        if signature in signatures:
            raise ValueError('actions: 全部实验仍无法区分两个候选状态；当前精确诊断流程需要可辨识状态')
        signatures[signature] = world
    return {'ok': True, 'id': course.id, 'version': course.version,
            'states': len(signatures), 'checks': len(course.data.get('pedagogy', {}).get('checks', [])),
            'actions': len(course.actions), 'transfer': len(course.data['transfer'])}


def check_data(data):
    try:
        return describe_course(Course(data))
    except (ValueError, KeyError, TypeError, IndexError, AttributeError, OSError, RecursionError) as exc:
        return {'ok': False, 'error': str(exc)}


def check_course(path):
    try:
        return {'file': str(path), **check_data(json.loads(Path(path).read_text(encoding='utf-8')))}
    except (ValueError, OSError) as exc:
        return {'file': str(path), 'ok': False, 'error': str(exc)}


def main(argv=None):
    parser = argparse.ArgumentParser(description='检查课程格式、引用和有限模型的可辨识性；不替代教师内容审核')
    parser.add_argument('--version', action='version', version=__version__)
    parser.add_argument('paths', nargs='*', type=Path, default=[COURSES_DIR])
    args = parser.parse_args(argv)
    files = sorted({file for path in args.paths for file in (path.glob('*.json') if path.is_dir() else [path])})
    if not files:
        print('没有找到课程 JSON 文件。')
        return 1
    seen, failed = {}, False
    for file in files:
        result = check_course(file)
        if result['ok'] and result['id'] in seen:
            result.update(ok=False, error=f"id: 与 {seen[result['id']]} 重复")
        if result['ok']:
            seen[result['id']] = file
            print(f"通过 {file}: {result['states']} 个状态，{result['checks']} 道理解检查，版本 {result['version'][:12]}")
        else:
            failed = True
            print(f"失败 {file}: {result['error']}")
    return int(failed)


if __name__ == '__main__':
    raise SystemExit(main())
