"""固定合成教学场景的 TA 评测；协议检查不等于教学质量或学习效果。"""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from causal_ta import __version__
from causal_ta.engine import Session, load_courses
from causal_ta.tutor import INSTRUCTIONS, TutorService, TutorUnavailable, configured_tutor, context_for, validate_reply

CASES = Path(__file__).with_name('tutor_cases.json')
SCENARIOS = {'initial', 'misconception', 'injection', 'transfer'}
RUBRIC = ('correctness', 'scaffolding', 'answer_leakage', 'citation_support', 'calibration')


def implementation_hash():
    paths = [Path(__file__), *[ROOT / 'causal_ta' / name for name in
                             ('engine.py', 'domain.py', 'learning.py', 'tutor.py')]]
    digest = hashlib.sha256()
    for path in sorted(paths):
        digest.update(path.relative_to(ROOT).as_posix().encode())
        digest.update(b'\0')
        digest.update(path.read_bytes())
    return digest.hexdigest()


def load_cases(path=CASES):
    payload = json.loads(Path(path).read_text(encoding='utf-8'))
    cases = payload['cases']
    if payload.get('schema_version') != 1 or not isinstance(cases, list) or not cases:
        raise ValueError('评测集格式或版本无效')
    seen = set()
    for case in cases:
        if case['id'] in seen or case['scenario'] not in SCENARIOS:
            raise ValueError('评测场景重复或未知')
        if type(case['seed']) is not int or not isinstance(case['message'], str) or not 1 <= len(case['message']) <= 2000:
            raise ValueError('种子或学生消息无效')
        seen.add(case['id'])
    return cases


def make_session(case, courses):
    course = courses[case['course_id']]
    if course.version != case['course_version']:
        raise ValueError('课程已变更；请人工复核评测场景并更新版本：' + course.id)
    session = Session(course, case['seed'])
    if case['scenario'] == 'misconception':
        event = session.check_understanding(case['check_id'], case['wrong_answer'])
        if event['correct'] or not event['hypothesis']:
            raise ValueError('错误概念场景必须触发一个待核查假设')
    elif case['scenario'] == 'transfer':
        action = next(iter(course.actions))
        session.experiment(action, 0)
        # 仅为测试准备阶段；评测器知道真值，TA 不接收它。
        session.diagnose(session.world)
    return session


def protected_state(session):
    return deepcopy({**{k: v for k, v in vars(session).items() if k not in ('course', 'tutor_turns')},
                     'course_data': session.course.data, 'course_version': session.course.version})


def probe_context(session):
    """向测试副本注入 canary；验证隐藏字段没有被上下文构造器带出。"""
    probe = deepcopy(session)
    markers = ['EVAL_HIDDEN_WORLD_7ad1', 'EVAL_CANDIDATE_9b32',
               'EVAL_FUTURE_CHECK_6fc4', 'EVAL_TRANSFER_KEY_2ed5']
    probe.world['eval_canary'] = markers[0]
    probe.candidates.append({'eval_canary': markers[1]})
    answered = {e['check_id'] for e in probe.events if e['type'] == 'concept_check'}
    for q in probe.course.data['pedagogy']['checks']:
        if q['id'] not in answered:
            q['prompt'] += markers[2]
            q['feedback'] += markers[2]
    for q in probe.course.data['transfer']:
        q['prompt'] += markers[3]
        q['explanation'] += markers[3]
        q['options'][q['answer']] += markers[3]
    payload = json.dumps(context_for(probe), ensure_ascii=False)
    return not any(marker in payload for marker in markers)


def review_flags(session, reply):
    """仅提示审阅：长答案原样匹配会漏报改写，也可能误报合理的概念提示。"""
    if reply is None:
        return []
    text = reply['message'] + '\n' + reply['question']
    flags = []
    if len(reply['message']) + len(reply['question']) > 450:
        flags.append('超过提示模板的 450 字目标')
    for i, q in enumerate(session.course.data['transfer']):
        answer = q['options'][q['answer']].strip()
        if len(answer) >= 8 and answer in text:
            flags.append(f'包含迁移题 {i + 1} 的长答案原文；需人工判断')
    return flags


class CountingProvider:
    def __init__(self, provider):
        self.provider, self.calls = provider, 0

    def reply(self, context, message):
        self.calls += 1
        return self.provider.reply(context, message)


def evaluate(cases, mode='offline', provider=None):
    if mode not in ('offline', 'openai') or (mode == 'openai' and provider is None):
        raise ValueError('评测模式或 provider 配置无效')
    courses = load_courses()
    # 在任何远端调用前验证所有场景，避免部分调用后才发现过期课程。
    sessions = [make_session(case, courses) for case in cases]
    counted = CountingProvider(provider) if mode == 'openai' else None
    service = TutorService(counted)
    rows = []
    for case, session in zip(cases, sessions):
        before, history = protected_state(session), deepcopy(session.tutor_turns)
        sent_context = context_for(session)
        calls_before = counted.calls if counted else 0
        checks = {'context_canary_excluded': probe_context(session)}
        reply, error = None, None
        try:
            reply = service.respond(session, case['message'], mode == 'openai')
        except ValueError as exc:
            error = 'transfer_blocked' if str(exc) == '独立迁移期间不提供 TA 提示，请先完成本轮作答' else 'unexpected_value_error'
        checks['scoring_state_unchanged'] = before == protected_state(session)
        calls = (counted.calls if counted else 0) - calls_before
        if case['scenario'] == 'transfer':
            checks['transfer_gate'] = reply is None and error == 'transfer_blocked' and calls == 0 and session.tutor_turns == history
        else:
            checks['reply_received'] = reply is not None and error is None
            checks['requested_mode_used'] = reply is not None and reply['mode'] == mode
            checks['one_turn_recorded'] = len(session.tutor_turns) == len(history) + 1
            try:
                validate_reply({k: reply[k] for k in ('message', 'question', 'reference_ids')},
                               {r['id'] for r in session.course.data['pedagogy']['references']})
                checks['schema_and_reference_ids'] = True
            except (TypeError, KeyError, TutorUnavailable):
                # 不复制 provider 异常文本或请求内容到报告。
                checks['schema_and_reference_ids'] = False
        rows.append({'id': case['id'], 'course_id': case['course_id'],
                     'course_version': case['course_version'], 'scenario': case['scenario'],
                     'seed': case['seed'], 'student': case['message'], 'review_focus': case['review_focus'],
                     'context': sent_context, 'reply': reply, 'error': error,
                     'remote_calls': calls, 'checks': checks, 'mechanical_pass': all(checks.values()),
                     'review_flags': review_flags(session, reply),
                     'reviewer_material': {'hidden_world': before['world'],
                         'transfer': deepcopy(session.course.data['transfer'])},
                     'human_review': {'status': 'not_applicable' if case['scenario'] == 'transfer' else 'pending',
                         **{key: None for key in RUBRIC}, 'evidence': '', 'reviewer': ''}})
    return {'schema_version': 1, 'data_kind': 'synthetic_tutor_evaluation',
            'created_at': datetime.now(timezone.utc).isoformat(), 'application_version': __version__,
            'mode': mode, 'model': getattr(provider, 'model', None),
            'implementation_sha256': implementation_hash(),
            'instructions_sha256': hashlib.sha256(INSTRUCTIONS.encode()).hexdigest(),
            'cases_sha256': hashlib.sha256(json.dumps(cases, ensure_ascii=False, sort_keys=True).encode()).hexdigest(),
            'summary': {'cases': len(rows), 'mechanical_passes': sum(r['mechanical_pass'] for r in rows),
                        'remote_calls': counted.calls if counted else 0,
                        'human_reviews_pending': sum(r['human_review']['status'] == 'pending' for r in rows),
                        'flagged_cases': sum(bool(r['review_flags']) for r in rows)},
            'limitations': ['离线回复不理解学生自由文字；场景由项目作者编写。',
                            '有效引用 ID 不代表内容受支持；长答案匹配不能证明无泄漏。',
                            '未作教师语义评分；无真实学生数据、学习效果或因果效应结论。'],
            'cases': rows}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=('offline', 'openai'), default='offline')
    parser.add_argument('--case', action='append', dest='ids', help='可重复指定场景 ID')
    parser.add_argument('--max-remote-calls', type=int, default=0, help='明确允许的请求次数上限；默认 0')
    parser.add_argument('--output', type=Path, required=True, help='新 JSON 报告路径，不覆盖已有文件')
    args = parser.parse_args(argv)
    cases = load_cases()
    if args.ids:
        if set(args.ids) - {c['id'] for c in cases}:
            parser.error('存在未知场景 ID')
        cases = [c for c in cases if c['id'] in args.ids]
    needed = sum(c['scenario'] != 'transfer' for c in cases) if args.mode == 'openai' else 0
    if args.max_remote_calls < needed:
        parser.error(f'本次需要最多 {needed} 次请求，请显式设置 --max-remote-calls；不会自动截断评测集')
    if args.output.exists():
        parser.error('报告路径已存在，请选择新路径')
    try:
        provider = configured_tutor(args.mode).provider
        report = evaluate(cases, args.mode, provider)
    except (ValueError, KeyError) as exc:
        parser.error(str(exc))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    print(json.dumps(report['summary'], ensure_ascii=False))
    print(args.output.resolve())
    return 0 if report['summary']['mechanical_passes'] == len(cases) else 1


if __name__ == '__main__':
    raise SystemExit(main())
