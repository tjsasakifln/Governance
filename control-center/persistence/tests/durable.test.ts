import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  FROZEN_VIEW_COLUMNS,
  REQUIRED_VIEWS,
  ValidationError,
  applyRetention,
  listViewColumns,
  migrateDown,
  migrateUp,
} from '../src/index.js';
import { provenance } from './helpers/fixtures.js';
import { startIsolatedTestPostgres, type TestPostgres } from './helpers/postgres.js';

const here = path.dirname(fileURLToPath(import.meta.url));

let ctx: TestPostgres;

before(async () => {
  ctx = await startIsolatedTestPostgres();
  await migrateUp(ctx.pool);
});

after(async () => {
  await ctx.stop();
});

function sourceFor(locator: string) {
  return { system: 'warmbly', kind: 'collector', locator, label: 'fixture' as const };
}

test('store tests do not import or call live providers', () => {
  const root = path.resolve(here, '..');
  const files: string[] = [];
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') {
          continue;
        }
        walk(full);
        continue;
      }
      if (entry.name.endsWith('.ts')) {
        files.push(full);
      }
    }
  }
  walk(path.join(root, 'src'));
  const forbidden = [
    'connectors/github',
    'connectors/warmbly',
    'connectors/asaas',
    'connectors/pncp',
    'connectors/infrastructure',
    'api.github.com',
    'api.asaas.com',
    'api-sandbox.asaas.com',
    'pncp.gov.br',
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const token of forbidden) {
      assert.equal(text.includes(token), false, `${file} must not reference ${token}`);
    }
  }
});

test('migrate up-down-up recreates frozen latest views with exact columns', async () => {
  const down = await migrateDown(ctx.pool);
  assert.ok(down.includes('003_durable_operational_data_plane'));
  const up = await migrateUp(ctx.pool);
  assert.ok(up.includes('003_durable_operational_data_plane'));
  const named = await ctx.persistence.listNamedObjects();
  for (const view of REQUIRED_VIEWS) {
    assert.ok(named.views.includes(view), view);
    assert.deepEqual(await listViewColumns(ctx.pool, view), [...FROZEN_VIEW_COLUMNS[view]]);
  }
});

test('collector_runs and operational_snapshots use unique idempotency and public id prefixes', async () => {
  const observedAt = new Date('2026-04-01T00:00:00.000Z');
  const run = await ctx.persistence.startCollectorRun({
    collectorName: 'github',
    idempotencyKey: 'github:identity:2026-04-01T00:00:00.000Z',
    scope: 'company',
    source: sourceFor('github:identity'),
    observedAt,
    freshnessStatus: 'FRESH',
    confidence: 0.9,
  });
  assert.match(run.run.id, /^cc:collector-run:/);
  assert.equal(run.run.status, 'RUNNING');
  const snapshot = await ctx.persistence.recordSnapshot({
    scope: 'company',
    snapshotKind: 'ops-brief',
    payload: { items: 1 },
    source: sourceFor('github:identity'),
    observedAt,
    freshnessStatus: 'FRESH',
    confidence: 0.9,
    idempotencyKey: 'company:ops-brief:github:identity:2026-04-01T00:00:00.000Z',
  });
  assert.match(snapshot.snapshot.id, /^cc:operational-snapshot:/);
  const constraints = await ctx.pool.query<{ rel: string; contype: string }>(
    `SELECT cls.relname AS rel, c.contype
     FROM pg_constraint c
     JOIN pg_class cls ON cls.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE n.nspname = 'control_center'
       AND cls.relname IN ('collector_runs', 'source_observations')
       AND c.contype = 'u'`,
  );
  assert.ok(constraints.rows.some((row) => row.rel === 'collector_runs'));
  assert.ok(constraints.rows.some((row) => row.rel === 'source_observations'));
  const snapshotUnique = await ctx.pool.query<{ conname: string }>(
    `SELECT c.conname
     FROM pg_constraint c
     JOIN pg_class cls ON cls.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE n.nspname = 'control_center'
       AND cls.relname = 'operational_snapshots'
       AND c.contype = 'u'`,
  );
  assert.ok(snapshotUnique.rows.some((row) => row.conname.includes('idempotency')));
});

test('same observation+source+observed_at+contract identity yields one entity', async () => {
  const observedAt = new Date('2026-05-01T12:00:00.000Z');
  const input = {
    scope: 'commercial',
    observationKind: 'open-exceptions-count',
    payload: { open_exceptions: 4 },
    idempotencyKey: 'warmbly:collector:loc-a:open-exceptions-count:2026-05-01T12:00:00.000Z',
    source: sourceFor('loc-a'),
    observedAt,
    freshnessStatus: 'FRESH' as const,
    confidence: 0.8,
  };
  const first = await ctx.persistence.recordObservation(input);
  const second = await ctx.persistence.recordObservation(input);
  assert.equal(first.observation.id, second.observation.id);
  assert.equal(first.inserted, true);
  assert.equal(second.inserted, false);
  assert.match(first.observation.id, /^cc:source-observation:/);
  assert.equal(await ctx.persistence.countObservationsByIdempotencyKey(input.idempotencyKey), 1);
});

test('concurrent writers with the same snapshot key insert one row', async () => {
  const observedAt = new Date('2026-05-02T12:00:00.000Z');
  const input = {
    scope: 'commercial' as const,
    snapshotKind: 'exceptions-brief',
    payload: { items: 2 },
    source: sourceFor('loc-concurrent'),
    observedAt,
    freshnessStatus: 'FRESH' as const,
    confidence: 0.7,
    idempotencyKey: 'snap-concurrent-1',
  };
  const [a, b] = await Promise.all([
    ctx.persistence.recordSnapshot(input),
    ctx.persistence.recordSnapshot(input),
  ]);
  assert.equal(a.snapshot.id, b.snapshot.id);
  assert.equal(a.inserted !== b.inserted, true);
  assert.equal(await ctx.persistence.countSnapshotsByIdempotencyKey(input.idempotencyKey), 1);
});

test('UPDATE/DELETE of append-only run/revision/audit history is rejected', async () => {
  const started = await ctx.persistence.startCollectorRun({
    collectorName: 'pncp',
    idempotencyKey: 'pncp:append-only:2026-05-03T00:00:00.000Z',
    scope: 'inbound',
    source: sourceFor('pncp:append-only'),
    observedAt: new Date('2026-05-03T00:00:00.000Z'),
    freshnessStatus: 'FRESH',
    confidence: 0.6,
  });
  const finished = await ctx.persistence.finishCollectorRun({
    id: started.run.id,
    status: 'DONE',
    observedAt: new Date('2026-05-03T00:00:05.000Z'),
    freshnessStatus: 'FRESH',
    confidence: 0.6,
    stats: { rows: 1 },
  });
  assert.equal(finished.status, 'DONE');
  assert.equal(finished.revisionNo, 2);
  const runBefore = await ctx.pool.query(`SELECT * FROM control_center.collector_runs WHERE id = $1`, [
    started.run.id,
  ]);
  const revBefore = await ctx.pool.query(
    `SELECT * FROM control_center.collector_run_revisions WHERE run_id = $1 ORDER BY revision_no`,
    [started.run.id],
  );
  await assert.rejects(
    () => ctx.pool.query(`UPDATE control_center.collector_runs SET status = 'FAILED' WHERE id = $1`, [started.run.id]),
    /append-only/,
  );
  await assert.rejects(
    () => ctx.pool.query(`DELETE FROM control_center.collector_runs WHERE id = $1`, [started.run.id]),
    /append-only/,
  );
  await assert.rejects(
    () =>
      ctx.pool.query(`UPDATE control_center.collector_run_revisions SET status = 'FAILED' WHERE run_id = $1`, [
        started.run.id,
      ]),
    /append-only/,
  );
  await assert.rejects(
    () => ctx.pool.query(`DELETE FROM control_center.collector_run_revisions WHERE run_id = $1`, [started.run.id]),
    /append-only/,
  );
  const runAfter = await ctx.pool.query(`SELECT * FROM control_center.collector_runs WHERE id = $1`, [started.run.id]);
  const revAfter = await ctx.pool.query(
    `SELECT * FROM control_center.collector_run_revisions WHERE run_id = $1 ORDER BY revision_no`,
    [started.run.id],
  );
  assert.equal(JSON.stringify(runAfter.rows[0]), JSON.stringify(runBefore.rows[0]));
  assert.equal(JSON.stringify(revAfter.rows), JSON.stringify(revBefore.rows));
  assert.equal(revAfter.rowCount, 2);
});

test('invalid payload is rejected and does not appear in latest views', async () => {
  const observedAt = new Date('2026-05-04T00:00:00.000Z');
  await assert.rejects(
    () =>
      ctx.persistence.recordObservation({
        scope: 'commercial',
        observationKind: 'secret-leak',
        payload: { api_key: 'should-not-store' },
        idempotencyKey: 'invalid-payload-obs-1',
        source: sourceFor('invalid-payload'),
        observedAt,
        freshnessStatus: 'FRESH',
        confidence: 0.5,
      }),
    ValidationError,
  );
  await assert.rejects(
    () =>
      ctx.persistence.recordSnapshot({
        scope: 'commercial',
        snapshotKind: 'secret-brief',
        payload: { password: 'nope' },
        source: sourceFor('invalid-payload'),
        observedAt,
        freshnessStatus: 'FRESH',
        confidence: 0.5,
        idempotencyKey: 'invalid-payload-snap-1',
      }),
    ValidationError,
  );
  const latestObs = await ctx.pool.query(
    `SELECT observation_id FROM control_center.v_latest_source_observations
     WHERE source_locator = 'invalid-payload'`,
  );
  const latestSnap = await ctx.pool.query(
    `SELECT snapshot_id FROM control_center.v_latest_operational_snapshots
     WHERE source_locator = 'invalid-payload'`,
  );
  assert.equal(latestObs.rowCount, 0);
  assert.equal(latestSnap.rowCount, 0);
});

test('successor with later observed_at leaves predecessor readable as STALE', async () => {
  const source = sourceFor('stale-pred');
  const first = await ctx.persistence.recordObservation({
    scope: 'commercial',
    observationKind: 'open-exceptions-count',
    payload: { open_exceptions: 2 },
    idempotencyKey: 'stale-pred:t1',
    source,
    observedAt: new Date('2026-05-05T00:00:00.000Z'),
    freshnessStatus: 'FRESH',
    confidence: 0.9,
  });
  const second = await ctx.persistence.recordObservation({
    scope: 'commercial',
    observationKind: 'open-exceptions-count',
    payload: { open_exceptions: 5 },
    idempotencyKey: 'stale-pred:t2',
    source,
    observedAt: new Date('2026-05-05T01:00:00.000Z'),
    freshnessStatus: 'FRESH',
    confidence: 0.9,
  });
  const predecessor = await ctx.persistence.getObservation(first.observation.id);
  const latest = await ctx.persistence.getObservation(second.observation.id);
  assert.equal(predecessor.freshnessStatus, 'STALE');
  assert.equal(latest.freshnessStatus, 'FRESH');
  const raw = await ctx.pool.query<{ freshness_status: string }>(
    `SELECT freshness_status FROM control_center.source_observations WHERE id = $1`,
    [first.observation.id],
  );
  assert.equal(raw.rows[0]?.freshness_status, 'FRESH');
  const view = await ctx.pool.query<{ observation_id: string; payload_json: { open_exceptions: number } }>(
    `SELECT observation_id, payload_json FROM control_center.v_latest_source_observations
     WHERE source_locator = 'stale-pred' AND observation_type = 'open-exceptions-count'`,
  );
  assert.equal(view.rowCount, 1);
  assert.equal(view.rows[0]?.observation_id, second.observation.id);
});

test('missing observation is not synthesized as numeric zero in the latest view', async () => {
  const view = await ctx.pool.query(
    `SELECT payload_json FROM control_center.v_latest_source_observations
     WHERE source_locator = 'does-not-exist-zero'`,
  );
  assert.equal(view.rowCount, 0);
});

test('Sao Paulo offset timestamptz round-trips as the same UTC instant', async () => {
  const observedAt = new Date('2026-02-15T23:00:00-03:00');
  const recorded = await ctx.persistence.recordObservation({
    scope: 'commercial',
    observationKind: 'tz-boundary',
    payload: { ok: true },
    idempotencyKey: 'tz-boundary-1',
    source: sourceFor('tz-boundary'),
    observedAt,
    freshnessStatus: 'FRESH',
    confidence: 0.5,
  });
  assert.equal(recorded.observation.observedAt.toISOString(), '2026-02-16T02:00:00.000Z');
  const raw = await ctx.pool.query<{ utc: string }>(
    `SELECT to_char(observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS utc
     FROM control_center.source_observations WHERE id = $1`,
    [recorded.observation.id],
  );
  assert.equal(raw.rows[0]?.utc, '2026-02-16T02:00:00.000Z');
});

test('retention with invalid or missing config fails closed and does not DELETE history', async () => {
  const before = await ctx.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM control_center.collector_run_revisions`,
  );
  await assert.rejects(() => applyRetention(ctx.pool, undefined as never), ValidationError);
  await assert.rejects(
    () => applyRetention(ctx.pool, { maxAgeDays: 1, actor: 'synthetic-operator-01' }),
    ValidationError,
  );
  await assert.rejects(
    () => applyRetention(ctx.pool, { maxAgeDays: 90, applyDeletes: true, actor: 'synthetic-operator-01' }),
    ValidationError,
  );
  const afterInvalid = await ctx.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM control_center.collector_run_revisions`,
  );
  assert.equal(afterInvalid.rows[0]?.n, before.rows[0]?.n);
  const evaluated = await ctx.persistence.applyRetention({
    maxAgeDays: 90,
    actor: 'synthetic-operator-01',
    scope: 'company',
    observedAt: new Date('2026-05-06T00:00:00.000Z'),
  });
  assert.equal(evaluated.deleted, 0);
  assert.equal(evaluated.applyDeletes, false);
  const afterValid = await ctx.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM control_center.collector_run_revisions`,
  );
  assert.equal(afterValid.rows[0]?.n, before.rows[0]?.n);
});

test('finishCollectorRun accepts legacy succeeded and stores OBJECTIVE DONE', async () => {
  const started = await ctx.persistence.startCollectorRun({
    collectorName: 'infra',
    idempotencyKey: 'infra:legacy-status:2026-05-07T00:00:00.000Z',
    ...provenance('infrastructure'),
    source: sourceFor('infra:legacy'),
    observedAt: new Date('2026-05-07T00:00:00.000Z'),
  });
  const finished = await ctx.persistence.finishCollectorRun({
    id: started.run.id,
    status: 'succeeded',
    observedAt: new Date('2026-05-07T00:00:03.000Z'),
    freshnessStatus: 'FRESH',
    confidence: 0.8,
  });
  assert.equal(finished.status, 'DONE');
  const latest = await ctx.pool.query<{ status: string }>(
    `SELECT status FROM control_center.v_latest_collector_runs WHERE collector = 'infra'`,
  );
  assert.equal(latest.rows[0]?.status, 'DONE');
});
