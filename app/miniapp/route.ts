import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import en from '@/lib/i18n/locales/en-US.json';
import zh from '@/lib/i18n/locales/zh-CN.json';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** No React root or bootstrap requests may run until the owner cookies are installed. */
export function GET(req: NextRequest) {
  const labels = (req.headers.get('accept-language') ?? '').startsWith('zh')
    ? zh.miniapp
    : en.miniapp;
  const nonce = randomBytes(24).toString('base64');
  const failure = JSON.stringify(labels.launchFailed).replace(/</g, '\\u003c');
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>OpenMAIC</title><style nonce="${nonce}">body{font:16px system-ui;padding:32px;text-align:center}</style></head><body><p id="status" role="status">${labels.connecting}</p><script nonce="${nonce}">
(async function(){
 const token=location.hash.slice(1);
 history.replaceState(null,'','/miniapp');
 try {
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('ticket');
  const response=await fetch('/miniapp/session',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
  if(!response.ok)throw new Error('exchange');
  const result=await response.json();
  if(typeof result.href!=='string'||!result.href.startsWith('/miniapp/classroom/'))throw new Error('destination');
  location.replace(result.href);
 }catch(_){document.getElementById('status').textContent=${failure};}
})();</script></body></html>`;
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'`,
    },
  });
}
