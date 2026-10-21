import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Scene } from '@/lib/types/stage';
const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@/lib/ai/llm', () => ({
  streamLLM: (...args: unknown[]) => {
    const result = Promise.resolve(mocks.call(...args));
    return {
      fullStream: (async function* () {
        const value = await result;
        yield { type: 'text-delta', text: value.text };
      })(),
      finishReason: result.then((value) => value.reason || 'stop'),
    };
  },
}));
vi.mock('@/lib/server/resolve-model', () => ({
  resolveModelFromRequest: async () => ({ model: 'test', serverManaged: true }),
}));
import { generateNativeSpec, nativeSourceHash } from '@/lib/server/miniapp-native/generate';
const scene = {
  title: '实验',
  content: { type: 'interactive', html: '<html>教学材料</html>' },
  actions: [],
} as unknown as Scene;
const request = () => new NextRequest('http://localhost/api/miniapp/native/stage/scene');
const ready = {
  version: 1,
  status: 'ready',
  title: '单摆',
  summary: '小角度近似',
  parameters: [{ id: 'length', label: '摆长', min: 0.1, max: 3, step: 0.1, value: 1 }],
  outputs: [
    {
      id: 'period',
      label: '周期',
      expression: {
        op: 'mul',
        args: [6.283185307, { op: 'sqrt', args: [{ op: 'div', args: [{ var: 'length' }, 9.8] }] }],
      },
    },
  ],
  elements: [],
  steps: [
    { title: '短摆', description: '观察', values: { length: 1 } },
    { title: '长摆', description: '比较', values: { length: 3 } },
  ],
};
beforeEach(() => mocks.call.mockReset());
describe('native model output validation', () => {
  it('retries truncated JSON with corrective feedback instead of accepting a partial spec', async () => {
    mocks.call
      .mockResolvedValueOnce({ text: '{"version":1,"status":"ready","parameters":[{"id":"length"' })
      .mockResolvedValueOnce({ text: JSON.stringify(ready) });
    expect(await generateNativeSpec(request(), scene)).toEqual(ready);
    expect(mocks.call).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mocks.call.mock.calls[1][0].prompt).correction).toContain(
      '上次转换未通过校验',
    );
  });
  it('rejects an incomplete stream finish even when its JSON looks valid', async () => {
    mocks.call
      .mockResolvedValueOnce({ text: JSON.stringify(ready), reason: 'other' })
      .mockResolvedValueOnce({ text: JSON.stringify(ready), reason: 'stop' });
    expect(await generateNativeSpec(request(), scene)).toEqual(ready);
    expect(mocks.call).toHaveBeenCalledTimes(2);
  });
  it('bounds retries for repeated truncated provider output', async () => {
    mocks.call.mockResolvedValue({ text: '{"version":1', reason: 'length' });
    await expect(generateNativeSpec(request(), scene)).rejects.toThrow('未完整结束');
    expect(mocks.call).toHaveBeenCalledTimes(2);
  });
  it('does not start a conversion after the client cancels it', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      generateNativeSpec(
        new NextRequest('http://localhost/api/native', { signal: controller.signal }),
        scene,
      ),
    ).rejects.toThrow();
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('refuses executable model text', async () => {
    mocks.call.mockResolvedValue({ text: 'process.exit()' });
    await expect(generateNativeSpec(request(), scene)).rejects.toThrow('有效的原生模拟');
  });
  it('preserves an explicit unsupported result rather than inventing a substitute', async () => {
    mocks.call.mockResolvedValue({
      text: '{"version":1,"status":"unsupported","reason":"缺少碰撞约束求解能力"}',
    });
    expect(await generateNativeSpec(request(), scene)).toMatchObject({
      status: 'unsupported',
      reason: '缺少碰撞约束求解能力',
    });
  });
  it('does not fetch external simulations or guess their behavior', async () => {
    expect(
      await generateNativeSpec(request(), {
        ...scene,
        content: { type: 'interactive', url: 'https://example.com' },
      } as Scene),
    ).toMatchObject({ status: 'unsupported' });
  });
  it('invalidates generated cache on source changes', () => {
    expect(nativeSourceHash(scene)).not.toBe(nativeSourceHash({ ...scene, title: 'new' }));
  });
});
