# CausalTA Web

**Your Personal TA — Causal Driven.**

CausalTA 的云端个人学习空间。React / Vinext / Cloudflare Workers / D1，使用与 Python 内核相同的六个 CoursePack；浏览器不接收隐藏状态或未作答题的答案。

已实现：公开课程目录、ChatGPT 登录、按用户隔离的学习历史、断点续学、因果实验、针对性追问、独立迁移、跨课程证据汇总、材料笔记、文本导入、数据导出／删除、可选材料驱动模型对话。

模型对话需要站点维护者配置 `OPENAI_API_KEY` 和 `CAUSALTA_MODEL`。未配置时明确显示不可用，课程实验完全可用。支持 CS／数学自由问题的接口已实现，但真实模型质量和实际学习效果尚未验证；六个预设课程不代表覆盖所有课程。

## 开发

Node.js 22.13+：

```bash
npm ci
npm run typecheck
npm test
npm run build
```

首次本地预览，依序执行 `drizzle/meta/_journal.json` 中的迁移。例如：

```bash
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_faulty_rage.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_late_havok.sql
npm run dev
```

打开终端显示的地址。开发服务器的「登录」只在 loopback 模拟 `Seedy` 测试用户，不属于生产认证。已应用的迁移不可重跑；以后追加迁移。`npm run test:integration` 会创建临时独立数据库、应用迁移、启动构建后的 Worker 并测试接口，结束后清理测试数据，不修改开发数据库。

## 托管与身份

`.openai/hosting.json` 保留项目身份与 `DB` 绑定。生产认证由 Sites 网关提供；服务端只信任网关注入的身份，所有个人记录查询均包含 owner 条件。不要把这个 Worker 直接暴露在允许用户伪造身份头的代理后面；其他托管平台需要替换为可验证的认证适配器。

部署包含版本化源码、Worker 构建、数据库迁移和生产发布。`lib/engine.mjs` 与 Python 引擎的全部 55 个模型状态／观测／干预由 `tests/python-parity.json` 对照；54 个合法初始状态均可完成独立迁移。修改课程时同时更新 Python 和 Web 课程包，并重新生成对照数据。

## 模型接入

只在服务端配置环境变量；密钥不能进入前端、仓库或 hosting.json。支持 Responses API Structured Outputs 的模型 ID 由维护者指定，不硬编码。接口：[OpenAI 官方说明](https://developers.openai.com/api/docs/guides/structured-outputs)。

- 用户每次发送前同意外发范围：本次问题、目标、最近 6 轮对话、最多 3 份选中笔记的前 6,000 字。
- 只检索本人笔记，回复引用必须匹配本次选中材料。引用校验不等于事实核验。
- `store:false`、输出上限 1,800 tokens、超时 25 秒、无自动重试。
- 每账户每日 20 次、全站每日 100 次模型请求尝试，原子计数；失败也计数，避免失控重试。
- 模型没有评分、数据库或执行代码权限；课程隐藏状态／答案不进入自由对话上下文。
- 最多保存 100 次练习、100 条笔记、100 条对话。UI 展示最近 30 条对话，导出包含全部保存内容。
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
