import { NextRequest } from 'next/server';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { guardedServerRuntimeStore } from '@/lib/persistence/runtime-tombstone-guard';
import { readStageMeta } from '@/lib/persistence/stage-meta';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import {
  NativeError,
  nativeLock,
  loadNativeModule,
  saveNativeModule,
} from '@/lib/server/miniapp-native/store';
import { nativeSourceHash, generateNativeSpec } from '@/lib/server/miniapp-native/generate';
import {
  loadPBL,
  pblContext,
  pblView,
  revision,
  runPBL,
  synchronizePBLProjectRuntime,
} from '@/lib/server/miniapp-native/pbl';
export const runtime = 'nodejs';
type Context = { params: Promise<{ stageId: string; sceneId: string }> };
async function handle(req: NextRequest, ctx: Context, mutate: boolean) {
  return withRequestOwner(req, async ({ ownerId }, headers) => {
    headers.set('Cache-Control', 'no-store');
    try {
      const { stageId, sceneId } = await ctx.params;
      const provider = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
      const { pool } = provider;
      async function scene() {
        const meta = await readStageMeta(pool, stageId);
        if (!meta || meta.deletedAt || meta.ownerId !== ownerId)
          throw new NativeError('课程不存在或无访问权限', 404);
        const doc = await (await getOwnerScopedDocumentStore(ownerId)).loadDocument(stageId);
        const found = doc?.scenes.find((s) => s.id === sceneId);
        if (!found) throw new NativeError('课程场景不存在', 404);
        return found;
      }
      const initial = await scene();
      let body: Record<string, unknown> = {};
      if (mutate) {
        const text = await req.text();
        if (text.length > 64000) throw new NativeError('请求过大', 413);
        try {
          body = JSON.parse(text);
        } catch {
          throw new NativeError('请求必须为有效 JSON');
        }
        if (!body || typeof body !== 'object' || Array.isArray(body))
          throw new NativeError('请求必须为对象');
      }
      async function work() {
        const current = await scene();
        if (current.content.type === 'interactive') {
          const hash = nativeSourceHash(current);
          let spec = await loadNativeModule(pool, stageId, sceneId, hash);
          if (!spec && mutate) {
            if (body.action !== 'generate') throw new NativeError('未知模拟操作');
            spec = await generateNativeSpec(req, current);
            if (nativeSourceHash(await scene()) !== hash)
              throw new NativeError('课程已修改，请刷新后重新生成', 409);
            await saveNativeModule(pool, stageId, sceneId, hash, spec);
          }
          return { type: 'simulation', title: current.title, spec, needsGeneration: !spec };
        }
        if (current.content.type === 'pbl') {
          const context = pblContext(
            stageId,
            sceneId,
            ownerId,
            guardedServerRuntimeStore(provider.runtimeStore, pool),
          );
          let project = await loadPBL(current.content, context);
          if (mutate) {
            if (body.revision !== revision(project))
              throw new NativeError('学习进度已变化，请刷新后重试', 409);
            let baseline = revision(project);
            const save = async (next: typeof project) => {
              const fresh = await scene();
              if (
                fresh.content.type !== 'pbl' ||
                revision(await loadPBL(fresh.content, context)) !== baseline
              )
                throw new NativeError('其他窗口已修改进度，请刷新', 409);
              await synchronizePBLProjectRuntime({ ...context, project: next });
              const persisted = await loadPBL(fresh.content, context);
              baseline = revision(persisted);
              return persisted;
            };
            project = await runPBL(req, project, body, save);
            project = await save(project);
          }
          return pblView(project);
        }
        const actions = (current.actions ?? []).filter(
          (a) => a.type.startsWith('wb_') || a.type === 'speech',
        );
        if (!actions.some((a) => a.type.startsWith('wb_')))
          throw new NativeError('此场景没有原生交互或白板动作', 422);
        if (actions.length > 500 || JSON.stringify(actions).length > 500000)
          throw new NativeError('白板动作过多，请拆分课程', 422);
        return { type: 'whiteboard', title: current.title, actions };
      }
      const data = mutate
        ? await nativeLock(pool, `native:${ownerId}:${stageId}:${sceneId}`, work)
        : await work();
      return Response.json(data, { headers });
    } catch (error) {
      const known = error instanceof NativeError;
      if (known && error.status >= 500)
        console.warn('[miniapp-native]', {
          path: req.nextUrl.pathname,
          status: error.status,
          message: error.message,
        });
      if (!known)
        console.error('[miniapp-native]', error instanceof Error ? error.message : 'Unknown error');
      return Response.json(
        { error: known ? error.message : '原生活动请求失败，请稍后重试' },
        { status: known ? error.status : 500, headers },
      );
    }
  });
}
export const GET = (req: NextRequest, ctx: Context) => handle(req, ctx, false);
export const POST = (req: NextRequest, ctx: Context) => handle(req, ctx, true);
