import type { NextRequest } from 'next/server';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { readStageMeta } from '@/lib/persistence/stage-meta';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { issueTransfer, transferableCookies } from '@/lib/server/identity/miniapp-transfer';
export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  return withRequestOwner(req, async ({ ownerId }, headers) => {
    headers.set('Cache-Control', 'no-store');
    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400, headers });
    }
    if (typeof body?.stageId !== 'string' || typeof body?.sceneId !== 'string')
      return Response.json({ error: 'stageId and sceneId required' }, { status: 400, headers });
    const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
    const meta = await readStageMeta(pool, body.stageId);
    if (!meta || meta.deletedAt || meta.ownerId !== ownerId)
      return Response.json({ error: 'Course or scene unavailable' }, { status: 404, headers });
    const store = await getOwnerScopedDocumentStore(ownerId);
    const doc = await store.loadDocument(body.stageId);
    if (!doc || !doc.scenes.some((scene) => scene.id === body.sceneId))
      return Response.json({ error: 'Course or scene unavailable' }, { status: 404, headers });
    const cookies = await transferableCookies(req.headers, ownerId);
    if (!cookies)
      return Response.json(
        { error: 'Host SSO requires a browser login; cookie transfer is unavailable' },
        { status: 409, headers },
      );
    const href = `/miniapp/classroom/${encodeURIComponent(body.stageId)}?scene=${encodeURIComponent(body.sceneId)}`;
    const token = issueTransfer({ ownerId, cookies, href });
    return Response.json({ path: `/miniapp#${token}`, expiresIn: 60 }, { headers });
  });
}
