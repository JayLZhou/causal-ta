"""有限模型上的主动诊断；概率仅为声明的候选空间内的均匀先验。"""

from copy import deepcopy
from itertools import product
from math import log2, prod
import hashlib
import json
from pathlib import Path
import random
import re

from .learning import POLICIES, POLICY_VERSION, learner_view, next_check, record_check, validate_pedagogy
from .domain import evaluate, finite_number, validate_expression
from .paths import COURSES_DIR

ROOT = Path(__file__).resolve().parent.parent


class Course:
    def __init__(self, data):
        data = deepcopy(data)
        self.validate_structure(data)
        self.data = data
        self.version = hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        self.id = data["id"]
        self.variables = data["variables"]
        self.actions = {a["id"]: a for a in data["actions"]}
        count = prod(len(v["domain"]) for v in self.variables.values())
        if not self.variables or not 1 <= count <= 4096:
            raise ValueError("课程候选状态数必须为 1–4096")
        self.worlds = [dict(zip(self.variables, values)) for values in product(
            *(v["domain"] for v in self.variables.values()))]
        self.validate()

    @staticmethod
    def validate_structure(data):
        if not isinstance(data, dict):
            raise ValueError('course: 课程需要 JSON 对象')
        if not isinstance(data.get('id'), str) or not re.fullmatch(r'[a-z][a-z0-9-]{2,63}', data['id']):
            raise ValueError('id: 使用 3–64 位小写字母、数字或连字符，并以字母开头')
        for field in ('title','subject','description','semantics','model_note','outcome_label'):
            if not isinstance(data.get(field), str) or not 1 <= len(data[field]) <= 5000:
                raise ValueError(field + ': 需要 1–5000 字的文本')
        if not isinstance(data.get('graph'), list) or not all(isinstance(v, str) for v in data['graph']):
            raise ValueError('graph: 需要文本列表')
        source = data.get('source')
        if not isinstance(source, dict) or not all(isinstance(source.get(f), str) for f in ('label','url')):
            raise ValueError('source: 需要 label 与 url 字符串')
        if not isinstance(data.get('program', ''), str) or len(data.get('program', '')) > 10000:
            raise ValueError('program: 需要不超过 10000 字的展示文本，不会作为代码执行')
        variables, context = data.get('variables'), data.get('context')
        if not isinstance(variables, dict) or not variables or len(variables) > 12:
            raise ValueError('variables: 需要 1–12 个变量；课程候选状态数必须为 1–4096')
        if not isinstance(context, dict) or len(context) > 16 or set(variables) & set(context):
            raise ValueError('context: 最多 16 个变量，且不能与 variables 重名')
        for key in [*variables, *context]:
            if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,47}', key):
                raise ValueError('variables/context: 变量名需要字母开头的标识符')
        for key, definition in variables.items():
            domain = definition.get('domain') if isinstance(definition, dict) else None
            if not isinstance(domain, list) or not 1 <= len(domain) <= 32 or not all(finite_number(v) for v in domain) or len(set(domain)) != len(domain):
                raise ValueError(f'variables.{key}.domain: 需要 1–32 个互不相同的有限数值')
            if not isinstance(definition.get('label'), str) or not definition['label']:
                raise ValueError(f'variables.{key}.label: 需要文本')
        def valid_context(value):
            return finite_number(value) or (isinstance(value, list) and len(value) <= 32 and all(finite_number(v) for v in value))
        if not all(valid_context(v) for v in context.values()):
            raise ValueError('context: 仅支持有限数值或最多 32 个数的列表')
        actions = data.get('actions')
        if not isinstance(actions, list) or len(actions) > 32:
            raise ValueError('actions: 最多 32 个实验')
        names = set(variables) | set(context)
        for field in ('observation', 'start_filter'):
            validate_expression(data.get(field, 1), names, field)
        for i, action in enumerate(actions):
            if not isinstance(action, dict):
                raise ValueError(f'actions[{i}]: 需要对象')
            for field in ('id','title','description','explanation'):
                if not isinstance(action.get(field), str) or not action[field]:
                    raise ValueError(f'actions[{i}].{field}: 需要文本')
            if action.get('kind') not in ('observe','do','transform'):
                raise ValueError(f'actions[{i}].kind: 需要 observe/do/transform')
            intervention = action.get('do', {})
            if not isinstance(intervention, dict) or any(k not in names or not valid_context(v) for k,v in intervention.items()):
                raise ValueError(f'actions[{i}].do: 存在未知变量或无效值')
            validate_expression(action.get('measure'), names, f'actions[{i}].measure')
        tolerance = data.get('prediction_tolerance', 0)
        if not finite_number(tolerance) or not 0 <= tolerance <= .01:
            raise ValueError('prediction_tolerance: 需要 0–0.01 的绝对误差容限')
        transfer = data.get('transfer')
        if not isinstance(transfer, list) or not 1 <= len(transfer) <= 30:
            raise ValueError('transfer: 需要 1–30 道独立迁移题')
        for i, q in enumerate(transfer):
            if not isinstance(q, dict) or not isinstance(q.get('options'), list) or not 2 <= len(q['options']) <= 10 or not all(isinstance(v,str) for v in q['options']):
                raise ValueError(f'transfer[{i}].options: 需要 2–10 个文本选项')
            for field in ('prompt','explanation'):
                if not isinstance(q.get(field),str) or not q[field]:
                    raise ValueError(f'transfer[{i}].{field}: 需要文本')

    def validate(self):
        validate_pedagogy(self.data.get("pedagogy"))
        if self.data["semantics"] not in ("mechanistic_scm", "mathematical_dependency"):
            raise ValueError("课程需要明确声明模型语义")
        if not self.data.get("transfer"):
            raise ValueError("课程需要至少一道独立迁移题")
        for q in self.data["transfer"]:
            if type(q["answer"]) is not int or not 0 <= q["answer"] < len(q["options"]):
                raise ValueError("迁移题答案索引无效")
        if not any(evaluate(self.data.get("start_filter", 1),
                            {**self.data["context"], **w}) for w in self.worlds):
            raise ValueError("初始约束排除了所有候选状态")
        if len(self.actions) != len(self.data["actions"]):
            raise ValueError("实验 ID 必须唯一")
        for action in self.actions.values():
            for key, value in action.get("do", {}).items():
                if key not in self.variables and key not in self.data["context"]:
                    raise ValueError("实验引用未知变量")
                if key in self.variables and value not in self.variables[key]["domain"]:
                    raise ValueError("干预值不在变量定义域内")
        for world in self.worlds:
            if not finite_number(evaluate(self.data["observation"], {**self.data["context"], **world})):
                raise ValueError('observation: 结果必须为绝对值不超过 1e6 的有限数值')
            for action in self.actions.values():
                self.result(world, action)

    def result(self, world, action):
        # 每次实验都从同一个世界重新开始，仅替换指定机制输入。
        state = {**self.data["context"], **world, **action.get("do", {})}
        result = evaluate(action["measure"], state)
        if not finite_number(result):
            raise ValueError('actions.measure: 结果必须为绝对值不超过 1e6 的有限数值')
        return result

    def public(self):
        keys = ("id", "title", "subject", "description", "semantics", "model_note",
                "variables", "context", "graph", "outcome_label", "source")
        return {**{k: deepcopy(self.data[k]) for k in keys}, "version": self.version,
                "program": self.data.get('program', ''),
                "prediction_tolerance": self.data.get('prediction_tolerance', 0),
                "references": deepcopy(self.data.get("pedagogy", {}).get("references", []))}


def load_courses(directory=None):
    directory = Path(directory) if directory is not None else COURSES_DIR
    courses = {}
    for path in sorted(directory.glob("*.json")):
        course = Course(json.loads(path.read_text(encoding='utf-8')))
        if course.id in courses:
            raise ValueError("课程 ID 必须唯一")
        courses[course.id] = course
    return courses


class Session:
    def __init__(self, course, seed=None, policy='diagnostic'):
        if policy not in POLICIES:
            raise ValueError('未知教学策略')
        self.teaching_policy = policy
        self.policy_version = POLICY_VERSION
        self.study_assignment = None
        self.course = course
        rng = random.Random(seed)
        eligible = [w for w in course.worlds if evaluate(
            course.data.get("start_filter", 1), {**course.data["context"], **w})]
        # start_filter 是真值约束；默认全部状态可用。
        self.world = deepcopy(rng.choice(eligible))
        self.observed = evaluate(course.data["observation"],
                                 {**course.data["context"], **self.world})
        self.candidates = [w for w in eligible if evaluate(
            course.data["observation"], {**course.data["context"], **w}) == self.observed]
        self.events = []
        self.used = set()
        self.solved = False
        self.transfer_index = 0
        self.transfer_results = []
        self.stage = "investigate"
        self.tutor_turns = []
        self.course_provenance = "frozen_at_start"

    def choices(self):
        remaining = len(self.candidates)
        choices = []
        for action in self.course.actions.values():
            if action["id"] in self.used:
                continue
            counts = {}
            for world in self.candidates:
                outcome = self.course.result(world, action)
                counts[outcome] = counts.get(outcome, 0) + 1
            gain = log2(remaining) - sum(n / remaining * log2(n) for n in counts.values())
            choices.append({"id": action["id"], "title": action["title"],
                            "description": action["description"], "kind": action["kind"],
                            "outcomes": sorted(counts), "information_gain": round(gain, 3)})
        return sorted(choices, key=lambda x: (-x["information_gain"], x["id"]))

    def view(self):
        options = self.choices() if self.stage == "investigate" else []
        transfer = None
        if self.stage == "transfer":
            q = self.course.data["transfer"][self.transfer_index]
            transfer = {k: deepcopy(q[k]) for k in ("prompt", "options")}
        if self.stage == "complete":
            coach = "本轮已完成。请查看迁移题首次作答；完成本任务不等于掌握整门课程。"
        elif self.stage == "transfer":
            coach = "现在离开原题，独立解决新问题。迁移题期间不提供实验提示。"
        elif not any(e["type"] == "experiment" for e in self.events):
            coach = "先完成一次预测与实验，再提交原始状态的解释。理解检查和 TA 追问可以帮助你选择下一步。"
        elif len(self.candidates) == 1:
            coach = "目前证据只支持一个候选状态。请提交你的解释，然后完成独立迁移题。"
        elif options and options[0]["information_gain"] > 0:
            coach = "先预测，再实验。推荐的实验在当前模型中最能区分候选解释；这不等于最能提升学习。"
        else:
            coach = "可用实验无法进一步区分当前解释。请检查模型假设，或向教师补充问题。"
        return {"course": self.course.public(), "observation": self.observed,
                "candidate_count": len(self.candidates), "total_worlds": len(self.course.worlds),
                "candidates": deepcopy(self.candidates), "actions": options,
                "stage": self.stage, "events": deepcopy(self.events), "coach": coach,
                "transfer": transfer, "transfer_results": deepcopy(self.transfer_results),
                "learner": learner_view(self.course, self.events),
                "concept_check": next_check(self.course, self.events, self.teaching_policy) if self.stage != "transfer" else None,
                'teaching_policy': {'id': self.teaching_policy, 'label': POLICIES[self.teaching_policy], 'version': self.policy_version},
                'study_assignment': deepcopy(self.study_assignment),
                "tutor_turns": deepcopy(getattr(self, "tutor_turns", [])),
                "course_provenance": self.course_provenance}

    def check_understanding(self, check_id, answer):
        if self.stage == "transfer":
            raise ValueError("独立迁移期间不提供理解检查或提示")
        return record_check(self.course, self.events, check_id, answer, self.teaching_policy)

    def experiment(self, action_id, prediction):
        if self.stage != "investigate":
            raise ValueError("当前阶段不能进行实验")
        if action_id not in self.course.actions or action_id in self.used:
            raise ValueError("实验不存在或已经完成")
        if type(prediction) not in (int, float) or not (-1e6 <= prediction <= 1e6):
            raise ValueError("请先输入有限数值预测")
        action = self.course.actions[action_id]
        result = self.course.result(self.world, action)
        before = len(self.candidates)
        self.candidates = [w for w in self.candidates if self.course.result(w, action) == result]
        self.used.add(action_id)
        self.events.append({"type": "experiment", "action": action_id, "title": action["title"],
                            "prediction": prediction, "result": result,
                            "prediction_correct": abs(prediction - result) <= self.course.data.get('prediction_tolerance', 0),
                            "before": before, "after": len(self.candidates),
                            "explanation": action["explanation"]})

    def diagnose(self, values):
        if self.stage != "investigate" or not any(e["type"] == "experiment" for e in self.events):
            raise ValueError("请先完成至少一次预测与实验")
        if not isinstance(values, dict) or set(values) != set(self.course.variables):
            raise ValueError("请为每个变量提供一个解释")
        for key, value in values.items():
            if type(value) not in (int, float) or value not in self.course.variables[key]["domain"]:
                raise ValueError("解释中的变量值无效")
        correct = values == self.world
        self.events.append({"type": "diagnosis", "correct": correct, "values": deepcopy(values)})
        if correct:
            self.solved = True
            self.stage = "transfer"
        return correct

    def answer_transfer(self, answer):
        if self.stage != "transfer":
            raise ValueError("当前没有待作答迁移题")
        q = self.course.data["transfer"][self.transfer_index]
        if type(answer) is not int or not 0 <= answer < len(q["options"]):
            raise ValueError("请选择有效选项")
        result = {"question": q["prompt"], "answer": answer, "correct": answer == q["answer"],
                  "explanation": q["explanation"]}
        self.transfer_results.append(result)
        self.events.append({"type": "transfer", **result})
        self.transfer_index += 1
        if self.transfer_index == len(self.course.data["transfer"]):
            self.stage = "complete"
        return result
