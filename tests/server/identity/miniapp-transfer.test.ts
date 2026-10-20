import { afterEach, expect, it, vi } from 'vitest';
import {
  issueTransfer,
  consumeTransfer,
  transferableCookies,
} from '@/lib/server/identity/miniapp-transfer';
import { resetOwnerAuthenticationForTests } from '@/lib/server/identity/registry';
import { POST } from '@/app/miniapp/session/route';
import { NextRequest } from 'next/server';
const grant = {
  ownerId: 'test-mobile',
  cookies: ['anonymous_id=example; Path=/; HttpOnly; SameSite=Lax'],
  href: '/miniapp/classroom/test?scene=a',
};
afterEach(() => {
  vi.unstubAllEnvs();
  resetOwnerAuthenticationForTests();
});
it('issues opaque single-use tickets; expiry and newer launches invalidate the old ticket', () => {
  const first = issueTransfer(grant, 100);
  expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const second = issueTransfer(grant, 200);
  expect(consumeTransfer(first, 201)).toBeNull();
  expect(consumeTransfer(second, 202)?.href).toBe(grant.href);
  expect(consumeTransfer(second, 203)).toBeNull();
  const expired = issueTransfer(grant, 100);
  expect(consumeTransfer(expired, 60100)).toBeNull();
});
it('transfers only credentials that resolve to the same owner; never arbitrary cookies', async () => {
  vi.stubEnv('COOKIE_SECURE', 'false');
  const uuid = 'a652e716-0e2e-47f5-8432-4ee60f6f0977';
  const headers = new Headers({ cookie: `theme=secret; unrelated=session; anonymous_id=${uuid}` });
  const cookies = await transferableCookies(headers, `anon:${uuid}`);
  expect(cookies).toEqual([
    expect.stringContaining(`anonymous_id=${uuid}; Path=/; HttpOnly; SameSite=Lax`),
  ]);
  expect(await transferableCookies(headers, 'different-owner')).toBeNull();
});
it('rejects cross-origin redemption without consuming a valid ticket, then sets HttpOnly cookies once', async () => {
  const token = issueTransfer(grant);
  const request = (origin: string) =>
    new NextRequest('http://localhost:3000/miniapp/session', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  expect((await POST(request('https://other.example'))).status).toBe(403);
  const response = await POST(request('http://localhost:3000'));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  expect(await response.json()).toEqual({ href: grant.href });
  expect((await POST(request('http://localhost:3000'))).status).toBe(410);
});

it('accepts the public host when standalone normalizes the internal request URL', async () => {
  const token = issueTransfer(grant);
  const request = new NextRequest('http://localhost:3000/miniapp/session', {
    method: 'POST',
    headers: {
      origin: 'http://127.0.0.1:3000',
      host: '127.0.0.1:3000',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ token }),
  });
  expect((await POST(request)).status).toBe(200);
});
