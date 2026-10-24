"""形成性诊断：记录可复查的答题证据，不把答错升级为能力或因果判断。"""
from copy import deepcopy
from datetime import datetime, timezone

POLICY_VERSION = '1'
POLICIES = {'diagnostic': '诊断后追问', 'fixed': '固定顺序'}


def validate_pedagogy(data):
    if not data:
        return
    for name in ("objectives", "references", "misconceptions", "checks"):
        if not isinstance(data.get(name), list) or not data[name]:
            raise ValueError(f"pedagogy.{name}: 需要非空列表")
        if not all(isinstance(item, dict) for item in data[name]):
            raise ValueError(f"pedagogy.{name}: 每个条目必须为对象")
        ids = [item.get("id") for item in data[name]]
        if any(not isinstance(i, str) or not i for i in ids) or len(set(ids)) != len(ids):
            raise ValueError(f"pedagogy.{name}: id 必须是唯一的非空字符串")
    refs = {item["id"] for item in data["references"]}
    concepts = {item["id"] for item in data["objectives"]}
    misconceptions = {item["id"] for item in data["misconceptions"]}
    for collection, fields in (("objectives", ("label",)), ("references", ("label", "text"))):
        for index, item in enumerate(data[collection]):
            for field in fields:
                if not isinstance(item.get(field), str) or not item[field].strip():
                    raise ValueError(f"pedagogy.{collection}[{index}].{field}: 需要非空文本")
    for index, item in enumerate(data["misconceptions"]):
        if item.get("objective") not in concepts:
            raise ValueError(f"pedagogy.misconceptions[{index}].objective: 未知学习目标")
        for field in ("label", "hint", "question"):
            if not isinstance(item.get(field), str) or not item[field].strip():
                raise ValueError(f"pedagogy.misconceptions[{index}].{field}: 需要文本")
    for index, item in enumerate(data["checks"]):
        prefix = f"pedagogy.checks[{index}]"
        if item.get("objective") not in concepts:
            raise ValueError(prefix + ".objective: 未知学习目标")
        if item.get("target") not in misconceptions:
            raise ValueError(prefix + ".target: 未知误概念")
        options = item.get("options")
        if not isinstance(options, list) or len(options) < 2 or not all(isinstance(v, str) for v in options):
            raise ValueError(prefix + ".options: 至少两个文本选项")
        if type(item.get("answer")) is not int or not 0 <= item["answer"] < len(options):
            raise ValueError(prefix + ".answer: 无效索引")
        for field in ("prompt", "feedback"):
            if not isinstance(item.get(field), str) or not item[field].strip():
                raise ValueError(prefix + f".{field}: 需要文本")
        mapping = item.get("wrong_map", {})
        if not isinstance(mapping, dict) or any(
            k not in {str(i) for i in range(len(options)) if i != item["answer"]}
            or v not in misconceptions for k, v in mapping.items()
        ):
            raise ValueError(prefix + ".wrong_map: 只能将错误选项映射到已有误概念")
        if not item.get("references") or any(r not in refs for r in item["references"]):
            raise ValueError(prefix + ".references: 需要有效课程依据")


def learner_view(course, events):
    pedagogy = course.data.get("pedagogy", {})
    checks = {q["id"]: q for q in pedagogy.get("checks", [])}
    records = [e for e in events if e["type"] == "concept_check"]
    objectives = []
    for objective in pedagogy.get("objectives", []):
        evidence = [e for e in records if checks[e["check_id"]]["objective"] == objective["id"]]
        objectives.append({**objective, "attempted": len(evidence),
                           "correct": sum(e["correct"] for e in evidence),
                           "status": "尚无证据" if not evidence else "需再检查" if not evidence[-1]["correct"] else "本次检查通过"})
    hypotheses = []
    for misconception in pedagogy.get("misconceptions", []):
        supporting = [e for e in records if e.get("hypothesis") == misconception["id"]]
        if not supporting:
            continue
        last = supporting[-1]
        after = records[records.index(last) + 1:]
        subsequent = [e for e in after if checks[e["check_id"]]["target"] == misconception["id"] and e["correct"]]
        hypotheses.append({"id": misconception["id"], "label": misconception["label"],
                           "evidence_ids": [e["check_id"] for e in supporting],
                           "followup_passed": bool(subsequent),
                           "status": "后续练习通过；迁移结果另计" if subsequent else "待追问的假设，不是确诊"})
    return {"objectives": objectives, "hypotheses": hypotheses,
            "note": "形成性检查有即时反馈；它与独立迁移成绩分开记录，也不估计学生的真实能力概率。"}


def next_check(course, events, policy='diagnostic'):
    if policy not in POLICIES:
        raise ValueError('未知教学策略')
    checks = course.data.get("pedagogy", {}).get("checks", [])
    used = {e["check_id"] for e in events if e["type"] == "concept_check"}
    available = [q for q in checks if q["id"] not in used]
    if not available:
        return None
    pending = [h["id"] for h in learner_view(course, events)["hypotheses"] if not h["followup_passed"]]
    targeted = next((q for h in reversed(pending) for q in available if q['target'] == h), None)
    target = targeted if policy == 'diagnostic' and targeted else available[0]
    selection = {'policy': policy, 'version': POLICY_VERSION,
                 'available': [q['id'] for q in available], 'selected': target['id'],
                 'probability': 1.0, 'randomized': False,
                 'prior_checks': [e['check_id'] for e in events if e['type'] == 'concept_check'],
                 'pending_hypotheses': pending,
                 'reason': '优先核查先前回答留下的假设' if policy == 'diagnostic' and targeted else '按课程预设顺序选择下一题'}
    return {**{k: deepcopy(target[k]) for k in ('id', 'prompt', 'options', 'objective')}, 'selection': selection}


def record_check(course, events, check_id, answer, policy='diagnostic'):
    question = next_check(course, events, policy)
    if not question or check_id != question["id"]:
        raise ValueError("请回答当前理解检查；已回答的题目不能重复计入证据")
    q = next(q for q in course.data["pedagogy"]["checks"] if q["id"] == check_id)
    if type(answer) is not int or not 0 <= answer < len(q["options"]):
        raise ValueError("请选择一个有效选项")
    event = {"type": "concept_check", "check_id": check_id, "question": q["prompt"],
             "answer": answer, "chosen": q["options"][answer], "correct": answer == q["answer"],
             "hypothesis": q.get("wrong_map", {}).get(str(answer)),
             "feedback": q["feedback"], "reference_ids": q["references"],
             'selection': question['selection'], 'recorded_at': datetime.now(timezone.utc).isoformat()}
    events.append(event)
    return event
