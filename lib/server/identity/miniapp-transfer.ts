import { randomBytes } from 'node:crypto';
import { resolveRequestOwner } from './resolve';
import { cookiesAreSecure } from '@/lib/server/cookie-secure';

interface Grant {
  ownerId: string;
  cookies: string[];
  href: string;
  expires: number;
}
// Process-local, short-lived and single-use. Restart/multi-instance misses require a fresh launch.
const key = Symbol.for('openmaic.miniapp.transfers');
const state = globalThis as typeof globalThis & { [key: symbol]: Map<string, Grant> | undefined };
const grants = (state[key] ??= new Map<string, Grant>());
export function issueTransfer(grant: Omit<Grant, 'expires'>, now = Date.now()): string {
  for (const [token, value] of grants)
    if (value.expires <= now || value.ownerId === grant.ownerId) grants.delete(token);
  if (grants.size >= 1000) throw new Error('Too many pending mini-program launches');
  const token = randomBytes(32).toString('base64url');
  grants.set(token, { ...grant, expires: now + 60_000 });
  return token;
}
export function consumeTransfer(token: string, now = Date.now()): Grant | null {
  const grant = grants.get(token);
  grants.delete(token);
  return grant && grant.expires > now ? grant : null;
}
/** Only built-in cookie credentials cross the WebView boundary. Host SSO must supply its own login. */
export async function transferableCookies(
  headers: Headers,
  ownerId: string,
): Promise<string[] | null> {
  const pairs = (headers.get('cookie') ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => /^(anonymous_id|openmaic_access)=/.test(s));
  const cookieHeaders = new Headers({ cookie: pairs.join('; ') });
  const resolved = await resolveRequestOwner({ headers: cookieHeaders });
  if (!resolved.ok || resolved.principal.ownerId !== ownerId) return null;
  const secure = cookiesAreSecure() ? '; Secure' : '';
  return pairs.map((pair) => `${pair}; Path=/; HttpOnly; SameSite=Lax${secure}`);
}
