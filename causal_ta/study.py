"""本机两组教学策略研究：预设协议、参与码随机分配与完整分母报告。"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import secrets

from .engine import Course, Session
from .paths import default_data_dir
from . import __version__
from .learning import POLICIES, POLICY_VERSION
from .validate import describe_course

CONSENT = ('参与是自愿的，不影响普通练习。两种策略以各 50% 的概率分配；同一参与码只有一次学习会话。'
           '记录课程版本、分组、答题、实验、离线对话与迁移表现，仅保存在本机。'
           '请勿输入姓名或身份信息。可以随时停止，或删除学习记录并退出；退出后保留分组与退出计数，'
           '用于如实报告缺失结果，参与码失效。报告不导出对话或参与码。此工具不是防作弊或身份认证系统。')


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(code):
    if not isinstance(code, str) or not re.fullmatch(r'[a-f0-9]{32}', code):
        raise ValueError('参与码无效')
    return hashlib.sha256(code.encode()).hexdigest()


class StudyRegistry:
    def __init__(self, store):
        self.store = store
        with store.lock, store.db:
            store.db.execute('CREATE TABLE IF NOT EXISTS studies (id TEXT PRIMARY KEY, config TEXT NOT NULL, closed INTEGER NOT NULL DEFAULT 0)')
            store.db.execute('''CREATE TABLE IF NOT EXISTS enrollments (
                token_hash TEXT PRIMARY KEY, study_id TEXT NOT NULL, session_id TEXT UNIQUE,
                arm TEXT, assigned_at TEXT, withdrawn INTEGER NOT NULL DEFAULT 0)''')

    def create(self, study_id, course, title, purpose, contact, synthetic=False):
        if not isinstance(study_id, str) or not re.fullmatch(r'[a-z][a-z0-9-]{2,63}', study_id):
            raise ValueError('研究 ID 需要 3–64 位小写字母、数字或连字符，字母开头')
        for name, value in [('标题',title),('目的',purpose),('联系人或本机负责人',contact)]:
            if not isinstance(value,str) or not 1 <= len(value.strip()) <= 2000:
                raise ValueError(name+'需要 1–2000 字的文本')
        describe_course(course)
        if not course.data.get('pedagogy',{}).get('checks'):
            raise ValueError('研究课程需要理解检查')
        config = {'id':study_id, 'title':title, 'purpose':purpose, 'contact':contact,
                  'created_at':now(), 'data_kind':'synthetic' if synthetic else 'human',
                  'course_snapshot':course.data, 'course_version':course.version,
                  'policy_version':POLICY_VERSION, 'arms':{'diagnostic':.5,'fixed':.5},
                  'unit':'每个参与码；负责人须保证每人仅领一个码', 'consent':CONSENT,
                  'outcome':'第一次学习会话全部独立迁移题的首次作答正确比例；未全部完成记为缺失',
                  'analysis':'按最初分配组报告全部已分配参与码、完整结果、未完成和退出；缺失结果取 [0,1] 给出均值差界限，不将其当置信区间',
                  'tutor':'offline', 'application_version':__import__('causal_ta').__version__}
        with self.store.lock, self.store.db:
            if self.store.db.execute('SELECT 1 FROM studies WHERE id=?',(study_id,)).fetchone():
                raise ValueError('研究 ID 已存在；协议不可覆盖，请使用新 ID')
            self.store.db.execute('INSERT INTO studies(id,config) VALUES (?,?)',(study_id,json.dumps(config,ensure_ascii=False)))
        return self.public(config)

    def config(self, study_id):
        row=self.store.db.execute('SELECT config,closed FROM studies WHERE id=?',(study_id,)).fetchone()
        if not row: raise ValueError('研究不存在')
        return json.loads(row[0]), bool(row[1])

    @staticmethod
    def public(config):
        return {**{k:v for k,v in config.items() if k != 'course_snapshot'},
                'course_title':config['course_snapshot']['title'],
                'arm_labels':POLICIES}

    def invite(self, study_id, count):
        if type(count) is not int or not 1 <= count <= 1000: raise ValueError('每批参与码数量为 1–1000')
        with self.store.lock, self.store.db:
            _,closed=self.config(study_id)
            if closed: raise ValueError('研究已停止接收新参与者')
            codes=[secrets.token_hex(16) for _ in range(count)]
            self.store.db.executemany('INSERT INTO enrollments(token_hash,study_id) VALUES (?,?)',[(digest(c),study_id) for c in codes])
        return codes

    def info(self, code):
        with self.store.lock:
            row=self.store.db.execute('SELECT study_id,withdrawn FROM enrollments WHERE token_hash=?',(digest(code),)).fetchone()
            if not row or row[1]: raise ValueError('参与码无效或已退出')
            config,closed=self.config(row[0])
            return {**self.public(config),'closed':closed}

    def join(self, code, consent):
        if consent is not True: raise ValueError('请先阅读说明并自愿同意参与')
        # BEGIN IMMEDIATE 跨进程串行分配；会话与分组在同一个事务中提交。
        with self.store.lock, self.store.db:
            self.store.db.execute('BEGIN IMMEDIATE')
            row=self.store.db.execute('SELECT study_id,session_id,withdrawn FROM enrollments WHERE token_hash=?',(digest(code),)).fetchone()
            if not row or row[2]: raise ValueError('参与码无效或已退出')
            config,closed=self.config(row[0])
            if config['policy_version'] != POLICY_VERSION: raise ValueError('策略版本已变化，请使用原发布版本恢复或建立新研究')
            if row[1]: return row[1],self.store.get(row[1],{})
            if closed: raise ValueError('研究已停止接收新参与者')
            arm = ('diagnostic','fixed')[secrets.randbelow(2)]
            session=Session(Course(config['course_snapshot']),policy=arm)
            sid=secrets.token_urlsafe(24)
            session.study_assignment={'study_id':config['id'], 'title':config['title'],
                'data_kind':config['data_kind'], 'arm':arm, 'probability':.5,
                'assigned_at':now(), 'policy_version':POLICY_VERSION, 'course_version':config['course_version'],
                'unit':config['unit'], 'consent_version':'1', 'tutor':'offline'}
            self.store.db.execute('INSERT INTO sessions(id,state) VALUES (?,?)',(sid,self.store.encode(session)))
            self.store.db.execute('UPDATE enrollments SET session_id=?,arm=?,assigned_at=? WHERE token_hash=?',
                (sid,arm,session.study_assignment['assigned_at'],digest(code)))
            return sid,session

    def forget(self, sid):
        with self.store.lock,self.store.db:
            # 保留最小分组/退出计数；解除 token 与学习内容的关联，禁止再次分配。
            row=self.store.db.execute('SELECT token_hash FROM enrollments WHERE session_id=?',(sid,)).fetchone()
            if row:
                self.store.db.execute('UPDATE enrollments SET session_id=NULL,withdrawn=1 WHERE session_id=?',(sid,))
            deleted=self.store.db.execute('DELETE FROM sessions WHERE id=?',(sid,)).rowcount
            if not deleted: raise ValueError('学习记录不存在或已删除')
        return {'ok':True,'withdrawn':bool(row)}

    def close(self, study_id):
        with self.store.lock,self.store.db:
            self.config(study_id)
            self.store.db.execute('UPDATE studies SET closed=1 WHERE id=?',(study_id,))

    def report(self, study_id):
        with self.store.lock:
            config,closed=self.config(study_id)
            rows=self.store.db.execute('''SELECT e.arm,e.withdrawn,s.state FROM enrollments e
                LEFT JOIN sessions s ON e.session_id=s.id WHERE e.study_id=?''',(study_id,)).fetchall()
        groups={arm:{'assigned':0,'complete':0,'incomplete':0,'withdrawn':0,'sum_score':0.0} for arm in POLICIES}
        unused=0
        for arm,withdrawn,raw in rows:
            if arm is None: unused+=1; continue
            group=groups[arm];group['assigned']+=1
            if withdrawn: group['withdrawn']+=1; continue
            if raw is None: raise ValueError('数据完整性错误：已分配会话丢失，且未标记退出')
            state=json.loads(raw)
            assignment=state.get('study_assignment') or {}
            snapshot_version=hashlib.sha256(json.dumps(state.get('course_snapshot'),sort_keys=True,ensure_ascii=False).encode()).hexdigest()
            if (assignment.get('arm')!=arm or assignment.get('study_id')!=study_id
                or assignment.get('course_version')!=config['course_version'] or snapshot_version!=config['course_version']
                or state.get('teaching_policy')!=arm or state.get('policy_version')!=config['policy_version']):
                raise ValueError('数据完整性错误：课程或策略分组不一致')
            if state.get('stage')!='complete': group['incomplete']+=1; continue
            results=state['transfer_results']
            if len(results)!=len(config['course_snapshot']['transfer']) or not all(type(r.get('correct')) is bool for r in results):
                raise ValueError('数据完整性错误：迁移成绩不完整')
            for result,question in zip(results,config['course_snapshot']['transfer']):
                answer=result.get('answer')
                if type(answer) is not int or not 0<=answer<len(question['options']) or result['correct']!=(answer==question['answer']):
                    raise ValueError('数据完整性错误：迁移评分与固定题目不一致')
            group['complete']+=1;group['sum_score']+=sum(r['correct'] for r in results)/len(results)
        for group in groups.values():
            n,k,total=group['assigned'],group['complete'],group.pop('sum_score')
            group['observed_mean']=total/k if k else None
            group['missing']=n-k
            group['mean_bounds']=[total/n,(total+n-k)/n] if n else None
        treated,control=groups['diagnostic'],groups['fixed']
        bounds=None
        if treated['assigned'] and control['assigned']:
            bounds=[treated['mean_bounds'][0]-control['mean_bounds'][1],treated['mean_bounds'][1]-control['mean_bounds'][0]]
        observed=None
        if treated['complete'] and control['complete']:
            observed=treated['observed_mean']-control['observed_mean']
        complete_contrast=observed if bounds and not treated['missing'] and not control['missing'] else None
        return {'schema_version':1,'protocol':self.public(config),'closed':closed,'unused_invites':unused,
                'groups':groups,'observed_completer_difference':observed,
                'all_assigned_mean_difference':complete_contrast,'missing_outcome_difference_bounds':bounds,
                'note':'诊断组减固定组。完成者差值仅作描述；缺失值界限不是置信区间，没有处理抽样不确定性、重复身份或班级聚类。合成数据只能验证软件，不能证明教学效果。'}


def main(argv=None):
    parser=argparse.ArgumentParser(description='本机教学策略研究；创建协议、生成参与码与导出汇总')
    parser.add_argument('--version',action='version',version=__version__)
    parser.add_argument('--data-dir',type=Path,default=default_data_dir())
    sub=parser.add_subparsers(dest='command',required=True)
    create=sub.add_parser('create');create.add_argument('--id',required=True);create.add_argument('--course',required=True)
    for field in ('title','purpose','contact'):create.add_argument('--'+field,required=True)
    create.add_argument('--synthetic',action='store_true',help='标记为软件演练，不能混入真实参与者')
    invite=sub.add_parser('invite');invite.add_argument('--id',required=True);invite.add_argument('--count',type=int,default=1)
    for command in ('report','close'):
        item=sub.add_parser(command);item.add_argument('--id',required=True)
    args=parser.parse_args(argv)
    args.data_dir.mkdir(parents=True,exist_ok=True)
    from .server import Store
    from .library import CourseLibrary
    store=Store(args.data_dir/'sessions.sqlite3');registry=StudyRegistry(store)
    try:
        if args.command=='create':
            course=CourseLibrary(args.data_dir/'courses')[args.course]
            value=registry.create(args.id,course,args.title,args.purpose,args.contact,args.synthetic)
        elif args.command=='invite':value={'codes':registry.invite(args.id,args.count),'notice':'参与码可恢复同一会话，请私下交给对应参与者；不要公开分享。'}
        elif args.command=='close':registry.close(args.id);value={'closed':True}
        else:value=registry.report(args.id)
        print(json.dumps(value,ensure_ascii=False,indent=2))
    except (ValueError,KeyError) as exc:parser.error(str(exc))
    finally:store.db.close()


if __name__=='__main__':main()
