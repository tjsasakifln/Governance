import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createPersistence, migrateUp } from '../src/index.js';
import { assertConsumerSample, persistConsumerSample } from './helpers/consumer-flow.js';
import { startTestPostgres, type TestPostgres } from './helpers/postgres.js';

let ctx: TestPostgres;

before(async () => {
  ctx = await startTestPostgres();
});

after(async () => {
  await ctx.stop();
});

test('fresh consumer loads shipped package, migrates, and reads provenance/audit fields back', async () => {
  await migrateUp(ctx.pool);
  const persistence = createPersistence(ctx.pool);
  const sample = await persistConsumerSample(persistence);
  assertConsumerSample(sample);
  assert.equal(sample.directive.kind, 'decision');
  assert.equal(sample.revision.scope, 'ops.exceptions');
  assert.equal(sample.audit.entityType, 'directive');
  const loaded = await persistence.getDirective(sample.directive.id);
  assert.equal(loaded.currentRevisionId, sample.revision.id);
  const audit = await persistence.getAuditEvent(sample.audit.id);
  assert.equal(audit.source, 'synthetic-consumer');
  assert.equal(audit.freshnessStatus, 'fresh');
});
