"""合成演练：固定分组和人为分数仅用于检查报告；不模拟或声称学生效果。"""
from pathlib import Path
import json
import sys
import tempfile
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from causal_ta.engine import load_courses
from causal_ta.server import Store
from causal_ta.study import StudyRegistry


def main():
    with tempfile.TemporaryDirectory(prefix='causal-ta-synthetic-') as folder:
        store=Store(Path(folder)/'sessions.sqlite3')
        try:
            registry=StudyRegistry(store)
            registry.create('synthetic-demo',load_courses()['linear-functions'],
                '合成数据：验证分母与缺失结果报告','预设人为分数，只检查软件计算','本机开发演练',True)
            codes=registry.invite('synthetic-demo',7)
            # 生产分配使用 secrets；这里只在明确标记 synthetic 的临时数据库演练。
            with patch('causal_ta.study.secrets.randbelow',side_effect=[0,0,0,1,1,1]):
                sessions=[registry.join(code,True) for code in codes[:6]]
            for index,correct_count in [(0,2),(1,1),(3,0),(4,1)]:
                sid,session=sessions[index]
                session.experiment('observe-zero',0);session.diagnose(session.world)
                for i,q in enumerate(session.course.data['transfer']):
                    session.answer_transfer(q['answer'] if i<correct_count else (q['answer']+1)%len(q['options']))
                store.save(sid,session)
            registry.forget(sessions[5][0])
            print(json.dumps(registry.report('synthetic-demo'),ensure_ascii=False,indent=2))
        finally:store.db.close()


if __name__=='__main__':main()
