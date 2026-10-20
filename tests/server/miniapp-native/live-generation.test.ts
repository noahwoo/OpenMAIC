import { it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { generateNativeSpec } from '@/lib/server/miniapp-native/generate';
import { standaloneFixtureScenes } from '@/tests/fixtures/standalone-html-classroom';
import { calculate } from '@/apps/wechat-miniprogram/miniprogram/utils/native-spec';
it.skipIf(process.env.OPENMAIC_NATIVE_LIVE !== '1')(
  'configured live model generates a useful native light experiment',
  async () => {
    const scene = standaloneFixtureScenes('native-live').find((s) => s.type === 'interactive')!;
    const spec = (await generateNativeSpec(
      new NextRequest('http://localhost/api/miniapp/native/live/scene'),
      scene,
    )) as Parameters<typeof calculate>[0];
    expect(spec.status).toBe('ready');
    const initial = calculate(spec, {}, 0),
      parameter = spec.parameters[0],
      changed = calculate(spec, { [parameter.id]: parameter.max }, 0);
    expect(changed.outputs.map((o) => o.value)).not.toEqual(initial.outputs.map((o) => o.value));
    console.log(
      'Live native simulation verified:',
      spec.title,
      spec.parameters.length,
      'parameters,',
      spec.steps.length,
      'steps',
    );
  },
  90000,
);
