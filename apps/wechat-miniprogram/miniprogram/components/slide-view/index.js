const { plain } = require('../../utils/course');
Component({
  properties: {
    scene: {
      type: Object,
      observer() {
        this.render();
      },
    },
  },
  data: { elements: [], background: '#fff', scale: 0.3 },
  lifetimes: {
    attached() {
      this.render();
    },
    ready() {
      this.measure();
    },
  },
  pageLifetimes: {
    resize() {
      this.measure();
    },
  },
  methods: {
    measure() {
      this.createSelectorQuery()
        .select('.frame')
        .boundingClientRect((rect) => {
          if (rect) this.setData({ scale: rect.width / 1000 });
        })
        .exec();
    },
    render() {
      const canvas = ((this.data.scene && this.data.scene.content) || {}).canvas || {};
      const background = canvas.background || {};
      const elements = (canvas.elements || []).map((e) => {
        const numeric = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
        const style = `left:${numeric(e.left)}px;top:${numeric(e.top)}px;width:${Math.max(1, numeric(e.width))}px;height:${Math.max(1, numeric(e.height))}px;transform:rotate(${numeric(e.rotate)}deg);opacity:${e.opacity === undefined ? 1 : e.opacity};`;
        return Object.assign({}, e, {
          text: plain(e.content || e.latex),
          style,
          color: e.defaultColor || '#17243d',
          fillColor: typeof e.fill === 'string' ? e.fill : '#edf2fb',
          // Private images need authenticated download before a native image can display them.
          imageSrc: e.localImage || (/^https:\/\//.test(e.src || '') ? e.src : ''),
        });
      });
      this.setData({ elements, background: background.color || '#ffffff' });
      this.measure();
    },
  },
});
