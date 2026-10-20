import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Scene } from '@/lib/types/stage';
const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@/lib/ai/llm', () => ({
  streamLLM: (...args: unknown[]) => ({
    fullStream: (async function* () {
      const result = await mocks.call(...args);
      yield { type: 'text-delta', text: result.text };
    })(),
    finishReason: Promise.resolve('stop'),
  }),
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
describe('native model output validation', () => {
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
