import { createHash } from 'node:crypto';
import type { Scene } from '@/lib/types/stage';

export function nativeSourceHash(scene: Scene): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        title: scene.title,
        content: scene.content,
        speech: (scene.actions ?? []).filter((a) => a.type === 'speech').map((a) => a.text),
      }),
    )
    .digest('hex');
}
