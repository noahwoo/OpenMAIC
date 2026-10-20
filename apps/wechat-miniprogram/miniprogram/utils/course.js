function plain(html) {
  return String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}
function runView(run) {
  const labels = {
    preparing: '准备材料',
    outlining: '生成大纲',
    awaiting_outline_confirmation: '待确认大纲',
    generating: '生成课程',
    paused: '生成已暂停',
    completed: '课程已就绪',
    ended: '任务已结束',
  };
  const progress = run.progress || {};
  const total = progress.scenesTotal || 0;
  const done = progress.scenesCompleted || 0;
  const step = run.step || '';
  const parts = step.split(':');
  const steps = {
    content: '编排课件',
    actions: '生成讲解',
    narration: '合成语音',
    image: '生成图片',
    video: '生成视频',
  };
  return Object.assign({}, run, {
    label: labels[run.state] || run.state,
    title: (run.outline || {}).courseTitle || run.input.requirement,
    percent: run.state === 'completed' ? 100 : total ? Math.round((done / total) * 100) : 0,
    detail:
      parts[0] === 'scene'
        ? '第 ' + (Number(parts[1]) + 1) + ' 节 · ' + (steps[parts[2]] || '处理中')
        : labels[run.state],
    done,
    total,
    errorMessage: run.error ? run.error.message : '',
    outlines: (run.outline || {}).outlines || [],
  });
}
function sceneView(scene) {
  const content = scene.content || {};
  const canvas = content.canvas || {};
  const speeches = (scene.actions || [])
    .filter((a) => a.type === 'speech')
    .map((a) => ({ id: a.id, text: a.text, audioId: a.audioInvalidated ? '' : a.audioId || '' }));
  return Object.assign({}, scene, {
    speeches,
    notes: (canvas.elements || [])
      .filter((e) => e.type === 'text' || e.type === 'latex')
      .map((e) => ({ id: e.id, text: plain(e.content || e.latex) }))
      .filter((e) => e.text),
    questions: content.questions || [],
    unsupported: !['slide', 'quiz'].includes(scene.type),
  });
}
function gradeChoice(question, selected) {
  if (
    !['single', 'multiple'].includes(question.type) ||
    !Array.isArray(question.answer) ||
    !question.answer.length
  )
    return null;
  const actual = [...new Set(selected || [])].sort();
  const expected = [...new Set(question.answer)].sort();
  return actual.length === expected.length && actual.every((a, i) => a === expected[i]);
}
module.exports = { plain, runView, sceneView, gradeChoice };
