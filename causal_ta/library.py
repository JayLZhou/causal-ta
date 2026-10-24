"""课程库：内置课程只读，教师课程经校验后原子保存为新文件。"""
from copy import deepcopy
import json
import os
from pathlib import Path
import tempfile
import threading

from .engine import Course, load_courses
from .validate import describe_course


class CourseLibrary:
    def __init__(self, custom_directory=None):
        self.lock = threading.RLock()
        self.directory = Path(custom_directory) if custom_directory is not None else None
        self.courses = load_courses()
        if self.directory:
            for course_id, course in load_courses(self.directory).items():
                if course_id in self.courses:
                    raise ValueError(f'自定义课程 id 与内置课程重复：{course_id}')
                describe_course(course)
                self.courses[course_id] = course

    def __getitem__(self, course_id):
        with self.lock:
            return self.courses[course_id]

    def __contains__(self, course_id):
        with self.lock:
            return course_id in self.courses

    def values(self):
        with self.lock:
            return tuple(self.courses.values())

    def template(self, course_id):
        return deepcopy(self[course_id].data)

    def save_new(self, data, expected_version):
        if self.directory is None:
            raise ValueError('尚未设置教师课程目录')
        course = Course(data)
        describe_course(course)
        if expected_version != course.version:
            raise ValueError('课程在校验后发生变化，请重新校验再保存')
        with self.lock:
            if course.id in self.courses:
                raise FileExistsError('课程 ID 已存在；请换一个 ID 创建新版本，不覆盖已有课程')
            self.directory.mkdir(parents=True, exist_ok=True)
            target = self.directory / (course.id + '.json')
            temp_path = None
            try:
                with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=self.directory, suffix='.tmp', delete=False) as stream:
                    temp_path = Path(stream.name)
                    json.dump(course.data, stream, ensure_ascii=False, indent=2, allow_nan=False)
                    stream.write('\n')
                    stream.flush()
                    os.fsync(stream.fileno())
                # 同一目录内原子创建；若另一进程已创建目标，拒绝覆盖。
                os.link(temp_path, target)
                self.courses[course.id] = course
            finally:
                if temp_path is not None:
                    temp_path.unlink(missing_ok=True)
        return course.public()
