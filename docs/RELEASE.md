# 维护者构建与发布

当前包名与项目名暂定为 CausalTA / `causal-ta`，仓库归属尚待确定。本文不代表已上传 GitHub 或 PyPI；公共注册表命名需在实际发布前核查。

## 构建产物

```bash
python3 -m venv .venv-build
.venv-build/bin/python -m pip install build twine 'setuptools>=77.0.3'
.venv-build/bin/python -m build --no-isolation
.venv-build/bin/python -m twine check dist/causal_ta-0.5.0a1.tar.gz dist/causal_ta-0.5.0a1-py3-none-any.whl
python3 tools/export_release.py
```

Windows 将 `.venv-build/bin/python` 换成 `.venv-build\Scripts\python.exe`。也可安装源码的 `.[dev]` 可选依赖；这些构建工具不是应用运行依赖。构建遵循 [Python Packaging 指南](https://packaging.python.org/en/latest/tutorials/packaging-projects/) 与 [setuptools 数据文件规则](https://setuptools.pypa.io/en/stable/userguide/datafiles.html)。

`python -m build` 先生成源码发行包，再从源码发行包构建 wheel。`pyproject.toml` 声明命令入口、Python 版本、许可证与资源文件；`MANIFEST.in` 约束源码发行包内容。`tools/export_release.py` 另提供教师可直接解压运行的源码 zip。

| 产物 | 用途 |
|---|---|
| `causal_ta-版本-py3-none-any.whl` | 无第三方运行依赖的安装包，含六门课程与网页资源 |
| `causal_ta-版本.tar.gz` | 标准源码发行包，含测试、文档和贡献模板 |
| `causal-ta-版本.zip` | 可直接解压运行的源码包 |

## 发布前验证

```bash
python3 -m causal_ta.validate
python3 -m unittest discover -s tests -v
.venv-build/bin/python tools/check_install.py dist/causal_ta-0.5.0a1-py3-none-any.whl
python3 tools/demo_study.py
```

安装验证在临时虚拟环境中以 `--no-index --no-deps` 安装 wheel，并从源码目录外启动实际命令。验证课程、全部静态资源、完整学习流程、迁移期间禁止帮助、教师保存、研究 CLI、重启恢复和退出统计。测试仅使用临时合成数据，不读取真实学习数据库。

同时检查 wheel、tar.gz 与 zip 的清单：不含 `.data`、学习数据库、参与码、缓存、虚拟环境或凭据。文档中的 `synthetic-study-report.json` 是明确标记的合成汇总，允许随源码分发。人工检查 README 和演示是否准确说明当前能力与局限。

CI 已配置 Ubuntu / Python 3.11 与 3.13，以及 macOS、Windows / Python 3.13，运行核心测试、构建、元数据检查、安装流程与合成演练。Ubuntu / 3.13 作业上传候选产物，**不自动发布 release 或包注册表**。仓库创建后应以实际 Actions 结果为准。

## 公开发布仍待完成

- 确定仓库 owner、名称与公开地址，补充真实仓库链接和问题报告入口。
- 核查注册表名称及维护者权限；未经核查不要引导用户安装同名远端包。
- 首次推送后查看 CI，修复各平台失败，再创建对应版本的发布说明和校验和。
- 建立明确的维护者与私密安全问题报告方式。
- 用原创模拟内容录制演示，注明没有真实教学效应结论；社区沟通需明确授权。

1000 stars 是社区目标，不能由构建成功推导。优先验证教师能独立接入课程、学生能完成 tutorial，以及外部贡献者能复现并修复问题。
