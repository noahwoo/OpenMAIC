const { api, showError } = require('../../utils/api');
const { runView } = require('../../utils/course');
const { createPoller } = require('../../utils/poller');
Page({
  data: { loading: true, courses: [], runs: [], error: '', query: '', filtered: [] },
  onLoad() {
    this.poller = createPoller(
      () =>
        Promise.all([api().request('/api/stages'), api().request('/api/generation-runs?active=1')]),
      ([library, active]) => {
        this.setData({
          loading: false,
          courses: library.stages || [],
          runs: (active.runs || []).map(runView),
          error: '',
        });
        this.filter();
      },
      (error) => {
        this.setData({ loading: false, error: error.message });
        return false;
      },
      12000,
    );
  },
  onShow() {
    if (this.poller) this.poller.start();
  },
  onHide() {
    this.poller.stop();
  },
  onUnload() {
    this.poller.stop();
  },
  onPullDownRefresh() {
    this.poller.start();
    wx.stopPullDownRefresh();
  },
  search(e) {
    this.setData({ query: e.detail.value });
    this.filter();
  },
  filter() {
    const q = this.data.query.trim().toLowerCase();
    this.setData({
      filtered: this.data.courses.filter((c) => (c.name || '').toLowerCase().includes(q)),
    });
  },
  create() {
    wx.navigateTo({ url: '/pages/create/index' });
  },
  settings() {
    wx.navigateTo({ url: '/pages/settings/index' });
  },
  openCourse(e) {
    wx.navigateTo({
      url: '/pages/classroom/index?id=' + encodeURIComponent(e.currentTarget.dataset.id),
    });
  },
  openRun(e) {
    wx.navigateTo({
      url: '/pages/progress/index?id=' + encodeURIComponent(e.currentTarget.dataset.id),
    });
  },
  retry() {
    try {
      this.poller.start();
    } catch (e) {
      showError(e);
    }
  },
});
