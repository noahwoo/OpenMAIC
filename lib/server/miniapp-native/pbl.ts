import { createHash, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { KVStore, RuntimeStore } from '@openmaic/storage';
import type { PBLProjectV2 } from '@/lib/pbl/v2/types';
import { resolvePBLContent, upgradeLegacyPBLConfigToProjectV2 } from '@/lib/pbl/legacy/read';
import {
  hydratePBLProjectFromRuntime,
  synchronizePBLProjectRuntime,
} from '@/lib/pbl/v2/runtime/hydration';
import { extractLearnerState } from '@/lib/pbl/v2/runtime/learner-state';
import { prepareWorkspaceLaunchProject } from '@/lib/pbl/v2/operations/runtime/workspace-launch';
import {
  normalizeProjectRuntime,
  currentMicrotask,
  PBL_SIMULATOR_AGENT_ID,
} from '@/lib/pbl/v2/operations/kernel/progress';
import {
  appendRuntimeEvent,
  mintRuntimeEventId,
} from '@/lib/pbl/v2/operations/kernel/runtime-events';
import { addSubmission } from '@/lib/pbl/v2/operations/runtime/submission';
import {
  taskEvaluationCanComplete,
  recordPendingTaskCompletionEvidence,
  setPendingTaskCompletion,
  appendTaskCompletionReadyMessage,
} from '@/lib/pbl/v2/operations/kernel/task-completion';
import { stripEmbeddedDividerMarkers } from '@/lib/pbl/v2/runtime/protocol-markers';
import { POST as openTask } from '@/app/api/pbl/v2/open-task/route';
import { POST as instructor } from '@/app/api/pbl/v2/instructor/route';
import { POST as simulator } from '@/app/api/pbl/v2/simulator/route';
import { POST as evaluate } from '@/app/api/pbl/v2/evaluate/route';
import { POST as taskUpdate } from '@/app/api/pbl/v2/task/update/route';
import { collectPBLResponse } from './stream';
import { NativeError } from './store';
export function revision(project: PBLProjectV2) {
  return createHash('sha256')
    .update(JSON.stringify(extractLearnerState(project)))
    .digest('hex');
}
export function pblContext(
  stageId: string,
  sceneId: string,
  learnerKey: string,
  store: RuntimeStore,
) {
  // Request-local drain bookkeeping only. All learner records live in PostgreSQL.
  const values = new Map<string, unknown>();
  const kv: KVStore = {
    async get<T>(key: string) {
      return (values.get(key) as T) ?? null;
    },
    async set(key, value) {
      values.set(key, value);
    },
    async remove(key) {
      values.delete(key);
    },
    async keys() {
      return [...values.keys()];
    },
  };
  return { stageId, sceneId, learnerKey, store, kv };
}
export async function loadPBL(
  content: { projectV2?: unknown; projectConfig?: unknown },
  context: ReturnType<typeof pblContext>,
) {
  const resolved = resolvePBLContent(content);
  if (resolved.kind === 'empty') throw new NativeError('此课程尚未生成 PBL 任务', 422);
  const template =
    resolved.kind === 'v2'
      ? resolved.projectV2
      : upgradeLegacyPBLConfigToProjectV2(resolved.projectConfig);
  return (await hydratePBLProjectFromRuntime({ ...context, project: structuredClone(template) }))
    .project;
}
export function pblView(project: PBLProjectV2) {
  const current = currentMicrotask(project);
  return {
    type: 'pbl',
    revision: revision(project),
    title: project.title,
    description: project.description,
    status: project.status,
    phase: project.uiPhase,
    currentTaskId: current?.microtask.id,
    pendingTaskCompletion: !!project.pendingTaskCompletion,
    pendingHandover: !!project.pendingHandover,
    milestones: project.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      status: m.status,
      briefing: m.briefing || m.description || '',
      scenarioStage: m.scenarioStage || '',
      documents: (m.documents || []).map((d) => ({ id: d.id, title: d.title, content: d.content })),
      tasks: m.microtasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.learnerBrief || t.description,
        hints: t.hints || [],
        status: t.status,
      })),
    })),
    messages: project.threads
      .flatMap((t) =>
        t.messages.map((m) => ({
          id: m.id,
          role:
            m.roleType === 'user'
              ? '我'
              : t.agentId === PBL_SIMULATOR_AGENT_ID
                ? '情境角色'
                : '导师',
          content: stripEmbeddedDividerMarkers(m.content),
          ts: m.ts,
        })),
      )
      .sort((a, b) => a.ts.localeCompare(b.ts))
      .slice(-40),
    submissions: project.submissions
      .slice(-8)
      .map((s) => ({ id: s.id, content: s.content, microtaskId: s.microtaskId })),
    evaluations: project.evaluations
      .slice(-5)
      .map((e) => ({ id: e.id, kind: e.kind, score: e.score, feedback: e.feedback })),
  };
}
export async function runPBL(
  req: NextRequest,
  project: PBLProjectV2,
  body: Record<string, unknown>,
  save: (p: PBLProjectV2) => Promise<PBLProjectV2>,
) {
  const action = body.action;
  if (
    ![
      'open',
      'message',
      'submit',
      'evaluate',
      'start',
      'continue_handover',
      'enter_scenario',
      'complete_act',
      'complete_pending_task',
      'milestone',
      'final',
    ].includes(String(action))
  )
    throw new NativeError('未知 PBL 操作');
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length > 12000) throw new NativeError('输入不能超过 12000 字');
  project = prepareWorkspaceLaunchProject(project, []);
  normalizeProjectRuntime(project);
  const current = currentMicrotask(project);
  const headers = new Headers(req.headers);
  headers.delete('content-length');
  headers.set('Content-Type', 'application/json');
  const call = (handler: (req: NextRequest) => Promise<Response>, data: object) =>
    handler(
      new NextRequest(req.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
        signal: AbortSignal.any([req.signal, AbortSignal.timeout(110000)]),
      }),
    );
  if (
    [
      'start',
      'continue_handover',
      'enter_scenario',
      'complete_act',
      'complete_pending_task',
    ].includes(String(action))
  ) {
    const result = await call(taskUpdate, { project, action, microtaskId: body.microtaskId });
    const data = await result.json();
    if (!result.ok || !data.success) throw new NativeError(data.error || '任务操作失败');
    return data.project as PBLProjectV2;
  }
  if (action === 'message') {
    if (!text || !current) throw new NativeError('请先开始任务并输入消息');
    const agentId =
      body.channel === 'simulator'
        ? PBL_SIMULATOR_AGENT_ID
        : project.roles.find((r) => r.type === 'instructor')?.id;
    const thread = project.threads.find((t) => t.agentId === agentId);
    if (!thread) throw new NativeError('请先打开导师或情境对话');
    const message = {
      id: randomUUID(),
      roleType: 'user' as const,
      content: text,
      ts: new Date().toISOString(),
      microtaskId: current.microtask.id,
    };
    thread.messages.push(message);
    appendRuntimeEvent(project, {
      id: mintRuntimeEventId(),
      kind: 'message_created',
      actorType: 'user',
      messageId: message.id,
      threadId: thread.agentId,
      ts: message.ts,
      microtaskId: current.microtask.id,
      milestoneId: current.milestone.id,
    });
    project = await save(project); // Keep learner input even if the provider fails.
    return collectPBLResponse(
      await call(body.channel === 'simulator' ? simulator : instructor, {
        project,
        userMessage: text,
        phase: 'instructing',
      }),
      project,
    );
  }
  if (action === 'open')
    return collectPBLResponse(
      await call(openTask, {
        project,
        phase: project.threads.some((t) => t.messages.length) ? 'setup' : 'greeting',
      }),
      project,
    );
  if (!current && !['final'].includes(String(action))) throw new NativeError('没有正在进行的任务');
  if (action === 'submit') {
    if (!text) throw new NativeError('请输入任务成果');
    addSubmission(project, {
      microtaskId: current!.microtask.id,
      milestoneId: current!.milestone.id,
      kind: 'text',
      content: text,
    });
    project = await save(project);
  }
  if (
    (action === 'submit' || action === 'evaluate') &&
    !project.submissions.some((s) => s.microtaskId === current!.microtask.id)
  )
    throw new NativeError('请先提交任务成果');
  const kind = action === 'final' ? 'final' : action === 'milestone' ? 'milestone' : 'task';
  project = await collectPBLResponse(
    await call(evaluate, {
      project,
      kind,
      microtaskId: current?.microtask.id,
      milestoneId: current?.milestone.id,
    }),
    project,
  );
  if (kind === 'task') {
    const evaluation = project.evaluations
      .filter((e) => e.kind === 'task' && e.microtaskId === current!.microtask.id)
      .at(-1);
    if (taskEvaluationCanComplete(evaluation)) {
      const evidence = {
        path: 'submission_passed' as const,
        signature: 'submission_passed_' + current!.microtask.id,
        label: current!.microtask.title,
        note: '提交成果通过任务评阅',
      };
      recordPendingTaskCompletionEvidence(
        project,
        currentMicrotask(project)!.milestone,
        currentMicrotask(project)!.microtask,
        evidence,
      );
      setPendingTaskCompletion(project, {
        microtaskId: current!.microtask.id,
        milestoneId: current!.milestone.id,
        reason: evidence.note,
        evidence,
      });
      appendTaskCompletionReadyMessage(project, current!.microtask.id, {
        afterTs: evaluation?.createdAt,
      });
    }
  }
  return project;
}
export { synchronizePBLProjectRuntime };
