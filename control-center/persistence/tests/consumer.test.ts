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
  assert.equal(sample.revision.scope, 'company');
  assert.match(sample.directive.id, /^cc:directive:/);
  assert.equal(sample.revision.freshnessStatus, 'FRESH');
  assert.equal(sample.revision.source.system, 'manual');
  assert.equal(sample.revision.source.kind, 'consumer');
  assert.equal(sample.audit.entityType, 'directive');
  const loaded = await persistence.getDirective(sample.directive.id);
  assert.equal(loaded.currentRevisionId, sample.revision.id);
  const audit = await persistence.getAuditEvent(sample.audit.id);
  assert.equal(audit.source.locator, 'synthetic-consumer');
  assert.equal(audit.freshnessStatus, 'FRESH');
  assert.equal(audit.confidence, 1);
});
