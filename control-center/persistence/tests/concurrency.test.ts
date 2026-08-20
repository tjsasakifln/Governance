import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { migrateUp } from '../src/index.js';
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
  const key = 'synthetic-warmbly:open-exceptions:concurrent-1';
  const input = {
    scope: 'commercial.pipeline',
    observationKind: 'open-exceptions',
    payload: { open_exceptions: 3 },
    idempotencyKey: key,
    source: 'synthetic-warmbly',
    observedAt: new Date('2026-04-01T00:00:00.000Z'),
    freshnessStatus: 'fresh' as const,
    confidence: 0.9,
    money: { amountCents: 250000, currency: 'BRL' },
  };
  const [a, b] = await Promise.all([
    ctx.persistence.recordObservation(input),
    ctx.persistence.recordObservation(input),
  ]);
  assert.equal(a.observation.id, b.observation.id);
  assert.equal(a.inserted !== b.inserted, true);
  assert.equal(await ctx.persistence.countObservationsByIdempotencyKey(key), 1);
  const listed = await ctx.persistence.listObservationsByScope('commercial.pipeline');
  assert.equal(listed.filter((row) => row.idempotencyKey === key).length, 1);
});

test('concurrent collector runs with the same idempotency key insert exactly one row', async () => {
  const key = 'synthetic-warmbly-readonly:concurrent-run-1';
  const input = {
    collectorName: 'synthetic-warmbly-readonly',
    idempotencyKey: key,
    scope: 'commercial.pipeline',
    source: 'synthetic-warmbly',
    observedAt: new Date('2026-04-01T00:00:00.000Z'),
    freshnessStatus: 'fresh' as const,
    confidence: 0.9,
  };
  const [a, b] = await Promise.all([
    ctx.persistence.startCollectorRun(input),
    ctx.persistence.startCollectorRun(input),
  ]);
  assert.equal(a.run.id, b.run.id);
  assert.equal(a.inserted !== b.inserted, true);
  assert.equal(await ctx.persistence.countCollectorRunsByIdempotencyKey(key), 1);
});
