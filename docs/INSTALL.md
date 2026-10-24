# 安装与迁移

需要 Python 3.11 或更新版本，以及现代浏览器。应用没有第三方运行依赖；联网 TA 是可选功能。当前仅提供本地构建产物，尚未上传 PyPI，不要把 `pip install causal-ta` 当成已验证的官方安装命令。

## 直接运行源码

解压独立源码包，在含 `pyproject.toml` 的目录中执行：

```bash
python3 --version
python3 -m causal_ta
```

请先确认显示的 Python 版本至少为 3.11；某些系统的 `python3` 仍指向旧版。也可明确使用已安装的 `python3.13`。Windows 可用 `py -3 --version` 和 `py -3 -m causal_ta`。启动后打开终端显示的本地 URL。

原有 `python3 -m causal_ta.server` 仍有效。源码模式不需要先运行 pip。

## 安装 wheel

下载与本版本对应的 `.whl` 文件，在独立虚拟环境中安装。macOS / Linux 示例：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install --no-index --no-deps ./causal_ta-0.5.0a1-py3-none-any.whl
.venv/bin/causal-ta --version
.venv/bin/causal-ta
```

Windows PowerShell 示例：

```powershell
py -3 -m venv .venv
.venv\Scripts\python.exe -m pip install --no-index --no-deps .\causal_ta-0.5.0a1-py3-none-any.whl
.venv\Scripts\causal-ta.exe --version
.venv\Scripts\causal-ta.exe
```

将文件路径换成实际下载位置。安装此 wheel 不需要网络；新建虚拟环境需要本机 Python 含 pip/ensurepip。操作系统的 Python 发行版可能需要单独提供 venv 支持。

三个命令分别是：

| 命令 | 用途 | 等价模块入口 |
|---|---|---|
| `causal-ta` | 学习服务；支持 `--authoring`、`--studies` | `python -m causal_ta` |
| `causal-ta-validate` | 校验内置课程或指定 JSON 文件 | `python -m causal_ta.validate` |
| `causal-ta-study` | 本机研究协议、参与码和报告 | `python -m causal_ta.study` |

以上命令均支持 `--version`。服务仍只监听 `127.0.0.1`，安装包不提供公网部署能力。

## 数据目录

学习数据与安装文件分开，优先级如下：

1. 命令行 `--data-dir`。
2. 环境变量 `CAUSALTA_DATA_DIR`。
3. 在源码/可编辑安装中，默认项目根目录 `.data/`；在普通 wheel 安装中，默认用户目录 `~/.causal-ta/`。

服务启动时打印实际数据目录。目录中含 `sessions.sqlite3` 与教师创建的 `courses/`。内置课程随包存于 `causal_ta/coursepacks/`，网页资源随包存于 `causal_ta/static/`；应用不在这些资源目录保存学习记录。

示例：`causal-ta --data-dir /absolute/path/to/data --authoring`。研究 CLI 使用同一个目录：`causal-ta-study --data-dir /absolute/path/to/data report --id my-study`。

从 0.4 源码切换到安装版时，先停止旧服务，再让新服务的 `--data-dir` 指向旧项目的 `.data` 绝对路径。课程文件位置变化不改变 JSON 内容版本，已有会话快照继续保留。不要复制运行中的数据库作为唯一备份；停止服务后备份整个数据目录。

同一研究应固定应用发布版本。策略版本不匹配时会拒绝恢复，不应通过手动修改数据库绕过。卸载 Python 包不会自动删除学习数据或下载过的导出记录。

## 常见问题

- **找不到命令**：使用虚拟环境中命令的完整路径，或用该环境的 Python 执行模块入口。
- **端口被占用**：指定 `--port 8766`，不要停止不属于本项目的进程。
- **课程或静态资源缺失**：运行 `causal-ta-validate` 并检查安装版本；从完整 wheel 重新安装，避免只复制 `.py` 文件。
- **旧数据似乎消失**：查看启动时打印的数据目录，将 `--data-dir` 指向旧目录。源码模式与安装模式的默认位置不同。
- **权限错误**：为 `--data-dir` 选择当前用户可写目录；不需要管理员权限来保存学习记录。

当前本机验证环境为 macOS 与 Python 3.13.5；Linux、Windows 和 Python 3.11 已配置于 CI，未在远端执行前不声称通过。
