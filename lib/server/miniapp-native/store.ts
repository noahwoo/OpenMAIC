import type { Pool } from 'pg';
import { withSchemaBootstrapLock } from '@/lib/persistence/schema-bootstrap-lock';
let ready: Promise<void> | undefined;
export async function ensureNativeModules(pool: Pool): Promise<void> {
  ready ??= withSchemaBootstrapLock(pool, async (db) => {
    await db.query(`CREATE TABLE IF NOT EXISTS miniapp_native_modules (
      stage_id TEXT NOT NULL, scene_id TEXT NOT NULL, source_hash TEXT NOT NULL,
      spec JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(stage_id, scene_id),
      FOREIGN KEY(stage_id, scene_id) REFERENCES document_scenes(stage_id, id) ON DELETE CASCADE
    )`);
  }).catch((error) => {
    ready = undefined;
    throw error;
  });
  await ready;
}
export async function loadNativeModule(
  pool: Pool,
  stageId: string,
  sceneId: string,
  hash: string,
): Promise<unknown | null> {
  await ensureNativeModules(pool);
  const result = await pool.query(
    'SELECT spec FROM miniapp_native_modules WHERE stage_id=$1 AND scene_id=$2 AND source_hash=$3',
    [stageId, sceneId, hash],
  );
  return result.rows[0]?.spec ?? null;
}
export async function saveNativeModule(
  pool: Pool,
  stageId: string,
  sceneId: string,
  hash: string,
  spec: unknown,
): Promise<void> {
  await ensureNativeModules(pool);
  await pool.query(
    `INSERT INTO miniapp_native_modules(stage_id,scene_id,source_hash,spec) VALUES($1,$2,$3,$4)
    ON CONFLICT(stage_id,scene_id) DO UPDATE SET source_hash=excluded.source_hash,spec=excluded.spec,updated_at=now()`,
    [stageId, sceneId, hash, JSON.stringify(spec)],
  );
}
export class NativeError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
/** Native commands serialize across instances. No lock is held by the shared pool after return. */
export async function nativeLock<T>(pool: Pool, key: string, run: () => Promise<T>): Promise<T> {
  const connection = await pool.connect();
  let locked = false;
  try {
    const result = await connection.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [
      key,
    ]);
    locked = result.rows[0]?.locked === true;
    if (!locked) throw new NativeError('当前活动正在处理中，请稍后刷新', 409);
    return await run();
  } finally {
    try {
      if (locked) await connection.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
    } finally {
      connection.release();
    }
  }
}
