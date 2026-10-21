import type { NextRequest } from 'next/server';
import { isSameOriginJsonRequest } from '@/lib/persistence/owner-claim-http';
import { consumeTransfer } from '@/lib/server/identity/miniapp-transfer';
export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  if (!req.headers.get('origin') || !isSameOriginJsonRequest(req))
    return Response.json({ error: 'Invalid origin' }, { status: 403, headers });
  let token;
  try {
    token = (await req.json()).token;
  } catch {
    /* rejected below */
  }
  const grant =
    typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) ? consumeTransfer(token) : null;
  if (!grant)
    return Response.json(
      { error: 'Launch expired; return to the mini program and retry' },
      { status: 410, headers },
    );
  for (const cookie of grant.cookies) headers.append('Set-Cookie', cookie);
  return Response.json({ href: grant.href }, { headers });
}
