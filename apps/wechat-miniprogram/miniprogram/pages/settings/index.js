const { settings, configure, api, showError } = require('../../utils/api');
const { normalizeBaseUrl, devicePlatform } = require('../../utils/client');
Page({
  data: { baseUrl: '', code: '', busy: false, message: '', runtime: '' },
  onLoad() {
    const runtime = devicePlatform(wx);
    this.setData({
      baseUrl: settings().baseUrl,
      runtime:
        runtime === 'devtools' ? '电脑模拟器' : runtime === 'unknown' ? '当前设备' : '手机真机',
    });
  },
  input(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },
  async save() {
    if (this.data.busy) return;
    this.setData({ busy: true, message: '' });
    try {
      const baseUrl = normalizeBaseUrl(this.data.baseUrl);
      configure(baseUrl);
      await api().connect(this.data.code);
      this.setData({ code: '', message: '连接成功，会话已保存在当前设备' });
      wx.showToast({ title: '连接成功' });
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ busy: false });
    }
  },
});
