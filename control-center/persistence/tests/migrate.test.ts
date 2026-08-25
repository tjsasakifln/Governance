import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  FROZEN_VIEW_COLUMNS,
  REQUIRED_MATERIALIZED_VIEWS,
  REQUIRED_TABLES,
  REQUIRED_VIEWS,
  listViewColumns,
  migrateDown,
  migrateUp,
  seedSynthetic,
} from '../src/index.js';
import { startIsolatedTestPostgres, type TestPostgres } from './helpers/postgres.js';

let ctx: TestPostgres;

before(async () => {
  ctx = await startIsolatedTestPostgres();
});

after(async () => {
  await ctx.stop();
});

test('migrate up then down then up recreates named tables and current-state objects', async () => {
  const first = await migrateUp(ctx.pool);
  assert.deepEqual(first, [
    '001_init',
    '002_current_state',
    '003_durable_operational_data_plane',
    '004_operator_actions',
    '005_operational_workflow_actions',
    '006_work_orders',
  ]);
  const afterFirstUp = await ctx.persistence.listNamedObjects();
  for (const table of REQUIRED_TABLES) {
    assert.ok(afterFirstUp.tables.includes(table), `missing table ${table}`);
  }
  for (const view of REQUIRED_MATERIALIZED_VIEWS) {
    assert.ok(afterFirstUp.materializedViews.includes(view), `missing matview ${view}`);
  }
  for (const view of REQUIRED_VIEWS) {
    assert.ok(afterFirstUp.views.includes(view), `missing view ${view}`);
    assert.deepEqual(await listViewColumns(ctx.pool, view), [...FROZEN_VIEW_COLUMNS[view]]);
  }

  const constraints = await ctx.pool.query<{ conname: string; contype: string; rel: string }>(
    `SELECT c.conname, c.contype, cls.relname AS rel
     FROM pg_constraint c
     JOIN pg_class cls ON cls.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE n.nspname = 'control_center'
     ORDER BY cls.relname, c.conname`,
  );
  const names = constraints.rows.map((row) => `${row.rel}:${row.conname}:${row.contype}`);
  assert.ok(names.some((item) => item.includes('source_observations') && item.endsWith(':u')));
  assert.ok(names.some((item) => item.includes('collector_runs') && item.endsWith(':u')));
  assert.ok(names.some((item) => item.includes('directive_revisions') && item.endsWith(':u')));
  assert.ok(names.some((item) => item.includes('directives') && item.endsWith(':p')));
  assert.ok(
    constraints.rows.some(
      (row) => row.rel === 'source_observations' && row.contype === 'c',
    ),
    'source_observations should have check constraints for provenance',
  );

  const indexes = await ctx.pool.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'control_center'`,
  );
  const indexNames = indexes.rows.map((row) => row.indexname);
  assert.ok(indexNames.includes('source_observations_scope_observed_idx'));
  assert.ok(indexNames.includes('audit_events_scope_occurred_idx'));
  assert.ok(indexNames.includes('current_directives_scope_status_idx'));
  assert.ok(indexNames.includes('agent_activities_scope_started_idx'));
  assert.ok(afterFirstUp.tables.includes('agent_activities'));
  assert.ok(afterFirstUp.tables.includes('directive_supersedes'));

  const freshnessFn = await ctx.pool.query<{ ok: boolean }>(
    `SELECT control_center.is_freshness('FRESH') AND NOT control_center.is_freshness('fresh')
            AND NOT control_center.is_freshness('expired')
            AND control_center.is_freshness('ERROR') AS ok`,
  );
  assert.equal(freshnessFn.rows[0]?.ok, true);
  const statusFn = await ctx.pool.query<{ ok: boolean }>(
    `SELECT control_center.is_directive_status('revoked')
            AND NOT control_center.is_directive_status('withdrawn') AS ok`,
  );
  assert.equal(statusFn.rows[0]?.ok, true);

  const down = await migrateDown(ctx.pool);
  assert.deepEqual(down, [
    '006_work_orders',
    '005_operational_workflow_actions',
    '004_operator_actions',
    '003_durable_operational_data_plane',
    '002_current_state',
    '001_init',
  ]);
  const afterDown = await ctx.persistence.listNamedObjects();
  assert.deepEqual(afterDown.tables, []);
  assert.deepEqual(afterDown.materializedViews, []);
  const gone = await ctx.pool.query<{ reg: string | null }>(
    `SELECT to_regclass('control_center.directives') AS reg`,
  );
  assert.equal(gone.rows[0]?.reg, null);

  const second = await migrateUp(ctx.pool);
  assert.deepEqual(second, [
    '001_init',
    '002_current_state',
    '003_durable_operational_data_plane',
    '004_operator_actions',
    '005_operational_workflow_actions',
    '006_work_orders',
  ]);
  const afterSecondUp = await ctx.persistence.listNamedObjects();
  for (const table of REQUIRED_TABLES) {
    assert.ok(afterSecondUp.tables.includes(table), `missing table after second up: ${table}`);
  }
  for (const view of REQUIRED_MATERIALIZED_VIEWS) {
    assert.ok(afterSecondUp.materializedViews.includes(view), `missing matview after second up: ${view}`);
  }
  for (const view of REQUIRED_VIEWS) {
    assert.ok(afterSecondUp.views.includes(view), `missing view after second up: ${view}`);
    assert.deepEqual(await listViewColumns(ctx.pool, view), [...FROZEN_VIEW_COLUMNS[view]]);
  }

  await seedSynthetic(ctx.pool);
  const seeded = await ctx.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM control_center.directives`,
  );
  assert.equal(seeded.rows[0]?.n, 1);
});
