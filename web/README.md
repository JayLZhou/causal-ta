# CausalTA Web

**Your Personal TA — Causal Driven.**

CausalTA 的云端个人学习空间。React / Vinext / Cloudflare Workers / D1，使用与 Python 内核相同的六个 CoursePack；浏览器不接收隐藏状态或未作答题的答案。

已实现：公开课程目录、ChatGPT 登录、按用户隔离的学习历史、断点续学、因果实验、针对性追问、独立迁移、跨课程证据汇总、材料笔记、PDF/TXT/Markdown 导入、数据导出／删除、可选材料驱动模型对话。

0.8 增加「我的题目」：任意课程问题 → 已有尝试 → 竞争解释 → 锁定预测 → 观测与来源 → 新情境首次作答 → 本人核查 → 间隔复习。模型对话可关联题目，只接收当前题目的相关上下文；建议需要学习者编辑确认后才能进入检验方案。

模型对话需要站点维护者配置 `OPENAI_API_KEY` 和 `CAUSALTA_MODEL`。未配置时明确显示不可用，课程实验完全可用。支持 CS／数学自由问题的接口已实现，但真实模型质量和实际学习效果尚未验证；六个预设课程不代表覆盖所有课程。

## 开发

Node.js 22.13+：

```bash
npm ci
npm run typecheck
npm test
npm run build
```

首次运行 Web：

```bash
npm run setup
npm run dev
```

`setup` 构建应用并用 Wrangler 的迁移记录初始化本地 D1；重复运行不会重复建表。只操作本地数据库，不会访问生产。开发服务器的登录在 loopback 模拟 `Seedy` 测试用户。

**已有 0.7 手工初始化的本地数据库**：setup 会保留原数据并停止，避免重放旧迁移。先构建，然后只应用新增的 `drizzle/0002_tense_sentry.sql`：

```bash
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_tense_sentry.sql
npm run dev
```

这条旧版本升级命令只执行一次。生产迁移由 Sites 执行，不能把本地数据库复制到线上。`npm run test:integration` 在临时独立 D1 上验证接口，结束后清理测试数据，不修改开发数据库。

## 任意题目与长期证据

- 保存题目、已尝试的方法、卡点、概念标签和最多 3 份本人材料快照（各前 6,000 字）。
- 明确两个竞争解释、保持和改变的条件，以及两种不同预测；先锁定，再观察。结果允许「不能区分」或「两者皆不符合」，可以保留旧证据重新检验。
- 通用题目的结果、证明和核查依据由学习者提供。系统不执行任意代码，不声称自动证明数学结论，也不将自评等同于课程判分。
- 独立新题的首次答案不可改写；作答和核查阶段暂停该题的模型提示，收起旧轨迹。其他应用或通用聊天无法被系统阻止，使用帮助必须如实记录。
- 复习间隔：需重学或使用提示 1 天；部分成立 3 天；无帮助通过 7 / 14 / 30 天。到期使用不同新题；规则属于启发式调度，不是经过验证的学习收益优化。
- 概念按「课程 + 概念」汇总本人核查次数、情境和待区分解释，不输出能力标签或掌握概率。提醒仅在应用内展示，不发送外部通知。
- PDF 使用 [Mozilla PDF.js](https://github.com/mozilla/pdf.js) 在浏览器内提取文本，原文件不上传。最大 10MB、单次 20 页、20,000 字；保存页码，要求核对预览。扫描件、OCR、公式版式和复杂表格的可靠恢复仍未实现。

## 托管与身份

`.openai/hosting.json` 保留项目身份与 `DB` 绑定。生产认证由 Sites 网关提供；服务端只信任网关注入的身份，所有个人记录查询均包含 owner 条件。不要把这个 Worker 直接暴露在允许用户伪造身份头的代理后面；其他托管平台需要替换为可验证的认证适配器。

部署包含版本化源码、Worker 构建、数据库迁移和生产发布。`lib/engine.mjs` 与 Python 引擎的全部 55 个模型状态／观测／干预由 `tests/python-parity.json` 对照；54 个合法初始状态均可完成独立迁移。修改课程时同时更新 Python 和 Web 课程包，并重新生成对照数据。

## 模型接入

只在服务端配置环境变量；密钥不能进入前端、仓库或 hosting.json。支持 Responses API Structured Outputs 的模型 ID 由维护者指定，不硬编码。接口：[OpenAI 官方说明](https://developers.openai.com/api/docs/guides/structured-outputs)。

- 用户每次发送前同意外发范围：本次问题、目标、当前关联题目的问题、尝试、最近检验与反思、同一题目最近 6 轮对话、最多 3 份选中笔记的前 6,000 字。
- 只检索本人笔记，回复引用必须匹配本次选中材料。引用校验不等于事实核验。
- `store:false`、输出上限 1,800 tokens、超时 25 秒、无自动重试。
- 每账户每日 20 次、全站每日 100 次模型请求尝试，原子计数；失败也计数，避免失控重试。
- 模型没有评分、数据库或执行代码权限；课程隐藏状态／答案不进入自由对话上下文。
- 最多保存 100 道自带题目、100 次课程练习、100 条笔记、100 条对话。UI 展示最近 30 条对话，导出包含全部保存内容。
- 删除内容保留当日限流计数；下一次模型请求清理过期计数。不保存密钥和原始供应商错误正文。

`tests/tutor.test.mjs` 使用模拟供应商响应，不产生 API 费用，也不作为真实模型质量验证。

## 源码布局

- `app/workspace.tsx`：个人空间、课程实验室、笔记与证据。
- `app/chat.tsx`：自由问题、显式材料选择与引用回看。
- `app/api/workspace`、`app/api/tutor`：认证、持久化、并发控制与模型调用。
- `lib/engine.mjs`、`lib/tutor.mjs`：有限模型推理与独立语言模型适配器。
- `db/schema.ts`、`drizzle/`：持久化与不可变迁移。
- `tests/`、`tools/check-web.mjs`：引擎对照、协议测试和隔离数据库集成测试。

主项目：[JayLZhou/causal-ta](https://github.com/JayLZhou/causal-ta)。应用代码使用主项目 MIT 许可证；`vendor/` 和 `scripts/vite/` 保留上游许可证。

## 可复查的模型评估

```bash
npm run eval
# 只有明确指定 --live 才会调用模型并产生费用，密钥仅从环境变量读取：
npm run eval -- --live --limit=2
```

八个公开合成案例覆盖算法、概率、微积分、线性代数、证明、调试、缺失问题和材料提示注入。默认只验证请求协议，不访问模型。真实模式逐题调用、不重试，结果写入忽略的 `outputs/evals/`，保留人工核对项，不自动生成教学质量分数。详见 [评估协议](evals/README.md)。
