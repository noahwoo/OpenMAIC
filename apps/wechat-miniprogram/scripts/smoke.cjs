/* Uses the mini-program client unchanged against a real server. No LLM calls. */
const { createClient } = require('../miniprogram/utils/client');
const storage = {};
const platform = {
  getStorageSync: (k) => storage[k],
  setStorageSync: (k, v) => {
    storage[k] = v;
  },
  request(options) {
    fetch(options.url, {
      method: options.method,
      headers: options.header,
      ...(options.data ? { body: JSON.stringify(options.data) } : {}),
      redirect: 'error',
    })
      .then(async (response) =>
        options.success({
          statusCode: response.status,
          data: await response.json(),
          cookies: response.headers.getSetCookie(),
        }),
      )
      .catch(options.fail);
  },
};
async function main() {
  const client = createClient(platform, {
    baseUrl: process.env.OPENMAIC_TEST_URL || 'http://127.0.0.1:3000',
  });
  await client.connect(process.env.OPENMAIC_TEST_ACCESS_CODE || '');
  let id;
  try {
    const created = await client.request('/api/stages', 'POST', {
      name: '小程序接口验证（临时测试课程）',
    });
    id = created.id || (created.stage && created.stage.id);
    if (!id) throw new Error('Create-stage response did not contain an ID');
    const [library, document] = await Promise.all([
      client.request('/api/stages'),
      client.request('/api/stages/' + encodeURIComponent(id)),
    ]);
    if (!library.stages.some((s) => s.id === id) || document.stage.id !== id)
      throw new Error('Owner identity was not preserved');
    console.log('Real backend passed: session → create → list → owner-scoped read.');
  } finally {
    if (id) {
      await client.request('/api/stages/' + encodeURIComponent(id), 'DELETE');
      console.log('Temporary test course removed.');
    }
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
