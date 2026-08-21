import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { migrateUp } from '../src/index.js';
import { SYNTHETIC_SOURCE } from './helpers/fixtures.js';
import { startTestPostgres, type TestPostgres } from './helpers/postgres.js';

let ctx: TestPostgres;

before(async () => {
  ctx = await startTestPostgres();
  await migrateUp(ctx.pool);
});

after(async () => {
  await ctx.stop();
});

test('concurrent collector observations with the same idempotency key insert exactly one row', async () => {
  const key = `synthetic-warmbly:open-exceptions:concurrent-${Date.now()}`;
  const input = {
    scope: 'commercial',
    observationKind: 'open-exceptions',
    payload: { open_exceptions: 3 },
    idempotencyKey: key,
    source: { ...SYNTHETIC_SOURCE, system: 'warmbly', kind: 'collector', locator: key },
    observedAt: new Date('2026-04-01T00:00:00.000Z'),
    freshnessStatus: 'FRESH' as const,
    confidence: 0.9,
    money: { amountCents: 250000, currency: 'BRL' },
  };
  const [a, b] = await Promise.all([
    ctx.persistence.recordObservation(input),
    ctx.persistence.recordObservation(input),
  ]);
  assert.equal(a.observation.id, b.observation.id);
  assert.match(a.observation.id, /^cc:source-observation:/);
  assert.equal(a.inserted !== b.inserted, true);
  assert.equal(await ctx.persistence.countObservationsByIdempotencyKey(key), 1);
  const listed = await ctx.persistence.listObservationsByScope('commercial');
  assert.equal(listed.filter((row) => row.idempotencyKey === key).length, 1);
});

test('concurrent collector runs with the same idempotency key insert exactly one row', async () => {
  const key = `synthetic-warmbly-readonly:concurrent-run-${Date.now()}`;
  const input = {
    collectorName: 'synthetic-warmbly-readonly',
    idempotencyKey: key,
    scope: 'commercial',
    source: { ...SYNTHETIC_SOURCE, system: 'warmbly', kind: 'collector', locator: key },
    observedAt: new Date('2026-04-01T00:00:00.000Z'),
    freshnessStatus: 'FRESH' as const,
    confidence: 0.9,
  };
  const [a, b] = await Promise.all([
    ctx.persistence.startCollectorRun(input),
    ctx.persistence.startCollectorRun(input),
  ]);
  assert.equal(a.run.id, b.run.id);
  assert.match(a.run.id, /^cc:collector-run:/);
  assert.equal(a.inserted !== b.inserted, true);
  assert.equal(await ctx.persistence.countCollectorRunsByIdempotencyKey(key), 1);
});
