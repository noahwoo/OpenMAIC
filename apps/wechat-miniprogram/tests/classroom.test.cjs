const { test } = require('node:test');
const assert = require('node:assert/strict');
const apiModule = require('../miniprogram/utils/api');
const calls = { played: 0, deleted: [], storage: {} };
let definition;
global.Page = (value) => {
  definition = value;
};
require('../miniprogram/pages/classroom/index');
function page() {
  return Object.assign({}, definition, {
    data: {
      ...definition.data,
      scene: { id: 's', speeches: [{ audioId: 'ast_one', text: 'Hello' }] },
      scenes: [],
    },
    visible: true,
    playToken: 0,
    files: [],
    audio: {
      stop() {},
      play() {
        calls.played++;
      },
    },
    setData(value) {
      Object.assign(this.data, value);
    },
  });
}
test('leaving the page while audio downloads prevents playback and releases the temporary file', async () => {
  let resolve;
  const download = new Promise((r) => {
    resolve = r;
  });
  const oldApi = apiModule.api;
  // The page captured its adapter functions when loaded; use the real client with wx stubs.
  global.wx = {
    getStorageSync: (k) =>
      k === 'openmaic:connection' ? { baseUrl: 'https://race.example.com' } : calls.storage[k],
    setStorageSync: (k, v) => {
      calls.storage[k] = v;
    },
    request: (options) =>
      options.success({ statusCode: 200, data: { stages: [] }, cookies: ['anonymous_id=one'] }),
    downloadFile: (options) => {
      download.then((path) => options.success({ statusCode: 200, tempFilePath: path }));
    },
    getFileSystemManager: () => ({ unlink: ({ filePath }) => calls.deleted.push(filePath) }),
    showToast() {},
  };
  calls.played = 0;
  calls.deleted = [];
  const p = page();
  const pending = p.playClip(0);
  await new Promise(setImmediate);
  p.onHide();
  resolve('/tmp/stale.wav');
  await pending;
  assert.equal(calls.played, 0);
  assert.ok(calls.deleted.includes('/tmp/stale.wav'));
  assert.equal(p.data.downloading, false);
  assert.equal(p.data.playing, false);
  assert.equal(apiModule.api, oldApi);
});
