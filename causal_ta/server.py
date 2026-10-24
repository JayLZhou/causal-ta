"""本机教学服务器；可选联网 TA 与评分器隔离，默认完全离线。"""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import secrets
import sqlite3
import threading
from urllib.parse import urlparse

from .engine import Course, Session
from .paths import STATIC_DIR, default_data_dir
from . import __version__
from .tutor import TutorService, configured_tutor
from .library import CourseLibrary
from .validate import check_data
from .study import StudyRegistry
from .learning import POLICY_VERSION


class Store:
    def __init__(self, path):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL)")
        self.db.commit()
        self.lock = threading.RLock()
        self.session_locks = {}

    def session_lock(self, sid):
        with self.lock:
            return self.session_locks.setdefault(sid, threading.RLock())

    @staticmethod
    def encode(session):
        state = {k: v for k, v in vars(session).items() if k not in ("course", "used")}
        state.update(course_id=session.course.id, used=sorted(session.used),
                     course_snapshot=session.course.data, state_version=3)
        return json.dumps(state)

    def save(self, sid, session):
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO sessions VALUES (?, ?)", (sid, self.encode(session)))
            self.db.commit()

    def get(self, sid, courses):
        with self.lock:
            row = self.db.execute("SELECT state FROM sessions WHERE id=?", (sid,)).fetchone()
        if not row:
            raise KeyError("找不到学习会话，请重新开始")
        state = json.loads(row[0])
        session = Session.__new__(Session)
        course_id = state.pop("course_id")
        snapshot = state.pop("course_snapshot", None)
        state.pop("state_version", None)
        session.course = Course(snapshot) if snapshot else courses[course_id]
        session.course_provenance = "frozen_at_start" if snapshot else "legacy_current_course_unverified"
        session.tutor_turns = []
        session.teaching_policy = 'diagnostic'
        session.policy_version = 'legacy-unrecorded'
        session.study_assignment = None
        session.__dict__.update(state)
        session.used = set(state["used"])
        if session.study_assignment and session.policy_version != POLICY_VERSION:
            raise ValueError('研究策略版本与当前程序不同，请使用原发布版本恢复')
        return session


def make_server(port=8765, db_path=None, tutor_service=None, authoring=False, course_directory=None, studies=False):
    if course_directory is None and db_path and str(db_path) != ':memory:':
        course_directory = Path(db_path).parent / 'courses'
    if authoring and course_directory is None:
        raise ValueError('教师模式需要独立的课程目录')
    courses = CourseLibrary(course_directory)
    store = Store(db_path or ":memory:")
    registry = StudyRegistry(store)
    tutor_service = tutor_service or TutorService()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # 避免把会话 token 写进终端日志。

        def reply(self, status, value, content_type="application/json; charset=utf-8"):
            payload = json.dumps(value, ensure_ascii=False).encode() if isinstance(value, (dict, list)) else value
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(payload)

        def allowed(self):
            host = self.headers.get("Host", "")
            allowed = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
            if host not in allowed:
                self.reply(403, {"error": "仅接受本机 Host"})
                return False
            origin = self.headers.get("Origin")
            if origin and origin not in {"http://" + h for h in allowed}:
                self.reply(403, {"error": "不接受跨站请求"})
                return False
            return True

        def do_GET(self):
            if not self.allowed():
                return
            path = urlparse(self.path).path
            if path == "/api/courses":
                self.reply(200, [c.public() for c in courses.values()])
            elif path == "/api/config":
                self.reply(200, {"tutor": tutor_service.public(), 'authoring': authoring, 'studies': studies})
            elif path.startswith('/api/authoring/templates/'):
                if not authoring:
                    self.reply(403, {'error':'教师模式未启用，请使用 --authoring 启动'})
                    return
                try:
                    self.reply(200, courses.template(path.rsplit('/',1)[-1]))
                except KeyError:
                    self.reply(404, {'error':'模板不存在'})
            elif path.startswith("/api/sessions/"):
                sid = path.rsplit("/", 1)[-1]
                try:
                    self.reply(200, {"id": sid, **store.get(sid, courses).view()})
                except KeyError:
                    self.reply(404, {"error": "会话不存在，请重新开始"})
                except ValueError as exc:
                    self.reply(409, {'error':str(exc)})
            elif path in ("/", "/app.js", "/style.css", '/teach', '/author.js'):
                name = {'/':'index.html','/teach':'author.html'}.get(path, path[1:])
                kind = 'text/html' if name.endswith('.html') else 'text/css' if name.endswith('.css') else 'text/javascript'
                self.reply(200, (STATIC_DIR / name).read_bytes(), kind + "; charset=utf-8")
            else:
                self.reply(404, {"error": "资源不存在"})

        def do_POST(self):
            if not self.allowed():
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 65536:
                    raise ValueError("请求大小必须为 1–65536 字节")
                data = json.loads(self.rfile.read(size))
                if not isinstance(data, dict):
                    raise ValueError("请求必须是 JSON 对象")
                path = urlparse(self.path).path
                if path in ('/api/study/info','/api/study/join'):
                    if not studies:
                        self.reply(403, {'error':'研究入口未启用'})
                        return
                    if path.endswith('/info'):
                        self.reply(200, registry.info(data.get('code')))
                    else:
                        study_sid,study_session=registry.join(data.get('code'),data.get('consent'))
                        self.reply(200, {'id':study_sid, **study_session.view()})
                    return
                if path in ('/api/authoring/validate','/api/authoring/save'):
                    if not authoring:
                        self.reply(403, {'error':'教师模式未启用，请使用 --authoring 启动'})
                        return
                    result = check_data(data.get('course'))
                    if path.endswith('/validate') or not result['ok']:
                        self.reply(200 if result['ok'] else 400, result)
                        return
                    try:
                        saved = courses.save_new(data['course'], data.get('version'))
                    except FileExistsError:
                        self.reply(409, {'error':'课程 ID 已存在，请更换 ID；已有课程不会被覆盖'})
                        return
                    self.reply(201, {'ok':True, 'course':saved})
                    return
                sid = secrets.token_urlsafe(24) if path == "/api/start" else data.get("id")
                if not isinstance(sid, str) or len(sid) > 100:
                    raise ValueError("无效会话标识")
                # 每个会话独立串行；联网等待不占用全局数据库锁。
                with store.session_lock(sid):
                    if path == '/api/forget':
                        self.reply(200, registry.forget(sid))
                        return
                    elif path == "/api/start":
                        course_id = data.get("course")
                        if not isinstance(course_id, str) or course_id not in courses:
                            raise ValueError("未知课程")
                        session = Session(courses[course_id])
                    elif path in ("/api/experiment", "/api/diagnose", "/api/transfer", "/api/check", "/api/tutor"):
                        session = store.get(sid, courses)
                        if path == "/api/experiment":
                            action = data.get("action")
                            if not isinstance(action, str):
                                raise ValueError("无效实验标识")
                            session.experiment(action, data.get("prediction"))
                        elif path == "/api/diagnose":
                            session.diagnose(data.get("values"))
                        elif path == "/api/transfer":
                            session.answer_transfer(data.get("answer"))
                        elif path == "/api/check":
                            session.check_understanding(data.get("check_id"), data.get("answer"))
                        else:
                            tutor_service.respond(session, data.get("message"), data.get("use_remote", False))
                    else:
                        self.reply(404, {"error": "接口不存在"})
                        return
                    store.save(sid, session)
                self.reply(200, {"id": sid, **session.view()})
            except (ValueError, TypeError, KeyError, RecursionError) as exc:
                self.reply(400, {"error": str(exc)})
            except OSError:
                self.reply(500, {'error':'本地保存失败，请检查数据目录权限与可用空间'})

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.store = store
    server.studies = registry
    return server


def main():
    parser = argparse.ArgumentParser(description="启动 CausalTA 本地教学实验")
    parser.add_argument('--version', action='version', version=__version__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data-dir", type=Path, default=default_data_dir())
    parser.add_argument("--tutor", choices=("offline", "openai"), default="offline")
    parser.add_argument('--authoring', action='store_true', help='启用本机教师课程创建工作台')
    parser.add_argument('--studies', action='store_true', help='启用预先建立的本机研究参与入口')
    args = parser.parse_args()
    args.data_dir.mkdir(parents=True, exist_ok=True)
    try:
        tutor = configured_tutor(args.tutor)
    except ValueError as exc:
        parser.error(str(exc))
    server = make_server(args.port, args.data_dir / "sessions.sqlite3", tutor, authoring=args.authoring, studies=args.studies)
    print(f"CausalTA：http://127.0.0.1:{server.server_port}（Ctrl+C 停止）", flush=True)
    print(f"本机数据：{args.data_dir.resolve()}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        server.store.db.close()


if __name__ == "__main__":
    main()
