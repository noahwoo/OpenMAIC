const { api, showError, removeFile } = require('../../utils/api');
const { sceneView, gradeChoice } = require('../../utils/course');
Page({
  data: {
    loading: true,
    error: '',
    title: '',
    scenes: [],
    index: 0,
    scene: null,
    tab: 'notes',
    clip: 0,
    playing: false,
    downloading: false,
    questions: [],
    submitted: false,
    score: 0,
    total: 0,
  },
  onLoad(query) {
    this.stageId = query.id;
    this.version = 0;
    this.playToken = 0;
    this.files = [];
    this.visible = true;
    this.audio = wx.createInnerAudioContext();
    this.audio.obeyMuteSwitch = true;
    this.audio.onEnded(() => {
      this.setData({ playing: false });
      if (this.visible && this.data.clip + 1 < this.data.scene.speeches.length)
        this.playClip(this.data.clip + 1);
    });
    this.audio.onError(() => {
      this.setData({ playing: false, downloading: false });
      showError(new Error('音频无法播放，可重试或阅读讲义'));
    });
    this.load();
  },
  onShow() {
    this.visible = true;
  },
  onHide() {
    this.visible = false;
    this.stopAudio();
  },
  onUnload() {
    this.visible = false;
    this.version += 1;
    this.stopAudio();
    this.audio.destroy();
    this.files.forEach(removeFile);
  },
  async load() {
    const version = ++this.version;
    this.setData({ loading: true, error: '' });
    try {
      const document = await api().request('/api/stages/' + encodeURIComponent(this.stageId));
      if (version !== this.version) return;
      const scenes = (document.scenes || [])
        .slice()
        .sort((a, b) => a.order - b.order)
        .map(sceneView);
      this.setData({ title: document.stage.name, scenes, loading: false });
      const saved =
        wx.getStorageSync('openmaic:learning:' + api().baseUrl + ':' + this.stageId) || {};
      this.selectScene(
        Math.min(Math.max(Number(saved.index) || 0, 0), Math.max(0, scenes.length - 1)),
      );
    } catch (error) {
      if (version === this.version) this.setData({ loading: false, error: error.message });
    }
  },
  selectScene(index) {
    const scene = this.data.scenes[index];
    if (!scene) return;
    this.stopAudio();
    this.files.forEach(removeFile);
    this.files = [];
    const saved = wx.getStorageSync(this.quizKey(scene)) || {};
    const questions = scene.questions.map((q) =>
      Object.assign({}, q, {
        selected: saved[q.id] || [],
        options: (q.options || []).map((o) =>
          Object.assign({}, o, { checked: (saved[q.id] || []).includes(o.value) }),
        ),
      }),
    );
    this.setData({
      index,
      scene,
      clip: 0,
      tab: scene.type === 'quiz' ? 'quiz' : 'notes',
      questions,
      submitted: false,
    });
    wx.setStorageSync('openmaic:learning:' + api().baseUrl + ':' + this.stageId, { index });
    this.loadImages(scene);
  },
  async loadImages(scene) {
    if (scene.type !== 'slide') return;
    const canvas = scene.content.canvas;
    const version = this.version;
    const elements = await Promise.all(
      (canvas.elements || []).map(async (element) => {
        if (element.type !== 'image' || !/^ast_/.test(element.src || '')) return element;
        try {
          const path = await api().downloadAsset(element.src);
          if (version !== this.version) {
            removeFile(path);
            return element;
          }
          this.files.push(path);
          return Object.assign({}, element, { localImage: path });
        } catch (_) {
          return element;
        }
      }),
    );
    if (version === this.version && this.data.scene && this.data.scene.id === scene.id)
      this.setData({ 'scene.content.canvas.elements': elements });
  },
  quizKey(scene) {
    return 'openmaic:quiz:' + api().baseUrl + ':' + this.stageId + ':' + scene.id;
  },
  previous() {
    this.selectScene(this.data.index - 1);
  },
  next() {
    this.selectScene(this.data.index + 1);
  },
  select(e) {
    this.selectScene(Number(e.currentTarget.dataset.index));
  },
  tab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },
  stopAudio() {
    this.playToken += 1;
    if (this.audio) this.audio.stop();
    this.setData({ playing: false, downloading: false });
    if (this.currentFile) {
      removeFile(this.currentFile);
      this.currentFile = null;
    }
  },
  togglePlay() {
    if (this.data.playing || this.data.downloading) this.stopAudio();
    else this.playClip(this.data.clip);
  },
  chooseClip(e) {
    this.stopAudio();
    this.setData({ clip: Number(e.currentTarget.dataset.index) });
  },
  async playClip(index) {
    this.stopAudio();
    const token = this.playToken;
    const clip = this.data.scene.speeches[index];
    if (!clip) return;
    this.setData({ clip: index });
    if (!clip.audioId) {
      showError(new Error('该段尚无服务器语音，可阅读下方讲义'));
      return;
    }
    this.setData({ downloading: true });
    try {
      const path = await api().downloadAsset(clip.audioId);
      if (token !== this.playToken || !this.visible) {
        removeFile(path);
        return;
      }
      this.currentFile = path;
      this.audio.src = path;
      this.audio.play();
      this.setData({ playing: true, downloading: false });
    } catch (error) {
      if (token === this.playToken) {
        this.setData({ downloading: false });
        showError(error);
      }
    }
  },
  chooseAnswer(e) {
    if (this.data.submitted) return;
    const { qid, value } = e.currentTarget.dataset;
    const questions = this.data.questions.map((q) => {
      if (q.id !== qid) return q;
      const selected =
        q.type === 'multiple'
          ? q.selected.includes(value)
            ? q.selected.filter((v) => v !== value)
            : q.selected.concat(value)
          : [value];
      return Object.assign({}, q, {
        selected,
        options: q.options.map((o) =>
          Object.assign({}, o, { checked: selected.includes(o.value) }),
        ),
      });
    });
    this.setData({ questions });
    this.saveAnswers();
  },
  shortAnswer(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({
      questions: this.data.questions.map((q) =>
        q.id === id ? Object.assign({}, q, { selected: [e.detail.value] }) : q,
      ),
    });
    this.saveAnswers();
  },
  saveAnswers() {
    const answers = {};
    this.data.questions.forEach((q) => {
      answers[q.id] = q.selected;
    });
    wx.setStorageSync(this.quizKey(this.data.scene), answers);
  },
  grade() {
    if (this.data.questions.some((q) => !q.selected.length || !q.selected[0])) {
      showError(new Error('请完成所有题目后提交'));
      return;
    }
    let score = 0,
      total = 0;
    const questions = this.data.questions.map((q) => {
      const correct = gradeChoice(q, q.selected);
      const points = q.points || 1;
      if (correct !== null) total += points;
      if (correct) score += points;
      return Object.assign({}, q, {
        correct,
        feedback:
          correct === null ? '已记录答案，此题需在完整版中评阅' : correct ? '回答正确' : '再想一想',
        analysisText: q.analysis || '',
      });
    });
    this.setData({ questions, submitted: true, score, total });
  },
  resetQuiz() {
    this.setData({ submitted: false });
  },
  openActivity() {
    this.stopAudio();
    wx.navigateTo({
      url:
        '/pages/activity/index?stageId=' +
        encodeURIComponent(this.stageId) +
        '&sceneId=' +
        encodeURIComponent(this.data.scene.id),
    });
  },
  copyDesktop() {
    wx.setClipboardData({ data: api().baseUrl + '/classroom/' + encodeURIComponent(this.stageId) });
  },
});
