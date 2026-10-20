const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createClient, mergeCookies, normalizeBaseUrl } = require('../miniprogram/utils/client');
function platform(handler) {
  const storage = {};
  return {
    storage,
    getStorageSync: (k) => storage[k],
    setStorageSync: (k, v) => {
      storage[k] = v;
    },
    request: handler,
    downloadFile() {
      throw new Error('unexpected download');
    },
  };
}
test('parses combined cookies without splitting Expires; expires revoked credentials', () => {
  const jar = mergeCookies(
    {},
    'anonymous_id=owner; Expires=Wed, 21 Oct 2026 07:28:00 GMT, openmaic_access=signed; HttpOnly',
  );
  assert.deepEqual(jar, { anonymous_id: 'owner', openmaic_access: 'signed' });
  assert.deepEqual(mergeCookies(jar, ['openmaic_access=; Max-Age=0']), { anonymous_id: 'owner' });
});
test('concurrent first requests share a single identity bootstrap', async () => {
  let boot = 0;
  const requests = [];
  const wx = platform((options) => {
    requests.push(options);
    setImmediate(() => {
      if (!options.header.Cookie) {
        boot++;
        options.success({
          statusCode: 200,
          cookies: ['anonymous_id=one; HttpOnly'],
          data: { stages: [] },
        });
      } else options.success({ statusCode: 200, data: { success: true } });
    });
  });
  const client = createClient(wx, { baseUrl: 'https://school.example.com' });
  await Promise.all([client.request('/api/agents'), client.request('/api/folders')]);
  assert.equal(boot, 1);
  assert.equal(requests.length, 3);
  assert.equal(requests[1].header.Cookie, 'anonymous_id=one');
});
test('does not forward one service identity to another service', async () => {
  const wx = platform((options) =>
    options.success({
      statusCode: 200,
      data: { stages: [] },
      cookies: ['anonymous_id=' + (options.url.includes('one.') ? 'one' : 'two')],
    }),
  );
  const a = createClient(wx, { baseUrl: 'https://one.example.com' });
  const b = createClient(wx, { baseUrl: 'https://two.example.com' });
  await a.connect();
  assert.deepEqual(b.headers(), {});
  await b.connect();
  assert.equal(a.headers().Cookie, 'anonymous_id=one');
  assert.equal(b.headers().Cookie, 'anonymous_id=two');
});
test('protected calls do not continue after an access-code failure', async () => {
  let calls = 0;
  const wx = platform((options) => {
    calls++;
    options.success({ statusCode: 401, data: { error: 'Access code required' } });
  });
  const client = createClient(wx, { baseUrl: 'https://school.example.com' });
  await assert.rejects(client.request('/api/generation-runs'), /访问码/);
  assert.equal(calls, 1);
});
test('rejects URLs with credentials, paths or insecure public hosts', () => {
  for (const value of [
    'https://user:secret@example.com',
    'https://example.com/path',
    'http://example.com',
    'javascript:alert(1)',
  ])
    assert.throws(() => normalizeBaseUrl(value));
  assert.equal(normalizeBaseUrl(' https://school.example.com/ '), 'https://school.example.com');
});
test('download requests carry the same owner cookie and reject arbitrary resource IDs', async () => {
  const wx = platform((options) =>
    options.success({ statusCode: 200, cookies: ['anonymous_id=one'], data: { stages: [] } }),
  );
  wx.downloadFile = (options) => {
    assert.equal(options.header.Cookie, 'anonymous_id=one');
    assert.equal(options.url, 'https://school.example.com/api/persistence/assets/ast_test/content');
    options.success({ statusCode: 200, tempFilePath: '/tmp/audio.wav' });
  };
  const client = createClient(wx, { baseUrl: 'https://school.example.com' });
  assert.equal(await client.downloadAsset('ast_test'), '/tmp/audio.wav');
  await assert.rejects(client.downloadAsset('https://evil.example/asset'), /服务器资产/);
});

test('reports the actual WeChat domain-policy failure for local simulator requests', async () => {
  const wx = platform((options) => options.fail({ errMsg: 'request:fail url not in domain list' }));
  wx.getDeviceInfo = () => ({ platform: 'devtools' });
  const client = createClient(wx, { baseUrl: 'http://127.0.0.1:3000' });
  await assert.rejects(client.request('/api/stages'), (error) => {
    assert.equal(error.code, 'DOMAIN_NOT_ALLOWED');
    assert.match(error.message, /本地设置/);
    assert.match(error.message, /重新编译/);
    return true;
  });
});

test('rejects phone loopback before making a request and explains the Mac address issue', async () => {
  let calls = 0;
  const wx = platform(() => {
    calls++;
  });
  wx.getDeviceInfo = () => ({ platform: 'ios' });
  const client = createClient(wx, { baseUrl: 'http://127.0.0.1:3000' });
  await assert.rejects(client.connect(), (error) => {
    assert.equal(error.code, 'DEVICE_LOOPBACK');
    assert.match(error.message, /手机自身/);
    return true;
  });
  assert.equal(calls, 0);
});

test('distinguishes refused ports, timeouts, TLS and DNS errors', () => {
  const { connectionError } = require('../miniprogram/utils/client');
  const wx = { getDeviceInfo: () => ({ platform: 'devtools' }) };
  for (const [errMsg, code] of [
    ['request:fail net::ERR_CONNECTION_REFUSED', 'CONNECTION_REFUSED'],
    ['request:fail timeout', 'REQUEST_TIMEOUT'],
    ['request:fail ssl certificate error', 'TLS_ERROR'],
    ['request:fail net::ERR_NAME_NOT_RESOLVED', 'DNS_ERROR'],
  ]) {
    assert.equal(connectionError(wx, 'https://school.example.com', { errMsg }).code, code);
  }
});

test('download-domain errors name downloadFile rather than request configuration', () => {
  const { connectionError } = require('../miniprogram/utils/client');
  const error = connectionError(
    {},
    'https://school.example.com',
    { errMsg: 'downloadFile:fail url not in domain list' },
    true,
  );
  assert.match(error.message, /downloadFile/);
  assert.equal(error.code, 'DOMAIN_NOT_ALLOWED');
});
