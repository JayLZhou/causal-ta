"""可信的小型领域检查器；运行内置算法，不执行课程或学生提供的代码。"""
from math import isfinite


def finite_number(value):
    return type(value) in (int, float) and abs(value) <= 1e6 and isfinite(value)


def loop_sum(start, inclusive, stop):
    if type(start) is not int or start not in (0, 1) or type(inclusive) is not int or inclusive not in (0, 1):
        raise ValueError('loop_sum: start 与 inclusive 必须为整数 0 或 1')
    if type(stop) is not int or not 0 <= stop <= 1000:
        raise ValueError('loop_sum: stop 必须为 0–1000 的整数')
    return sum(range(start, stop + inclusive))


def binary_search(closed, advance, values, target):
    """返回索引；-1 为未找到；-2 为状态重复。边界统一为闭区间 [low, high]。"""
    if type(closed) is not int or closed not in (0, 1) or type(advance) is not int or advance not in (0, 1):
        raise ValueError('binary_search: closed 与 advance 必须为整数 0 或 1')
    if not isinstance(values, list) or len(values) > 32 or not all(finite_number(v) for v in values):
        raise ValueError('binary_search: values 最多包含 32 个有限数值')
    if values != sorted(set(values)) or not finite_number(target):
        raise ValueError('binary_search: 数组需要严格递增，target 需要有限数值')
    low, high, seen = 0, len(values) - 1, set()
    while low <= high if closed else low < high:
        if (low, high) in seen:
            return -2
        seen.add((low, high))
        mid = (low + high) // 2
        if values[mid] == target:
            return mid
        if values[mid] < target:
            low = mid + advance
        else:
            high = mid - 1
    return -1


OPERATIONS = {'all': (1, 16), 'add': (1, 16), 'mul': (1, 16), 'div': (2, 2),
              'loop_sum': (3, 3), 'binary_search': (4, 4), 'loop_count': (3, 3)}


def validate_expression(expr, names, path, depth=0, budget=None):
    budget = [0] if budget is None else budget
    budget[0] += 1
    if depth > 20 or budget[0] > 256:
        raise ValueError(path + ': 表达式最多 20 层、256 个节点')
    if finite_number(expr) or type(expr) is bool:
        return
    if isinstance(expr, str):
        if expr not in names:
            raise ValueError(path + ': 未知变量 ' + expr)
        return
    if not isinstance(expr, list) or not expr or not isinstance(expr[0], str) or expr[0] not in OPERATIONS:
        raise ValueError(path + ': 未知或无效的表达式操作')
    minimum, maximum = OPERATIONS[expr[0]]
    if not minimum <= len(expr)-1 <= maximum:
        raise ValueError(path + ': 操作参数数量无效')
    for index, child in enumerate(expr[1:]):
        validate_expression(child, names, f'{path}[{index+1}]', depth+1, budget)


def evaluate(expr, world):
    if isinstance(expr, (int, float, bool)):
        return expr
    if isinstance(expr, str):
        return world[expr]
    op, args = expr[0], [evaluate(v, world) for v in expr[1:]]
    if op == 'all':
        return int(all(args))
    if op == 'add':
        return sum(args)
    if op == 'mul':
        result = 1
        for value in args:
            result *= value
        return result
    if op == 'div':
        if args[1] == 0:
            raise ValueError('div: 分母为 0')
        return args[0] / args[1]
    if op == 'loop_sum':
        return loop_sum(*args)
    if op == 'loop_count':
        loop_sum(*args)  # 共用整数边界校验。
        start, inclusive, stop = args
        return len(range(start, stop + inclusive))
    if op == 'binary_search':
        return binary_search(*args)
    raise ValueError('不支持的表达式操作')
