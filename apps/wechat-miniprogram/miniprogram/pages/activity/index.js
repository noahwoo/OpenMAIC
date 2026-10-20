const { api } = require('../../utils/api');
Page({
  data: { src: '', loading: true, error: '' },
  onLoad(query) {
    this.stageId = query.stageId;
    this.sceneId = query.sceneId;
    this.epoch = 0;
    this.launch();
  },
  onUnload() {
    this.epoch += 1;
  },
  async launch() {
    const epoch = ++this.epoch;
    this.setData({ loading: true, error: '', src: '' });
    try {
      const client = api();
      const result = await client.request('/api/miniapp/launch', 'POST', {
        stageId: this.stageId,
        sceneId: this.sceneId,
      });
      if (epoch !== this.epoch) return;
      // Only the same service's fixed launch page may receive a one-use ticket.
      if (!/^\/miniapp#[A-Za-z0-9_-]{43}$/.test(result.path || ''))
        throw new Error('服务返回了无效的活动地址');
      this.setData({ src: client.baseUrl + result.path, loading: false });
    } catch (error) {
      if (epoch === this.epoch) this.setData({ loading: false, error: error.message });
    }
  },
  failed() {
    this.setData({
      src: '',
      loading: false,
      error:
        '活动页面无法打开。请检查 web-view 业务域名、HTTPS 证书及小程序账号是否支持 web-view；开发者工具本地调试需关闭域名校验后重新编译。',
    });
  },
});
