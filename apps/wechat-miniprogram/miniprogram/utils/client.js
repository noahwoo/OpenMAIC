/* CommonJS also runs in Node so session and concurrency behavior can be tested. */
function normalizeBaseUrl(value) {
  const url = String(value || '')
    .trim()
    .replace(/\/+$/, '');
  if (
    !/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(url) &&
    !/^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::\d+)?$/i.test(
      url,
    )
  ) {
    throw new Error('请输入 HTTPS 服务地址；本地调试可使用 localhost 或内网 HTTP 地址（不含路径）');
  }
  return url;
}
function mergeCookies(jar, values) {
  const next = Object.assign({}, jar);
  const lines = (Array.isArray(values) ? values : [values || ''])
    .join(',')
    .split(/,(?=\s*[^;,=\s]+=)/);
  lines.forEach((line) => {
    const pair = line.trim().split(';')[0];
    const at = pair.indexOf('=');
    if (at <= 0) return;
    const name = pair.slice(0, at).trim();
    const value = pair.slice(at + 1);
    if (!/^[!#$%&'*+.^_`|~\w-]+$/.test(name) || /[\r\n;]/.test(value)) return;
    if (/max-age\s*=\s*0\b/i.test(line) || !value) delete next[name];
    else next[name] = value;
  });
  return next;
}
function devicePlatform(platform) {
  try {
    if (typeof platform.getDeviceInfo === 'function')
      return platform.getDeviceInfo().platform || 'unknown';
    if (typeof platform.getSystemInfoSync === 'function')
      return platform.getSystemInfoSync().platform || 'unknown';
  } catch (_) {
    /* Detection must not prevent requests on older runtimes. */
  }
  return 'unknown';
}
function isLoopback(baseUrl) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(?::|$)/i.test(baseUrl);
}
function connectionError(platform, baseUrl, failure, downloading = false) {
  const nativeMessage = String((failure && failure.errMsg) || '');
  let code = 'NETWORK_ERROR';
  let message = '无法连接 ' + baseUrl + '，请检查网络和服务是否正在运行';
  if (
    devicePlatform(platform) !== 'devtools' &&
    devicePlatform(platform) !== 'unknown' &&
    isLoopback(baseUrl)
  ) {
    code = 'DEVICE_LOOPBACK';
    message =
      '手机上的 localhost / 127.0.0.1 指向手机自身，无法访问 Mac 服务。请在连接设置填写手机可访问的后端 HTTPS 地址';
  } else if (
    /not in domain list|domain.*(?:not|invalid)|不在.*合法域名|合法域名.*校验/i.test(nativeMessage)
  ) {
    code = 'DOMAIN_NOT_ALLOWED';
    message = isLoopback(baseUrl)
      ? '本地调试请求被微信域名校验拦截。请在开发者工具「详情 → 本地设置」勾选「不校验合法域名、web-view、TLS 版本及 HTTPS 证书」，然后重新编译'
      : '微信拦截了服务域名，请在小程序后台配置 ' +
        (downloading ? 'downloadFile' : 'request') +
        ' 合法域名：' +
        baseUrl;
  } else if (/timeout|timed out/i.test(nativeMessage)) {
    code = 'REQUEST_TIMEOUT';
    message = '连接 ' + baseUrl + ' 超时，请检查网络和后端响应';
  } else if (/refused|ERR_CONNECTION_REFUSED|connect.*fail/i.test(nativeMessage)) {
    code = 'CONNECTION_REFUSED';
    message =
      '服务拒绝连接：' + baseUrl + '。请确认 OpenMAIC 已启动、端口正确，且监听地址能被当前设备访问';
  } else if (/certificate|ssl|tls|证书/i.test(nativeMessage)) {
    code = 'TLS_ERROR';
    message = 'HTTPS 证书或 TLS 校验失败，请检查 ' + baseUrl + ' 的证书配置';
  } else if (/dns|ERR_NAME_NOT_RESOLVED|resolve.*host|域名解析/i.test(nativeMessage)) {
    code = 'DNS_ERROR';
    message = '无法解析服务域名：' + baseUrl + '，请检查地址及网络 / VPN';
  }
  const error = new Error(message);
  error.code = code;
  return error;
}
function createClient(platform, config) {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const storageKey = 'openmaic:cookies:' + baseUrl;
  let jar = platform.getStorageSync(storageKey) || {};
  let session = null;
  function headers() {
    const cookie = Object.keys(jar)
      .map((k) => k + '=' + jar[k])
      .join('; ');
    return cookie ? { Cookie: cookie } : {};
  }
  function raw(path, method, data) {
    if (!/^\/api\//.test(path) || path.includes('://') || path.includes('..'))
      return Promise.reject(new Error('无效接口路径'));
    const device = devicePlatform(platform);
    if (device !== 'devtools' && device !== 'unknown' && isLoopback(baseUrl))
      return Promise.reject(connectionError(platform, baseUrl, {}));
    return new Promise((resolve, reject) =>
      platform.request({
        url: baseUrl + path,
        method: method || 'GET',
        data,
        header: Object.assign({ 'Content-Type': 'application/json' }, headers()),
        timeout: 30000,
        success(res) {
          const cookies =
            res.cookies && res.cookies.length
              ? res.cookies
              : (res.header || {})['Set-Cookie'] || (res.header || {})['set-cookie'];
          if (cookies) {
            jar = mergeCookies(jar, cookies);
            platform.setStorageSync(storageKey, jar);
          }
          if (
            res.statusCode < 200 ||
            res.statusCode >= 300 ||
            !res.data ||
            typeof res.data !== 'object' ||
            res.data.success === false
          ) {
            const body = res.data || {};
            const error = new Error(
              res.statusCode === 401
                ? '会话无效或需要访问码，请到连接设置重新连接'
                : body.error || '服务请求失败（' + res.statusCode + '）',
            );
            error.status = res.statusCode;
            reject(error);
            return;
          }
          resolve(res.data);
        },
        fail(failure) {
          reject(connectionError(platform, baseUrl, failure));
        },
      }),
    );
  }
  function ensureSession() {
    if (!session)
      session = raw('/api/stages').catch((error) => {
        session = null;
        throw error;
      });
    return session;
  }
  return {
    baseUrl,
    headers,
    async connect(code) {
      if (code) await raw('/api/access-code/verify', 'POST', { code });
      session = null;
      await ensureSession();
    },
    async request(path, method, data) {
      await ensureSession();
      return raw(path, method, data);
    },
    downloadAsset(id) {
      if (!/^ast_[a-zA-Z0-9_-]+$/.test(id))
        return Promise.reject(new Error('此资源不是服务器资产，需在网页版重新保存课程'));
      return ensureSession().then(
        () =>
          new Promise((resolve, reject) =>
            platform.downloadFile({
              url: baseUrl + '/api/persistence/assets/' + encodeURIComponent(id) + '/content',
              header: headers(),
              timeout: 60000,
              success(res) {
                if (res.statusCode === 200) resolve(res.tempFilePath);
                else reject(new Error('资源读取失败（' + res.statusCode + '）'));
              },
              fail(failure) {
                reject(connectionError(platform, baseUrl, failure, true));
              },
            }),
          ),
      );
    },
  };
}
module.exports = { normalizeBaseUrl, mergeCookies, createClient, devicePlatform, connectionError };
