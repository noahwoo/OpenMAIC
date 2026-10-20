const { createClient } = require('./client');
let client;
function settings() {
  return wx.getStorageSync('openmaic:connection') || { baseUrl: 'http://127.0.0.1:3000' };
}
function api() {
  const config = settings();
  if (!client || client.baseUrl !== config.baseUrl) client = createClient(wx, config);
  return client;
}
function configure(baseUrl) {
  wx.setStorageSync('openmaic:connection', { baseUrl });
  client = null;
}
function showError(error) {
  wx.showToast({ title: error.message || '操作失败', icon: 'none', duration: 3500 });
}
function removeFile(path) {
  if (path) wx.getFileSystemManager().unlink({ filePath: path, fail() {} });
}
module.exports = { api, settings, configure, showError, removeFile };
