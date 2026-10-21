const { api } = require('../../utils/api');
const { validateSpec, calculate } = require('../../utils/native-spec');
const { boardFrames, boardState } = require('../../utils/native-draw');
Page({
  data: {
    loading: true,
    busy: false,
    error: '',
    type: '',
    title: '',
    spec: null,
    parameters: [],
    outputs: [],
    values: {},
    stepIndex: 0,
    playing: false,
    elapsed: 0,
    seek: 0,
    caption: '',
    draft: '',
    submission: '',
    channel: 'instructor',
    pbl: null,
  },
  onLoad(query) {
    this.stageId = query.stageId;
    this.sceneId = query.sceneId;
    this.epoch = 0;
    this.inputs = {};
    this.time = 0;
    this.load();
  },
  onHide() {
    this.pause();
  },
  onUnload() {
    this.pause();
    this.epoch++;
  },
  path() {
    return (
      '/api/miniapp/native/' +
      encodeURIComponent(this.stageId) +
      '/' +
      encodeURIComponent(this.sceneId)
    );
  },
  async load() {
    const epoch = ++this.epoch;
    this.pause();
    this.setData({ loading: true, error: '' });
    try {
      let result = await api().request(this.path());
      if (epoch !== this.epoch) return;
      if (result.needsGeneration) {
        this.setData({ title: result.title, caption: '正在将课程转换为原生实验…' });
        result = await api().request(this.path(), 'POST', { action: 'generate' }, 120000);
      }
      if (epoch !== this.epoch) return;
      this.setData({ type: result.type, title: result.title, loading: false, caption: '' });
      if (result.type === 'simulation') {
        const spec = validateSpec(result.spec);
        this.spec = spec;
        this.inputs = {};
        this.time = 0;
        this.setData({ spec, unsupported: spec.status === 'unsupported' ? spec.reason : '' });
        if (spec.status === 'ready') this.compute();
      }
      if (result.type === 'whiteboard') {
        this.frames = boardFrames(result.actions);
        this.duration = this.frames.length ? this.frames[this.frames.length - 1].end : 0;
        this.time = 0;
        this.setData({
          frames: this.frames,
          warning: result.actions.some(
            (a) => a.type === 'wb_draw_latex' || a.type === 'wb_edit_code',
          )
            ? '公式显示为 LaTeX 文本；代码行级修改显示为说明，请结合原课件核对。'
            : '',
        });
        this.board();
      }
      if (result.type === 'pbl') this.presentPBL(result);
    } catch (error) {
      if (epoch === this.epoch) this.setData({ loading: false, error: error.message });
    }
  },
  presentPBL(pbl) {
    const milestone = (pbl.milestones || []).find((m) =>
      (m.tasks || []).some((t) => t.id === pbl.currentTaskId),
    );
    pbl.scenarioStage = milestone ? milestone.scenarioStage : '';
    this.setData({
      pbl,
      channel: pbl.scenarioStage === 'roleplay' ? this.data.channel : 'instructor',
    });
  },
  compute() {
    try {
      const result = calculate(this.spec, this.inputs, this.time);
      this.setData({
        parameters: result.parameters,
        outputs: result.outputs,
        values: result.values,
        elapsed: Number(this.time.toFixed(1)),
      });
    } catch (error) {
      this.pause();
      this.setData({ error: error.message });
    }
  },
  parameter(event) {
    const p = this.spec.parameters.find((p) => p.id === event.currentTarget.dataset.id);
    if (!p) return;
    const value = p.min + ((p.max - p.min) * Number(event.detail.value)) / 1000;
    this.inputs[p.id] = Math.max(
      p.min,
      Math.min(p.max, p.min + Math.round((value - p.min) / p.step) * p.step),
    );
    this.compute();
  },
  step(event) {
    this.pause();
    const index = Number(event.currentTarget.dataset.index),
      step = this.spec.steps[index];
    if (!step) return;
    this.inputs = Object.assign({}, step.values);
    this.time = 0;
    this.setData({ stepIndex: index });
    this.compute();
  },
  reset() {
    this.pause();
    this.time = 0;
    this.inputs = {};
    this.setData({ error: '', stepIndex: 0 });
    if (this.data.type === 'simulation') this.compute();
    else this.board();
  },
  pause() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.setData({ playing: false });
  },
  play() {
    if (this.timer) {
      this.pause();
      return;
    }
    if (this.data.type === 'whiteboard' && this.time >= this.duration) this.time = 0;
    this.setData({ playing: true });
    let last = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now(),
        delta = now - last;
      last = now;
      this.time += this.data.type === 'whiteboard' ? delta : delta / 1000;
      if (this.data.type === 'whiteboard') {
        this.time = Math.min(this.time, this.duration);
        this.board();
        if (this.time >= this.duration) this.pause();
      } else {
        this.time = Math.min(this.time, 3600);
        this.compute();
        if (this.time >= 3600) this.pause();
      }
    }, 100);
  },
  board() {
    const state = boardState(this.frames || [], this.time);
    this.setData({
      elapsed: this.time,
      caption: state.caption,
      seek: this.duration ? Math.round((this.time / this.duration) * 1000) : 0,
      seconds: Math.round(this.time / 1000),
    });
  },
  seek(event) {
    this.pause();
    this.time = (Number(event.detail.value) / 1000) * this.duration;
    this.board();
  },
  input(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value });
  },
  channel(event) {
    this.setData({ channel: event.detail.value ? 'simulator' : 'instructor' });
  },
  async command(event) {
    if (this.data.busy) return;
    const action = event.currentTarget.dataset.action;
    const epoch = this.epoch;
    this.setData({ busy: true, error: '' });
    try {
      const result = await api().request(
        this.path(),
        'POST',
        {
          action,
          revision: this.data.pbl.revision,
          microtaskId: event.currentTarget.dataset.id,
          text: action === 'message' ? this.data.draft : this.data.submission,
          channel: this.data.channel,
        },
        120000,
      );
      if (epoch !== this.epoch) return;
      this.presentPBL(result);
      this.setData({
        draft: action === 'message' ? '' : this.data.draft,
        submission: action === 'submit' ? '' : this.data.submission,
      });
    } catch (error) {
      if (epoch === this.epoch) {
        try {
          const pbl = await api().request(this.path());
          if (epoch === this.epoch) this.presentPBL(pbl);
        } catch (_) {}
        if (epoch === this.epoch) this.setData({ error: error.message });
      }
    } finally {
      if (epoch === this.epoch) this.setData({ busy: false });
    }
  },
  renderError(event) {
    this.pause();
    this.setData({ error: event.detail.message });
  },
});
