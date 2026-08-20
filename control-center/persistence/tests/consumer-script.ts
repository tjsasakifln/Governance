import { createPersistence, migrateUp } from '../src/index.js';
import { persistConsumerSample } from './helpers/consumer-flow.js';
import { startTestPostgres } from './helpers/postgres.js';

const ctx = await startTestPostgres();
try {
  await migrateUp(ctx.pool);
  const persistence = createPersistence(ctx.pool);
  const sample = await persistConsumerSample(persistence);
  const payload = {
    directive: {
      id: sample.directive.id,
      kind: sample.directive.kind,
      scope: sample.directive.scope,
      currentRevisionId: sample.directive.currentRevisionId,
    },
    revision: {
      id: sample.revision.id,
      source: sample.revision.source,
      observedAt: sample.revision.observedAt.toISOString(),
      freshnessStatus: sample.revision.freshnessStatus,
      confidence: sample.revision.confidence,
    },
    audit: {
      id: sample.audit.id,
      action: sample.audit.action,
      entityType: sample.audit.entityType,
      entityId: sample.audit.entityId,
      source: sample.audit.source,
      observedAt: sample.audit.observedAt.toISOString(),
      freshnessStatus: sample.audit.freshnessStatus,
    },
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  if (
    !payload.revision.source ||
    !payload.revision.observedAt ||
    !payload.revision.freshnessStatus ||
    !payload.audit.source ||
    !payload.audit.observedAt ||
    !payload.audit.freshnessStatus
  ) {
    throw new Error('consumer sample missing provenance/audit fields');
  }
} finally {
  await ctx.stop();
}
