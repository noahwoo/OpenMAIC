import type { PBLProjectV2 } from '@/lib/pbl/v2/types';
import type { PBLSSEEvent } from '@/lib/pbl/v2/api/sse';
import { applyInstructorEvent } from '@/lib/pbl/v2/runtime/apply-instructor-event';
import { NativeError } from './store';
/** Consume only the existing typed PBL event protocol; tokens never become committed messages. */
export async function collectPBLResponse(
  response: Response,
  project: PBLProjectV2,
): Promise<PBLProjectV2> {
  if (!response.ok || !response.body)
    throw new NativeError('PBL 服务未完成请求（' + response.status + '）', 502);
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    bytes = 0,
    doneEvent = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2_000_000) throw new NativeError('PBL 响应过大', 502);
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!data) continue;
        const payload = JSON.parse(data);
        const type = frame
          .split('\n')
          .find((line) => line.startsWith('event:'))
          ?.slice(6)
          .trim();
        const event = { ...payload, type: type || payload.type } as PBLSSEEvent;
        if (event.type === 'error')
          throw new NativeError('PBL 操作失败：' + String(event.message).slice(0, 300), 502);
        if (event.type === 'done') doneEvent = true;
        project = applyInstructorEvent(event, project, () => {});
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (!doneEvent) throw new NativeError('PBL 响应中断，刷新状态后重试', 502);
  return project;
}
