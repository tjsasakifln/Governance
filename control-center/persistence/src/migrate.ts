import type pg from 'pg';
import type { Queryable } from './db.js';
import { logEvent } from './log.js';
import { readSql } from './sql-files.js';
import { splitSqlStatements } from './sql-split.js';

export const MIGRATIONS = [
  { id: '001_init', up: 'sql/migrations/001_init.up.sql', down: 'sql/migrations/001_init.down.sql' },
  {
    id: '002_current_state',
    up: 'sql/migrations/002_current_state.up.sql',
    down: 'sql/migrations/002_current_state.down.sql',
  },
  {
    id: '003_durable_operational_data_plane',
    up: 'sql/migrations/003_durable_operational_data_plane.up.sql',
    down: 'sql/migrations/003_durable_operational_data_plane.down.sql',
  },
] as const;

export const REQUIRED_TABLES = [
  'directives',
  'directive_revisions',
  'directive_supersedes',
  'directive_revision_supersedes',
  'source_observations',
  'collector_runs',
  'operational_snapshots',
  'attention_items',
  'agent_sessions',
  'agent_activities',
  'agent_activity_revisions',
  'audit_events',
  'current_directives',
  'current_attention_items',
  'current_source_observations',
  'collector_run_revisions',
  'operational_snapshot_revisions',
] as const;

export const REQUIRED_MATERIALIZED_VIEWS = ['mv_open_attention'] as const;

export const REQUIRED_VIEWS = [
  'v_latest_collector_runs',
  'v_latest_source_observations',
  'v_latest_operational_snapshots',
] as const;

export const FROZEN_VIEW_COLUMNS = {
  v_latest_collector_runs: [
    'collector',
    'run_id',
    'status',
    'freshness_status',
    'started_at',
    'finished_at',
    'observed_at',
    'error_code',
    'payload_json',
  ],
  v_latest_source_observations: [
    'observation_id',
    'scope',
    'observation_type',
    'source_system',
    'source_kind',
    'source_locator',
    'observed_at',
    'freshness_status',
    'confidence',
    'payload_json',
  ],
  v_latest_operational_snapshots: [
    'snapshot_id',
    'scope',
    'snapshot_type',
    'observed_at',
    'freshness_status',
    'confidence',
    'source_system',
    'source_kind',
    'source_locator',
    'snapshot_json',
  ],
} as const;

async function appliedIds(client: Queryable): Promise<string[]> {
  const exists = await client.query(
    `SELECT to_regclass('control_center.schema_migrations') AS reg`,
  );
  const row = exists.rows[0] as { reg: string | null } | undefined;
  if (!row?.reg) {
    return [];
  }
  const result = await client.query(
    `SELECT id FROM control_center.schema_migrations ORDER BY id ASC`,
  );
  return result.rows.map((item) => {
    const record = item as { id: string };
    return record.id;
  });
}

function isPool(db: pg.Pool | pg.PoolClient): db is pg.Pool {
  return 'totalCount' in db;
}

async function withHeldClient<T>(db: pg.Pool | pg.PoolClient, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  if (!isPool(db)) {
    return fn(db);
  }
  const client = await db.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function execSqlFile(client: pg.PoolClient, relativePath: string): Promise<void> {
  const statements = splitSqlStatements(readSql(relativePath));
  for (const statement of statements) {
    await client.query(statement);
  }
}

export async function migrateUp(db: pg.Pool | pg.PoolClient): Promise<string[]> {
  return withHeldClient(db, async (client) => {
    const applied = new Set(await appliedIds(client));
    const ran: string[] = [];
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.id)) {
        continue;
      }
      await client.query('BEGIN');
      try {
        await execSqlFile(client, migration.up);
        await client.query(
          `INSERT INTO control_center.schema_migrations (id, applied_at) VALUES ($1, now())`,
          [migration.id],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      ran.push(migration.id);
      logEvent('migrate.up', { migration: migration.id });
    }
    return ran;
  });
}

export async function migrateDown(db: pg.Pool | pg.PoolClient): Promise<string[]> {
  return withHeldClient(db, async (client) => {
    const applied = await appliedIds(client);
    const ran: string[] = [];
    for (const migration of [...MIGRATIONS].reverse()) {
      if (!applied.includes(migration.id)) {
        continue;
      }
      await client.query('BEGIN');
      try {
        await execSqlFile(client, migration.down);
        if (migration.id !== '001_init') {
          await client.query(`DELETE FROM control_center.schema_migrations WHERE id = $1`, [migration.id]);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      ran.push(migration.id);
      logEvent('migrate.down', { migration: migration.id });
    }
    return ran;
  });
}

export async function appliedMigrations(client: Queryable): Promise<string[]> {
  return appliedIds(client);
}

export async function listNamedObjects(client: Queryable): Promise<{
  tables: string[];
  materializedViews: string[];
  views: string[];
}> {
  const tables = await client.query(
    `SELECT tablename
     FROM pg_tables
     WHERE schemaname = 'control_center'
     ORDER BY tablename`,
  );
  const matviews = await client.query(
    `SELECT matviewname
     FROM pg_matviews
     WHERE schemaname = 'control_center'
     ORDER BY matviewname`,
  );
  const views = await client.query(
    `SELECT viewname
     FROM pg_views
     WHERE schemaname = 'control_center'
     ORDER BY viewname`,
  );
  return {
    tables: tables.rows.map((row) => (row as { tablename: string }).tablename),
    materializedViews: matviews.rows.map((row) => (row as { matviewname: string }).matviewname),
    views: views.rows.map((row) => (row as { viewname: string }).viewname),
  };
}

export async function listViewColumns(client: Queryable, viewName: string): Promise<string[]> {
  const result = await client.query(
    `SELECT a.attname
     FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'control_center'
       AND c.relname = $1
       AND a.attnum > 0
       AND NOT a.attisdropped
     ORDER BY a.attnum`,
    [viewName],
  );
  return result.rows.map((row) => (row as { attname: string }).attname);
}
