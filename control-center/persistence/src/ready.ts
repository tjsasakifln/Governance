import type pg from 'pg';
import { MIGRATIONS, appliedMigrations } from './migrate.js';

export const EXPECTED_MIGRATION_IDS = MIGRATIONS.map((item) => item.id);

export async function expectedMigrationsPresent(db: pg.Pool | pg.PoolClient): Promise<boolean> {
  const applied = await appliedMigrations(db);
  return EXPECTED_MIGRATION_IDS.every((id) => applied.includes(id));
}

export async function pingStore(db: pg.Pool | pg.PoolClient): Promise<void> {
  await db.query('SELECT 1 FROM control_center.v_latest_collector_runs LIMIT 1');
  await db.query('SELECT 1 FROM control_center.v_latest_source_observations LIMIT 1');
  await db.query('SELECT 1 FROM control_center.v_latest_operational_snapshots LIMIT 1');
}
