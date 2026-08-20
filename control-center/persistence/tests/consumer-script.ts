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
      supersedes: sample.directive.supersedes,
    },
    revision: {
      id: sample.revision.id,
      source: sample.revision.source,
      observedAt: sample.revision.observedAt.toISOString(),
      observed_at: sample.revision.observedAt.toISOString(),
      freshnessStatus: sample.revision.freshnessStatus,
      freshness_status: sample.revision.freshnessStatus,
      confidence: sample.revision.confidence,
    },
    audit: {
      id: sample.audit.id,
      action: sample.audit.action,
      entityType: sample.audit.entityType,
      entityId: sample.audit.entityId,
      source: sample.audit.source,
      observedAt: sample.audit.observedAt.toISOString(),
      observed_at: sample.audit.observedAt.toISOString(),
      freshnessStatus: sample.audit.freshnessStatus,
      freshness_status: sample.audit.freshnessStatus,
      confidence: sample.audit.confidence,
    },
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  if (!payload.directive.id.startsWith('cc:')) {
    throw new Error('consumer sample public id is not cc:*');
  }
  if (
    !payload.revision.source?.system ||
    !payload.revision.source?.kind ||
    !payload.revision.source?.locator ||
    payload.revision.freshnessStatus !== 'FRESH' ||
    payload.revision.freshness_status !== 'FRESH' ||
    !payload.revision.observed_at ||
    payload.revision.confidence === undefined ||
    payload.revision.confidence === null
  ) {
    throw new Error('consumer sample missing canonical provenance fields');
  }
} finally {
  await ctx.stop();
}
