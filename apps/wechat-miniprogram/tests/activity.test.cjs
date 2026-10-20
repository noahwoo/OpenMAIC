const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function make(request) {
  let definition;
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../miniprogram/pages/activity/index.js'), 'utf8'),
    {
      require: () => ({ api: () => ({ baseUrl: 'https://course.example', request }) }),
      Page: (value) => {
        definition = value;
      },
    },
  );
  return Object.assign({}, definition, {
    stageId: 'stage',
    sceneId: 'scene',
    epoch: 0,
    data: {},
    setData(values) {
      Object.assign(this.data, values);
    },
  });
}
test('activity opens only the configured service with an opaque fragment ticket', async () => {
  let args;
  const page = make(async (...a) => {
    args = a;
    return { path: '/miniapp#' + 'a'.repeat(43) };
  });
  await page.launch();
  assert.equal(args[0], '/api/miniapp/launch');
  assert.equal(args[2].sceneId, 'scene');
  assert.equal(page.data.src, 'https://course.example/miniapp#' + 'a'.repeat(43));
});
test('activity refuses foreign URLs and unexpected same-origin routes', async () => {
  for (const path of [
    'https://other.example/#ticket',
    '/classroom/x',
    '/miniapp#short',
    '//evil.example',
  ]) {
    const page = make(async () => ({ path }));
    await page.launch();
    assert.equal(page.data.src, '');
    assert.ok(page.data.error);
  }
});
test('late launch responses cannot reopen an unloaded activity', async () => {
  let resolve;
  const pending = new Promise((r) => {
    resolve = r;
  });
  const page = make(() => pending);
  const launch = page.launch();
  page.onUnload();
  resolve({ path: '/miniapp#' + 'a'.repeat(43) });
  await launch;
  assert.equal(page.data.src, '');
});
