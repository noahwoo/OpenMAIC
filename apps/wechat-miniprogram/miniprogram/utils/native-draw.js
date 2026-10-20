const { evaluate } = require('./native-spec');
function plain(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
function color(value, fallback = '#334155') {
  return /^#[0-9a-f]{3,8}$/i.test(value || '') ? value : fallback;
}
function finite(value, fallback = 0) {
  return Number.isFinite(Number(value))
    ? Math.max(-10000, Math.min(10000, Number(value)))
    : fallback;
}
function write(ctx, value, x, y, width, size = 18, progress = 1) {
  ctx.font = size + 'px sans-serif';
  const chars = plain(value).slice(0, Math.ceil(plain(value).length * progress));
  let line = '',
    row = 0;
  for (const c of chars) {
    if (c === '\n' || ctx.measureText(line + c).width > width) {
      ctx.fillText(line, x, y + row * size * 1.4);
      row++;
      line = c === '\n' ? '' : c;
    } else line += c;
    if (row > 60) break;
  }
  ctx.fillText(line, x, y + row * size * 1.4);
}
function simulation(ctx, spec, values) {
  for (const e of spec.elements) {
    const v = (field) => evaluate(e[field], values);
    const x = v('x'),
      y = v('y');
    ctx.fillStyle = e.color;
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (e.type === 'circle') {
      ctx.arc(x, y, Math.max(0, Math.min(640, v('radius'))), 0, Math.PI * 2);
      ctx.fill();
    }
    if (e.type === 'rect' || e.type === 'bar') ctx.fillRect(x, y, v('width'), v('height'));
    if (e.type === 'line') {
      ctx.moveTo(x, y);
      ctx.lineTo(v('endX'), v('endY'));
      ctx.stroke();
    }
    if (e.type === 'label') write(ctx, e.text, x, y, 320 - x, 14);
  }
}
function boardFrames(actions) {
  let elapsed = 0;
  return (actions || [])
    .filter((a) => a && (String(a.type).startsWith('wb_') || a.type === 'speech'))
    .slice(0, 500)
    .map((action, index) => {
      const duration =
        action.type === 'speech'
          ? Math.max(800, Math.min(8000, String(action.text || '').length * 80))
          : action.type === 'wb_open' || action.type === 'wb_close'
            ? 300
            : 900;
      const frame = {
        action,
        start: elapsed,
        duration,
        end: elapsed + duration,
        id: action.elementId || action.id || 'native_' + index,
      };
      elapsed += duration;
      return frame;
    });
}
function boardState(frames, elapsed) {
  let elements = [],
    caption = '',
    open = true;
  for (const frame of frames) {
    if (elapsed <= frame.start) break;
    const a = frame.action;
    const progress = Math.max(0, Math.min(1, (elapsed - frame.start) / frame.duration));
    if (a.type === 'speech') {
      caption = a.text || '';
      continue;
    }
    if (a.type === 'wb_open') {
      open = true;
      continue;
    }
    if (a.type === 'wb_close') {
      open = false;
      continue;
    }
    if (a.type === 'wb_clear') {
      if (progress >= 1) elements = [];
      else elements = elements.map((e) => Object.assign({}, e, { opacity: 1 - progress }));
      continue;
    }
    if (a.type === 'wb_delete') {
      elements = elements.filter((e) => e.id !== a.elementId);
      continue;
    }
    if (a.type === 'wb_edit_code') {
      elements = elements.map((e) => {
        if (e.id !== a.elementId || e.action.type !== 'wb_draw_code') return e;
        // Line identifiers belong to the desktop code model; do not pretend an unresolved edit succeeded.
        return Object.assign({}, e, {
          note: '代码修改：' + a.operation + '（行级编辑请核对原课件）',
        });
      });
      continue;
    }
    elements = elements
      .filter((e) => e.id !== frame.id)
      .concat({ id: frame.id, action: a, progress, opacity: 1 });
  }
  return { elements, caption, open };
}
function whiteboard(ctx, state) {
  if (!state.open) return;
  for (const item of state.elements) {
    const a = item.action,
      p = item.progress,
      x = finite(a.x),
      y = finite(a.y),
      w = Math.max(1, finite(a.width, 400)),
      h = Math.max(1, finite(a.height, 100));
    ctx.globalAlpha = item.opacity;
    ctx.fillStyle = color(a.color);
    ctx.strokeStyle = color(a.color);
    ctx.lineWidth = 2;
    if (a.type === 'wb_draw_text' || a.type === 'wb_draw_latex' || a.type === 'wb_draw_code') {
      const text = a.content || a.latex || a.code;
      write(ctx, text, x, y, w, Math.max(10, Math.min(48, finite(a.fontSize, 20))), p);
      if (item.note) write(ctx, item.note, x, y + h, w, 14);
    } else if (a.type === 'wb_draw_shape') {
      ctx.fillStyle = color(a.fillColor, '#6366f1');
      ctx.globalAlpha *= p;
      ctx.beginPath();
      if (a.shape === 'circle')
        ctx.ellipse(x + w / 2, y + h / 2, (w / 2) * p, (h / 2) * p, 0, 0, Math.PI * 2);
      else if (a.shape === 'triangle') {
        ctx.moveTo(x + w / 2, y);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y + h);
        ctx.closePath();
      } else ctx.rect(x, y, w * p, h * p);
      ctx.fill();
    } else if (a.type === 'wb_draw_line') {
      const sx = finite(a.startX),
        sy = finite(a.startY),
        ex = sx + (finite(a.endX) - sx) * p,
        ey = sy + (finite(a.endY) - sy) * p;
      ctx.beginPath();
      ctx.lineWidth = Math.max(1, Math.min(12, finite(a.width, 2)));
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      if ((a.points || []).includes('arrow') && p >= 1) {
        const angle = Math.atan2(ey - sy, ex - sx);
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - 12 * Math.cos(angle - 0.4), ey - 12 * Math.sin(angle - 0.4));
        ctx.lineTo(ex - 12 * Math.cos(angle + 0.4), ey - 12 * Math.sin(angle + 0.4));
        ctx.fill();
      }
    } else if (a.type === 'wb_draw_table') {
      const rows = (a.data || []).slice(0, 30),
        columns = Math.max(1, ...rows.map((r) => r.length));
      rows.slice(0, Math.ceil(rows.length * p)).forEach((row, r) =>
        row.slice(0, 12).forEach((cell, c) => {
          ctx.strokeStyle = '#cbd5e1';
          ctx.lineWidth = 1;
          ctx.strokeRect(
            x + (c * w) / columns,
            y + (r * h) / rows.length,
            w / columns,
            h / rows.length,
          );
          write(
            ctx,
            cell,
            x + (c * w) / columns + 5,
            y + (r * h) / rows.length + 5,
            w / columns - 10,
            14,
          );
        }),
      );
    } else if (a.type === 'wb_draw_chart') {
      const data = a.data || {},
        labels = (data.labels || []).slice(0, 20),
        series = (data.series || []).slice(0, 4);
      const max = Math.max(1, ...series.flat().map((v) => Math.abs(finite(v))));
      const palette = ['#6366f1', '#06b6d4', '#f59e0b', '#10b981'];
      if (a.chartType === 'pie' || a.chartType === 'ring') {
        const values = (series[0] || []).slice(0, labels.length).map((v) => Math.max(0, finite(v))),
          total = values.reduce((a, b) => a + b, 0);
        let angle = -Math.PI / 2;
        values.forEach((v, i) => {
          const end = angle + (total ? v / total : 0) * Math.PI * 2 * p;
          ctx.fillStyle = color((a.themeColors || [])[i], palette[i % 4]);
          ctx.beginPath();
          ctx.moveTo(x + w / 2, y + h / 2);
          ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, angle, end);
          ctx.closePath();
          ctx.fill();
          angle = end;
        });
        if (a.chartType === 'ring') {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 4, 0, Math.PI * 2);
          ctx.fill();
        }
        labels.forEach((label, i) => {
          ctx.fillStyle = palette[i % 4];
          write(ctx, label + ' ' + values[i], x + w + 8, y + i * 20, 120, 13);
        });
        continue;
      }
      if (a.chartType === 'radar') {
        const radius = Math.min(w, h) / 2,
          cx = x + w / 2,
          cy = y + h / 2;
        series.forEach((values, si) => {
          ctx.strokeStyle = palette[si % 4];
          ctx.beginPath();
          labels.forEach((label, i) => {
            const angle = -Math.PI / 2 + (i * 2 * Math.PI) / labels.length,
              ratio = (finite(values[i]) / max) * p,
              px = cx + Math.cos(angle) * radius * ratio,
              py = cy + Math.sin(angle) * radius * ratio;
            if (i) ctx.lineTo(px, py);
            else ctx.moveTo(px, py);
            if (!si)
              write(
                ctx,
                label,
                cx + Math.cos(angle) * radius,
                cy + Math.sin(angle) * radius,
                100,
                12,
              );
          });
          ctx.closePath();
          ctx.stroke();
        });
        continue;
      }
      series.forEach((values, s) => {
        ctx.fillStyle = color(
          (a.themeColors || [])[s],
          ['#6366f1', '#06b6d4', '#f59e0b', '#10b981'][s],
        );
        ctx.strokeStyle = ctx.fillStyle;
        ctx.beginPath();
        labels.forEach((label, i) => {
          const value = finite(values[i]),
            px = x + ((i + 0.5) * w) / Math.max(1, labels.length),
            py = y + h - (value / max) * h * p;
          if (a.chartType === 'line' || a.chartType === 'area' || a.chartType === 'scatter') {
            if (!i || a.chartType === 'scatter') ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
            ctx.fillRect(px - 3, py - 3, 6, 6);
          } else
            ctx.fillRect(
              x + (i * w) / labels.length + (s * w) / labels.length / series.length,
              py,
              (w / labels.length / series.length) * 0.8,
              (value / max) * h * p,
            );
          if (s === 0) write(ctx, label, px - 20, y + h + 5, 60, 12);
        });
        ctx.stroke();
      });
    }
  }
  ctx.globalAlpha = 1;
}
module.exports = { simulation, boardFrames, boardState, whiteboard, write };
