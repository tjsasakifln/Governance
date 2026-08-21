import type pg from "pg";
import type { CollectorName } from "./run.ts";

export function collectorLockKey(collector: CollectorName): string {
  return `cc:collector-lock:${collector}`;
}

export async function trySourceLock(client: pg.PoolClient, collector: CollectorName): Promise<boolean> {
  const result = await client.query<{ ok: boolean }>(
    `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS ok`,
    [collectorLockKey(collector)],
  );
  return result.rows[0]?.ok === true;
}

export async function unlockSource(client: pg.PoolClient, collector: CollectorName): Promise<void> {
  await client.query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [collectorLockKey(collector)]);
}
