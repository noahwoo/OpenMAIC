/* Course data, never code: only this bundled interpreter can execute expressions. */
const OPS = {
  add: 2,
  sub: 2,
  mul: 2,
  div: 2,
  pow: 2,
  min: 2,
  max: 2,
  sin: 1,
  cos: 1,
  sqrt: 1,
  abs: 1,
};
const ID = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
function bounded(value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error('数值越界');
  return value;
}
function text(value, max) {
  if (typeof value !== 'string' || value.length > max) throw new Error('文字格式无效');
}
function expression(expr, names, depth = 0, budget = { count: 0 }) {
  if (depth > 8 || ++budget.count > 128) throw new Error('计算表达式过于复杂');
  if (typeof expr === 'number') return bounded(expr, -1e12, 1e12);
  if (!expr || typeof expr !== 'object' || Array.isArray(expr)) throw new Error('无效计算表达式');
  if (Object.keys(expr).length === 1 && typeof expr.var === 'string' && names.includes(expr.var))
    return;
  if (
    !Object.prototype.hasOwnProperty.call(OPS, expr.op) ||
    Object.keys(expr).some((k) => !['op', 'args'].includes(k)) ||
    !Array.isArray(expr.args) ||
    expr.args.length !== OPS[expr.op]
  )
    throw new Error('不允许的计算操作');
  expr.args.forEach((arg) => expression(arg, names, depth + 1, budget));
}
function validateSpec(spec) {
  if (!spec || spec.version !== 1) throw new Error('不支持的原生课程版本');
  if (JSON.stringify(spec).length > 120000) throw new Error('原生课程过大');
  if (spec.status === 'unsupported') {
    text(spec.reason, 1000);
    return spec;
  }
  if (spec.status !== 'ready') throw new Error('原生课程状态无效');
  text(spec.title, 160);
  text(spec.summary, 2000);
  for (const [key, max] of [
    ['parameters', 8],
    ['outputs', 12],
    ['elements', 40],
    ['steps', 16],
  ])
    if (!Array.isArray(spec[key]) || spec[key].length > max)
      throw new Error('无效课程集合：' + key);
  const ids = new Set(['time']);
  function id(value) {
    if (
      typeof value !== 'string' ||
      !ID.test(value) ||
      ['constructor', 'prototype'].includes(value) ||
      ids.has(value)
    )
      throw new Error('重复或无效标识');
    ids.add(value);
  }
  spec.parameters.forEach((p) => {
    id(p.id);
    text(p.label, 80);
    text(p.unit || '', 30);
    bounded(p.min, -1e6, 1e6);
    bounded(p.max, p.min + 0.000001, 1e6);
    bounded(p.step, 0.000001, p.max - p.min);
    bounded(p.value, p.min, p.max);
  });
  const inputs = spec.parameters.map((p) => p.id).concat('time');
  spec.outputs.forEach((o) => {
    id(o.id);
    text(o.label, 80);
    text(o.unit || '', 30);
    expression(o.expression, inputs);
  });
  const names = inputs.concat(spec.outputs.map((o) => o.id));
  spec.elements.forEach((e) => {
    id(e.id);
    if (!['circle', 'rect', 'line', 'label', 'bar'].includes(e.type))
      throw new Error('无效绘图类型');
    if (!COLOR.test(e.color)) throw new Error('无效颜色');
    for (const key of ['x', 'y']) expression(e[key], names);
    if (e.type === 'circle') expression(e.radius, names);
    if (['rect', 'bar'].includes(e.type)) {
      expression(e.width, names);
      expression(e.height, names);
    }
    if (e.type === 'line') {
      expression(e.endX, names);
      expression(e.endY, names);
    }
    if (e.type === 'label') text(e.text, 100);
  });
  spec.steps.forEach((step) => {
    text(step.title, 120);
    text(step.description, 2000);
    if (!step.values || typeof step.values !== 'object' || Array.isArray(step.values))
      throw new Error('无效步骤参数');
    for (const [key, value] of Object.entries(step.values)) {
      const p = spec.parameters.find((p) => p.id === key);
      if (!p) throw new Error('未知步骤参数');
      bounded(value, p.min, p.max);
    }
  });
  return spec;
}
function evaluate(expr, values, depth = 0) {
  if (depth > 8) throw new Error('表达式过深');
  if (typeof expr === 'number') return bounded(expr, -1e12, 1e12);
  if (expr && Object.prototype.hasOwnProperty.call(expr, 'var')) {
    const n = values[expr.var];
    if (
      !Object.prototype.hasOwnProperty.call(values, expr.var) ||
      typeof n !== 'number' ||
      !Number.isFinite(n)
    )
      throw new Error('未知变量');
    return n;
  }
  if (
    !expr ||
    !Object.prototype.hasOwnProperty.call(OPS, expr.op) ||
    !Array.isArray(expr.args) ||
    expr.args.length !== OPS[expr.op]
  )
    throw new Error('不允许的操作');
  const a = expr.args.map((e) => evaluate(e, values, depth + 1));
  let result;
  switch (expr.op) {
    case 'add':
      result = a[0] + a[1];
      break;
    case 'sub':
      result = a[0] - a[1];
      break;
    case 'mul':
      result = a[0] * a[1];
      break;
    case 'div':
      result = a[0] / a[1];
      break;
    case 'pow':
      result = Math.pow(a[0], a[1]);
      break;
    case 'min':
      result = Math.min(...a);
      break;
    case 'max':
      result = Math.max(...a);
      break;
    case 'sin':
      result = Math.sin(a[0]);
      break;
    case 'cos':
      result = Math.cos(a[0]);
      break;
    case 'sqrt':
      result = Math.sqrt(a[0]);
      break;
    case 'abs':
      result = Math.abs(a[0]);
      break;
  }
  if (!Number.isFinite(result) || Math.abs(result) > 1e12)
    throw new Error('计算结果无定义或超出范围');
  return result;
}
function calculate(spec, input, time = 0) {
  const values = { time: Math.max(0, Math.min(3600, time)) };
  const parameters = spec.parameters.map((p) => {
    const n = input[p.id] === undefined ? p.value : Number(input[p.id]);
    const value = bounded(n, p.min, p.max);
    values[p.id] = value;
    return Object.assign({}, p, {
      value,
      percent: Math.round(((value - p.min) / (p.max - p.min)) * 1000),
    });
  });
  const outputs = spec.outputs.map((o) => {
    const value = evaluate(o.expression, values);
    values[o.id] = value;
    return Object.assign({}, o, { value, display: String(Number(value.toFixed(4))) });
  });
  return { parameters, outputs, values };
}
module.exports = { validateSpec, evaluate, calculate, expression, bounded };
