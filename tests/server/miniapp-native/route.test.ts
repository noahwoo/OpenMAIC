import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mock = vi.hoisted(() => ({
  owner: 'owner',
  meta: { ownerId: 'owner', deletedAt: null } as unknown,
  scene: {
    id: 'scene',
    title: '实验',
    content: { type: 'interactive', html: '<html>lab</html>' },
    actions: [],
  } as unknown,
  spec: null as unknown,
  revision: 'r1',
}));
vi.mock('@/lib/server/identity/with-owner', () => ({
  withRequestOwner: (_req: unknown, work: Function) => work({ ownerId: mock.owner }, new Headers()),
}));
vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({ pool: {}, runtimeStore: {} }),
}));
vi.mock('@/lib/persistence/runtime-tombstone-guard', () => ({
  guardedServerRuntimeStore: () => ({}),
}));
vi.mock('@/lib/persistence/stage-meta', () => ({ readStageMeta: async () => mock.meta }));
vi.mock('@/lib/server/agent-runtime/owner-scoped-documents', () => ({
  getOwnerScopedDocumentStore: async () => ({
    loadDocument: async () => ({ scenes: [mock.scene] }),
  }),
}));
vi.mock('@/lib/server/miniapp-native/store', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/server/miniapp-native/store')>();
  return {
    ...real,
    nativeLock: async (_p: unknown, _k: unknown, run: Function) => run(),
    loadNativeModule: async () => mock.spec,
    saveNativeModule: async (
      _p: unknown,
      _s: unknown,
      _id: unknown,
      _h: unknown,
      spec: unknown,
    ) => {
      mock.spec = spec;
    },
  };
});
vi.mock('@/lib/server/miniapp-native/generate', () => ({
  nativeSourceHash: () => 'hash',
  generateNativeSpec: async () => ({ version: 1, status: 'unsupported', reason: 'test' }),
}));
vi.mock('@/lib/server/miniapp-native/pbl', () => ({
  pblContext: () => ({}),
  loadPBL: async () => ({ revision: mock.revision }),
  revision: (project: { revision: string }) => project.revision,
  pblView: (project: { revision: string }) => ({ type: 'pbl', revision: project.revision }),
  runPBL: async (_req: unknown, project: unknown) => project,
  synchronizePBLProjectRuntime: async () => {
    mock.revision = 'persisted';
  },
}));
import { GET, POST } from '@/app/api/miniapp/native/[stageId]/[sceneId]/route';
const ctx = { params: Promise.resolve({ stageId: 'stage', sceneId: 'scene' }) };
function request(body?: object) {
  return new NextRequest(
    'http://localhost/api/miniapp/native/stage/scene',
    body ? { method: 'POST', body: JSON.stringify(body) } : undefined,
  );
}
beforeEach(() => {
  mock.owner = 'owner';
  mock.meta = { ownerId: 'owner', deletedAt: null };
  mock.scene = {
    id: 'scene',
    title: '实验',
    content: { type: 'interactive', html: 'lab' },
    actions: [],
  };
  mock.spec = null;
  mock.revision = 'r1';
});
describe('native owner boundary and command contract', () => {
  it('returns the normalized persisted revision for the next command', async () => {
    mock.scene = { id: 'scene', title: '项目', content: { type: 'pbl' }, actions: [] };
    const result = await (await POST(request({ action: 'open', revision: 'r1' }), ctx)).json();
    expect(result.revision).toBe('persisted');
    expect((await (await GET(request(), ctx)).json()).revision).toBe(result.revision);
  });
  it('refuses a nonowner even when document loading would succeed', async () => {
    mock.owner = 'other';
    expect((await GET(request(), ctx)).status).toBe(404);
  });
  it('refuses tombstoned courses', async () => {
    mock.meta = { ownerId: 'owner', deletedAt: new Date() };
    expect((await GET(request(), ctx)).status).toBe(404);
  });
  it('GET never calls a model and POST caches only native data', async () => {
    const initial = await (await GET(request(), ctx)).json();
    expect(initial.needsGeneration).toBe(true);
    expect(initial.html).toBeUndefined();
    const result = await POST(request({ action: 'generate' }), ctx);
    expect(result.status).toBe(200);
    expect((await (await GET(request(), ctx)).json()).needsGeneration).toBe(false);
  });
  it('rejects stale PBL commands without accepting client project data', async () => {
    mock.scene = { id: 'scene', title: '项目', content: { type: 'pbl' }, actions: [] };
    expect(
      (
        await POST(
          request({ action: 'message', revision: 'stale', project: { status: 'completed' } }),
          ctx,
        )
      ).status,
    ).toBe(409);
  });
});
