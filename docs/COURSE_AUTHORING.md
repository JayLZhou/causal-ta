# 编写课程包

当前格式适合有限离散状态的可检查实验，用于验证教学流程。开放证明、任意程序和复杂连续系统需要后续 Domain Adapter，不能仅填 JSON 就宣称支持。

## 用教师工作台创建课程

运行 `python3 -m causal_ta.server --authoring`，进入 `/teach`：

1. 选择模板并复制，换一个唯一 ID（3–64 位小写字母、数字、连字符，字母开头）。
2. 修改标题、目标、追问、理解检查和迁移题。选项原位编辑以保留索引；改变语义或答案后，检查 `wrong_map`。
3. 高级 JSON 区可调整变量、实验、引用和映射。编辑 JSON 后，引导表单暂时锁定，点击“应用 JSON 到表单”或直接校验。
4. 校验通过后检查反馈与答案，点击“保存为新课程”。校验检查格式、表达式、引用和可辨识性，不评价教学质量。
5. 返回学习入口试用。下载 JSON 可用于贡献课程或本机备份，不含学习会话。

修改任何字段都会撤销先前校验结果。保存请求携带校验版本，服务端再次校验内容与版本。课程 ID 冲突时拒绝覆盖，包括另一个进程同时写入的情况；更新课程请使用新 ID。

自定义文件存于数据目录下的 `courses/`（源码默认 `.data/courses/`；wheel 默认 `~/.causal-ta/courses/`），可通过 `--data-dir` 指定，保存后立即载入，重启保留。默认学习模式仍加载这些文件，但禁止作者 API。作者模式允许本机访问者读取含答案的完整模板，适合个人备课，不作为班级权限系统。

原子保存使用同目录临时文件、文件同步与不覆盖目标的硬链接，需要支持硬链接的本地文件系统。写入失败会返回错误，不覆盖已有课程。

## 从文件开始

源码中的内置模板为 `causal_ta/coursepacks/linear-functions.json`。复制到数据目录的 `courses/` 下，使用新的文件名和唯一 `id`，重启服务器即加载。wheel 用户可通过教师工作台下载模板；不要直接修改安装包内文件。向项目贡献内置课程时才编辑 `causal_ta/coursepacks/`。现有字段：

| 字段 | 含义 |
|---|---|
| id / title / subject / description | 标识和学生可读说明 |
| semantics | `mechanistic_scm` 或 `mathematical_dependency` |
| model_note | 方程、排除的变量、适用范围 |
| source | 来源标签与可选 HTTPS 链接 |
| variables | 未知变量：label、有限数值 domain |
| context | 已知数值或最多 32 个数的数组 |
| program | 可选的展示代码，不被执行 |
| prediction_tolerance | 可选绝对误差容限，0–0.01，默认精确匹配 |
| graph | 图的可读文本，仅用于展示；计算依据是表达式 |
| observation | 初始测量表达式 |
| start_filter | 可选的初始状态约束，表达式非零才可抽取 |
| outcome_label | 初始测量的含义 |
| actions | 观测、干预或数学变换 |
| transfer | 新题、选项、正确选项索引与解释 |
| pedagogy | 学习目标、课程依据、误概念与理解检查 |

表达式语法是数值常量、变量名或操作数组，JSON 文件使用双引号。支持 `all`、`add`、`mul`、`div`，以及下列内置检查器：

| 操作 | 参数与返回值 |
|---|---|
| `loop_sum` | start、inclusive、n；返回 `range(start,n+inclusive)` 的和 |
| `loop_count` | 同上；返回迭代次数 |
| `binary_search` | closed、advance、values、target；返回索引、−1（未找到）或 −2（状态重复） |

循环参数 start/inclusive 为整数 0 或 1，n 为 0–1000 的整数。二分查找 closed/advance 为整数 0 或 1；values 严格递增，最多 32 个数。closed 控制是否检查 low=high，advance 控制右移到 mid 或 mid+1。其余规则见 `causal_ta/domain.py`。

数组作为 context 值引用，不作为表达式字面量。表达式最多 20 层、256 个节点；数值输入与测量结果绝对值不超过 1e6，拒绝非有限值与除零。最多 12 个未知变量、4096 个组合状态、32 个实验。校验执行全部状态的全部测量。引擎不使用 `eval`，不执行 program 文本或学生代码。

概率模块允许四位小数预测（绝对误差 0.00005）；容限仅影响预测反馈，候选消除仍用检查器的原始结果。

一个 action 包含：`id`、`title`、`description`、`kind`、可选 `do`、`measure`、`explanation`。`do` 只是解释器内部的变量替换字段；其科学含义必须由 `kind` 和课程 `semantics` 决定。数学函数变换不能标成真实世界因果干预。

## 作者自查

1. 写清学习目标与模型假设，不让题目标题暗示未保证的事实。
2. 写至少一个会导致不同预测的竞争解释，并包含容易混淆的边界情况。
3. 检查有限候选空间包含所有预期世界，且至少一个满足初始约束。
4. 提供足够实验区分需要区分的世界；不能区分时应设计“不确定”的教学路径。
5. 迁移题使用新的数值或结构，不直接重复原始状态。
6. 迁移题索引从 0 开始，至少一题，所有题目由教师核查。
7. 测试新课程的干预隔离、真值保留和迁移流程。

```bash
python3 -m causal_ta.validate
python3 -m causal_ta.validate causal_ta/coursepacks/linear-functions.json
python3 -m unittest discover -s tests -v
```

验证命令只读检查所有课程，报告文件名、字段错误、重复 ID，以及全部实验是否足以区分候选状态。失败时返回非零退出码。格式与可辨识性通过不代表教学内容已获得专家审核。

`test_all_worlds_resolve_with_complete_evidence` 会检查所有加载课程的可辨识性。HTTP 测试目前固定内置课程数为 6，新增内置模块时应更新该断言。

## 理解检查 schema（0.2 已实现）

`pedagogy` 包含四个列表：

- `objectives`：唯一 `id` 与学生可读 `label`。
- `references`：唯一 `id`、`label`、`text`；这里的内容构成 TA 可引用的课程依据。
- `misconceptions`：`id`、`objective`、`label`、`hint`、`question`。label 应写成可修正假设；不要给学生贴稳定能力标签。
- `checks`：`id`、`objective`、`target`、`prompt`、`options`、`answer`、`wrong_map`、`feedback`、`references`。`wrong_map` 将错误选项的字符串索引映射至误概念 ID；无特异证据的选项不要强行映射。

同一 target 最好有不同表述的后续题。系统先按定义顺序提问；出现未被后续检查澄清的假设时，优先找对应 target 的未答题。每道检查在本会话只记录一次，不能靠重复刷同一题积累“掌握”证据。

这些形成性题目有即时反馈，不计入独立迁移得分。请避免用同一道题作为理解检查和迁移题。

## 课程版本

新会话存储完整 JSON 快照和 SHA-256 版本；修改原文件只影响新会话。更换课程文件后旧会话仍使用原题、原依据和原评分。0.1 会话没有原始快照，恢复时明确标记未核验，不追溯声称原版本已固定。

## 后续 schema（尚未实现）

还需先修关系、教学动作变体、自由解释 rubric 和图形化模型编辑。数学证明检查、任意代码执行等通过单独的可信适配器接入，LLM 只能建议动作和生成文字，不可修改评分依据。
