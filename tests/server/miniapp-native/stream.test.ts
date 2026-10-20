import { describe, it, expect } from 'vitest';
import { collectPBLResponse } from '@/lib/server/miniapp-native/stream';
import { createSSEResponse } from '@/lib/pbl/v2/api/sse';
import type { PBLProjectV2 } from '@/lib/pbl/v2/types';
function response(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    }),
  );
}
describe('native PBL SSE terminal handling', () => {
  it('consumes the actual PBL encoder with event names outside the JSON payload', async () => {
    const project = {} as PBLProjectV2;
    const response = createSSEResponse(
      (async function* () {
        yield { type: 'token' as const, delta: '你好' };
        yield { type: 'done' as const };
      })(),
    );
    expect(await collectPBLResponse(response, project)).toBe(project);
  });
  it('handles split UTF8, CRLF and ignores uncommitted tokens', async () => {
    const project = {} as PBLProjectV2;
    expect(
      await collectPBLResponse(
        response('data: {"type":"token","delta":"你好"}\r\n\r\ndata: {"type":"done"}\r\n\r\n'),
        project,
      ),
    ).toBe(project);
  });
  it('refuses an HTTP200 stream without its done event', async () => {
    await expect(
      collectPBLResponse(
        response('data: {"type":"token","delta":"draft"}\n\n'),
        {} as PBLProjectV2,
      ),
    ).rejects.toThrow('中断');
  });
  it('does not treat a provider error inside HTTP200 as success', async () => {
    await expect(
      collectPBLResponse(
        response('data: {"type":"error","message":"失败"}\n\n'),
        {} as PBLProjectV2,
      ),
    ).rejects.toThrow('失败');
  });
});
