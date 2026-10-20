const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gradeChoice, sceneView, runView, plain } = require('../miniprogram/utils/course');
const { createPoller } = require('../miniprogram/utils/poller');
test('grades multiple selections as sets and excludes unanswered/manual questions', () => {
  assert.equal(gradeChoice({ type: 'multiple', answer: ['A', 'C'] }, ['C', 'A']), true);
  assert.equal(gradeChoice({ type: 'multiple', answer: ['A', 'C'] }, ['A']), false);
  assert.equal(gradeChoice({ type: 'short_answer', answer: ['yes'] }, ['yes']), null);
  assert.equal(gradeChoice({ type: 'single' }, ['A']), null);
});
test('reads actual DSL canvas and speech assets; ignores invalidated audio', () => {
  const scene = sceneView({
    type: 'slide',
    content: { canvas: { elements: [{ id: 'a', type: 'text', content: '<p>Hello</p>' }] } },
    actions: [{ id: 'a', type: 'speech', text: 'Hi', audioId: 'ast_1', audioInvalidated: true }],
  });
  assert.equal(scene.notes[0].text, 'Hello');
  assert.equal(scene.speeches[0].audioId, '');
});
test('maps durable outline-confirmation and scene narration states', () => {
  const view = runView({
    input: { requirement: 'topic' },
    state: 'generating',
    step: 'scene:1:narration',
    progress: { scenesTotal: 3, scenesCompleted: 1 },
  });
  assert.equal(view.percent, 33);
  assert.equal(view.detail, '第 2 节 · 合成语音');
});
test('polling stops on hide and ignores an in-flight response', async () => {
  let resolve,
    received = 0,
    scheduled = 0;
  const poller = createPoller(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
    () => received++,
    () => {},
    1,
    {
      setTimeout() {
        scheduled++;
      },
      clearTimeout() {},
    },
  );
  poller.start();
  poller.stop();
  resolve({});
  await new Promise(setImmediate);
  assert.equal(received, 0);
  assert.equal(scheduled, 0);
});
test('plain-text notes remove executable tags rather than showing script source', () => {
  assert.equal(plain('<script>alert(1)</script><p>A &amp; B</p>'), 'A & B');
});
