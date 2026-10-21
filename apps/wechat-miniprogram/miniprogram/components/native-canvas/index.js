const draw = require('../../utils/native-draw');
Component({
  properties: { mode: String, spec: Object, values: Object, frames: Array, elapsed: Number },
  data: { height: 240 },
  observers: {
    'mode,spec,values,frames,elapsed': function () {
      this.paint();
    },
  },
  lifetimes: {
    ready() {
      this.createSelectorQuery()
        .select('#surface')
        .fields({ node: true, size: true })
        .exec((result) => {
          const entry = result[0];
          if (!entry || !entry.node) return;
          this.canvas = entry.node;
          this.ctx = entry.node.getContext('2d');
          this.width = entry.width;
          const dpr =
            (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 1;
          this.dpr = dpr;
          this.resize();
          this.paint();
        });
    },
    detached() {
      this.ctx = null;
      this.canvas = null;
    },
  },
  methods: {
    resize() {
      if (!this.canvas) return;
      const height =
        this.properties.mode === 'whiteboard'
          ? (this.width * 562) / 1000
          : (this.width * 240) / 320;
      this.setData({ height });
      this.canvas.width = this.width * this.dpr;
      this.canvas.height = height * this.dpr;
    },
    paint() {
      if (!this.ctx) return;
      this.resize();
      const ctx = this.ctx,
        w = this.properties.mode === 'whiteboard' ? 1000 : 320,
        h = this.properties.mode === 'whiteboard' ? 562 : 240;
      ctx.setTransform(this.canvas.width / w, 0, 0, this.canvas.height / h, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.textBaseline = 'top';
      try {
        if (this.properties.mode === 'whiteboard')
          draw.whiteboard(
            ctx,
            draw.boardState(this.properties.frames || [], this.properties.elapsed || 0),
          );
        else {
          const spec = this.properties.spec,
            values = this.properties.values || {};
          // WXML properties may arrive in separate updates before initial calculation.
          if (
            spec &&
            spec.status === 'ready' &&
            Number.isFinite(values.time) &&
            spec.parameters.concat(spec.outputs).every((p) => Number.isFinite(values[p.id]))
          )
            draw.simulation(ctx, spec, values);
        }
      } catch (error) {
        this.triggerEvent('rendererror', { message: error.message });
      }
    },
  },
});
