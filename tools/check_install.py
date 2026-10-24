"""在全新虚拟环境、源码目录之外验证 wheel 的真实安装与 HTTP 流程。"""
import argparse
import json
import os
from pathlib import Path
import queue
import re
import subprocess
import tempfile
import threading
import time
import venv
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def wait_for_server(process, timeout=60):
    """等待实际就绪输出；同时排空两条管道，区分提前退出与仍未就绪。"""
    messages=queue.Queue()
    def read(stream):
        for line in stream:
            messages.put(line.rstrip())
        messages.put(None)
    for stream in (process.stdout,process.stderr):
        threading.Thread(target=read,args=(stream,),daemon=True).start()
    deadline=time.monotonic()+timeout
    recent=[];closed=0
    while time.monotonic()<deadline:
        try:line=messages.get(timeout=min(.2,max(.001,deadline-time.monotonic())))
        except queue.Empty:continue
        if line is None:
            closed+=1
            if closed==2:
                process.wait(timeout=5)
                raise RuntimeError(f'安装版服务器提前退出（exit={process.returncode}）：'+ '\n'.join(recent))
            continue
        recent=(recent+[line])[-10:]
        match=re.search(r'^CausalTA：http://127\.0\.0\.1:\d+',line)
        if match:return match.group().split('：',1)[1]
    raise RuntimeError(f'安装版服务器在 {timeout} 秒内未报告就绪（exit={process.poll()}）：'+ '\n'.join(recent))


def main():
    parser=argparse.ArgumentParser(description='验证 wheel 的离线安装、课程/静态资源、教师保存和研究恢复')
    parser.add_argument('wheel',type=Path)
    args=parser.parse_args()
    wheel=args.wheel.resolve()
    if not wheel.is_file() or wheel.suffix!='.whl':parser.error('需要存在的 wheel 文件')
    with tempfile.TemporaryDirectory(prefix='causal-ta-install-') as folder:
        root=Path(folder);env_dir=root/'venv';work=root/'work';work.mkdir()
        venv.EnvBuilder(with_pip=True).create(env_dir)
        scripts=env_dir/('Scripts' if os.name=='nt' else 'bin')
        python=scripts/('python.exe' if os.name=='nt' else 'python')
        suffix='.exe' if os.name=='nt' else ''
        app=scripts/('causal-ta'+suffix)
        study=scripts/('causal-ta-study'+suffix)
        validate=scripts/('causal-ta-validate'+suffix)
        env={k:v for k,v in os.environ.items() if k not in ('PYTHONPATH','PYTHONHOME','CAUSALTA_DATA_DIR')}
        env['CAUSALTA_DATA_DIR']=str(work/'environment-default')
        env['PYTHONUTF8']='1'
        def run(command):
            result=subprocess.run([str(c) for c in command],cwd=work,env=env,text=True,encoding='utf-8',capture_output=True,timeout=90)
            if result.returncode:raise RuntimeError(result.stdout+result.stderr)
            return result.stdout
        run([python,'-m','pip','install','--no-index','--no-deps',wheel])
        info=json.loads(run([python,'-c','import json,causal_ta; from causal_ta.paths import default_data_dir; print(json.dumps({"module":causal_ta.__file__,"version":causal_ta.__version__,"data":str(default_data_dir())}))']))
        if not Path(info['module']).resolve().is_relative_to(env_dir.resolve()):raise RuntimeError('错误：导入了环境外源码')
        if Path(info['data']).resolve()!=(work/'environment-default').resolve():raise RuntimeError('数据目录环境变量未生效')
        for command in (app,study,validate):
            if run([command,'--version']).strip()!=info['version']:raise RuntimeError('命令版本不一致')
        if run([python,'-m','causal_ta','--version']).strip()!=info['version']:raise RuntimeError('模块入口版本不一致')
        run([validate])
        data=work/'explicit-data'
        def start():
            process=subprocess.Popen([str(app),'--port','0','--data-dir',str(data),'--authoring','--studies'],cwd=work,env=env,text=True,encoding='utf-8',stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            try:
                return process,wait_for_server(process)
            except BaseException:
                stop(process);raise
        def stop(process):
            process.terminate()
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
            process.stdout.close();process.stderr.close()
        def request(base,path,body=None):
            req=Request(base+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json'})
            with urlopen(req,timeout=5) as response:return json.load(response)
        process,base=start()
        try:
            for path,marker in [('/','CausalTA'),('/teach','教师工作台'),('/app.js','renderCatalog'),('/author.js','applyRaw'),('/style.css',':root')]:
                with urlopen(base+path,timeout=5) as response:
                    if marker not in response.read().decode():raise RuntimeError('缺少静态资源：'+path)
            courses=request(base,'/api/courses')
            if len(courses)!=6:raise RuntimeError('安装包缺少内置课程')
            course=request(base,'/api/authoring/templates/linear-functions')
            session=request(base,'/api/start',{'course':'linear-functions'})
            sid=session['id']
            evidence=request(base,'/api/experiment',{'id':sid,'action':'observe-zero','prediction':0})
            request(base,'/api/diagnose',{'id':sid,'values':evidence['candidates'][0]})
            try:request(base,'/api/tutor',{'id':sid,'message':'test'})
            except HTTPError as exc:
                if exc.code!=400:raise
            else:raise RuntimeError('迁移阶段意外允许提示')
            for question in course['transfer']:session=request(base,'/api/transfer',{'id':sid,'answer':question['answer']})
            if session['stage']!='complete':raise RuntimeError('安装版学习流程未完成')
            course['id']='installed-linear';course['title']='安装测试课程'
            checked=request(base,'/api/authoring/validate',{'course':course})
            request(base,'/api/authoring/save',{'course':course,'version':checked['version']})
            run([study,'--data-dir',data,'create','--id','installed-study','--course','installed-linear','--title','安装演练','--purpose','验证安装后的完整流程','--contact','开发演练','--synthetic'])
            code=json.loads(run([study,'--data-dir',data,'invite','--id','installed-study']))['codes'][0]
            enrolled=request(base,'/api/study/join',{'code':code,'consent':True})
        finally:stop(process)
        process,base=start()
        try:
            restored=request(base,'/api/sessions/'+sid)
            if restored['stage']!='complete':raise RuntimeError('重启后学习进度丢失')
            again=request(base,'/api/study/join',{'code':code,'consent':True})
            if again['id']!=enrolled['id'] or again['study_assignment']!=enrolled['study_assignment']:raise RuntimeError('重启后研究分配改变')
            request(base,'/api/forget',{'id':again['id']})
            report=json.loads(run([study,'--data-dir',data,'report','--id','installed-study']))
            if sum(group['withdrawn'] for group in report['groups'].values())!=1:raise RuntimeError('退出未计入报告')
        finally:stop(process)
        if not (data/'sessions.sqlite3').is_file() or not (data/'courses'/'installed-linear.json').is_file():raise RuntimeError('数据未写入显式指定目录')
        if (work/'environment-default').exists():raise RuntimeError('--data-dir 没有覆盖环境变量')
        print(f'安装验证通过：{wheel.name}；6 门课程、静态资源、完整学习、教师保存、研究 CLI 与重启恢复。')


if __name__=='__main__':main()
