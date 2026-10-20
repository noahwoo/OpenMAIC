const { api, showError } = require('../../utils/api');
const { runView } = require('../../utils/course');
const { createPoller } = require('../../utils/poller');
Page({
  data: { run: null, error: '', busy: false, failures: 0 },
  onLoad(query) {
    this.runId = query.id;
    this.poller = createPoller(
      () => api().request('/api/generation-runs/' + encodeURIComponent(this.runId)),
      ({ run }) => {
        this.setData({ run: runView(run), error: '', failures: 0 });
        return !['completed', 'ended'].includes(run.state);
      },
      (error) => {
        const failures = this.data.failures + 1;
        this.setData({ error: error.message, failures });
        return failures < 5;
      },
    );
  },
  onShow() {
    this.poller.start();
  },
  onHide() {
    this.poller.stop();
  },
  onUnload() {
    this.poller.stop();
  },
  refresh() {
    this.setData({ failures: 0 });
    this.poller.start();
  },
  async command(e) {
    if (this.data.busy || !this.data.run) return;
    const kind = e.currentTarget.dataset.kind;
    const run = this.data.run;
    this.setData({ busy: true });
    try {
      const body = {
        commandId: kind + '-' + Date.now() + '-' + Math.random().toString(36).slice(2),
      };
      if (kind === 'confirm-outline') body.outlineRevision = run.outline.revision;
      await api().request(
        '/api/generation-runs/' + encodeURIComponent(this.runId) + '/' + kind,
        'POST',
        body,
      );
      this.poller.start();
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ busy: false });
    }
  },
  open() {
    wx.navigateTo({
      url: '/pages/classroom/index?id=' + encodeURIComponent(this.data.run.stageId),
    });
  },
  home() {
    wx.reLaunch({ url: '/pages/home/index' });
  },
});
