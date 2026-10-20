const { api, showError } = require('../../utils/api');
Page({
  data: { requirement: '', submitting: false, review: true, topic: '' },
  input(e) {
    this.setData({ requirement: e.detail.value });
  },
  toggle(e) {
    this.setData({ review: e.detail.value });
  },
  example(e) {
    this.setData({ requirement: e.currentTarget.dataset.topic });
  },
  async submit() {
    if (this.data.submitting) return;
    const requirement = this.data.requirement.trim();
    if (!requirement || requirement.length > 20000) {
      showError(new Error('请输入 1–20000 字的学习目标'));
      return;
    }
    this.setData({ submitting: true });
    try {
      const { run } = await api().request('/api/generation-runs', 'POST', {
        requirement,
        materialIds: [],
        interactive: false,
        taskEngine: false,
        agents: { mode: 'auto' },
        outlineReview: this.data.review ? 'wait' : 'auto',
      });
      wx.redirectTo({ url: '/pages/progress/index?id=' + encodeURIComponent(run.id) });
    } catch (error) {
      showError(
        error.status
          ? error
          : new Error('提交结果尚未确认，请先返回学习空间查看生成任务，避免重复提交'),
      );
    } finally {
      this.setData({ submitting: false });
    }
  },
});
