const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const specModule = require('../miniprogram/utils/native-spec');
const draw = require('../miniprogram/utils/native-draw');
function spec() {
  return {
    version: 1,
    status: 'ready',
    title: '牛顿第二定律',
    summary: '改变质量观察力',
    parameters: [{ id: 'mass', label: '质量', min: 1, max: 10, step: 1, value: 2 }],
    outputs: [
      { id: 'force', label: '力', expression: { op: 'mul', args: [{ var: 'mass' }, 9.8] } },
    ],
    elements: [
      { id: 'ball', type: 'circle', x: 160, y: 120, radius: { var: 'mass' }, color: '#6366f1' },
    ],
    steps: [
      { title: '小质量', description: '观察', values: { mass: 2 } },
      { title: '大质量', description: '比较', values: { mass: 8 } },
    ],
  };
}
function make(request) {
  let definition;
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../miniprogram/pages/activity/index.js'), 'utf8'),
    {
      require(name) {
        return name.endsWith('/api')
          ? { api: () => ({ request }) }
          : name.endsWith('native-spec')
            ? specModule
            : draw;
      },
      Page(v) {
        definition = v;
      },
      setInterval,
      clearInterval,
      Date,
    },
  );
  return Object.assign({}, definition, {
    stageId: 'stage',
    sceneId: 'scene',
    epoch: 0,
    inputs: {},
    time: 0,
    data: { ...definition.data },
    setData(v) {
      Object.assign(this.data, v);
    },
  });
}
test('native simulation uses validated data and changes calculated outputs', async () => {
  const calls = [];
  const page = make(async (...args) => {
    calls.push(args);
    return args[1] === 'POST'
      ? { type: 'simulation', spec: spec() }
      : { type: 'simulation', needsGeneration: true };
  });
  await page.load();
  assert.equal(calls[1][2].action, 'generate');
  assert.equal(page.data.outputs[0].value, 19.6);
  page.parameter({ currentTarget: { dataset: { id: 'mass' } }, detail: { value: 1000 } });
  assert.equal(page.data.outputs[0].value, 98);
  page.step({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(page.data.outputs[0].value, 19.6);
});
test('DSL rejects executable expressions, reserved identifiers and unbounded arithmetic', () => {
  for (const bad of [
    '(()=>process.exit())()',
    { op: 'eval', args: ['1'] },
    { var: 'constructor' },
  ]) {
    const s = spec();
    s.outputs[0].expression = bad;
    assert.throws(() => specModule.validateSpec(s));
  }
  const s = spec();
  s.parameters[0].id = 'time';
  assert.throws(() => specModule.validateSpec(s));
  assert.throws(() => specModule.evaluate({ op: 'div', args: [1, 0] }, {}));
});
test('late response cannot mutate an unloaded native page', async () => {
  let resolve;
  const page = make(() => new Promise((r) => (resolve = r)));
  const loading = page.load();
  page.onUnload();
  resolve({ type: 'simulation', spec: spec() });
  await loading;
  assert.equal(page.data.type, '');
});
test('PBL posts only a command, input and server revision, refreshes on conflict', async () => {
  const calls = [];
  const page = make(async (...a) => {
    calls.push(a);
    if (a[1] === 'POST') throw new Error('进度已变化');
    return { type: 'pbl', revision: 'new' };
  });
  page.data.pbl = { revision: 'old' };
  page.data.draft = '我的回答';
  await page.command({ currentTarget: { dataset: { action: 'message' } } });
  assert.equal(calls[0][2].revision, 'old');
  assert.equal(calls[0][2].project, undefined);
  assert.equal(page.data.pbl.revision, 'new');
  assert.equal(page.data.draft, '我的回答');
  assert.equal(page.data.busy, false);
});
test('whiteboard deterministically replays deletion, clear and narration', () => {
  const f = draw.boardFrames([
    { id: '1', type: 'wb_draw_text', elementId: 'text', content: 'hello', x: 10, y: 10 },
    { id: '2', type: 'speech', text: '讲解' },
    { id: '3', type: 'wb_delete', elementId: 'text' },
    {
      id: '4',
      type: 'wb_draw_shape',
      elementId: 'box',
      shape: 'circle',
      x: 10,
      y: 10,
      width: 20,
      height: 20,
    },
    { id: '5', type: 'wb_clear' },
  ]);
  assert.equal(draw.boardState(f, 900).elements.length, 1);
  assert.equal(draw.boardState(f, f[2].end).elements.length, 0);
  assert.equal(draw.boardState(f, f.at(-1).end).elements.length, 0);
  assert.equal(draw.boardState(f, f.at(-1).end).caption, '讲解');
});
test('registered activity contains native templates and no web view', () => {
  const s = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/activity/index.wxml'),
    'utf8',
  );
  assert.match(s, /<native-canvas/);
  assert.match(s, /<slider/);
  assert.match(s, /<textarea/);
  assert.doesNotMatch(s, /<web-view|<iframe|<script/);
});
