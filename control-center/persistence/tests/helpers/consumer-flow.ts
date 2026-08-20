import type { Persistence } from '../../src/index.js';

const SOURCE = {
  system: 'manual',
  kind: 'consumer',
  locator: 'synthetic-consumer',
  label: 'consumer-script',
} as const;

export async function persistConsumerSample(persistence: Persistence) {
  const observedAt = new Date('2026-03-01T15:04:05.000Z');
  const created = await persistence.createDirective({
    kind: 'decision',
    scope: 'company',
    title: 'Synthetic consumer: prefer exceptions over KPI walls',
    body: 'Consumer-flow sample. No live systems and no personal data.',
    effectiveFrom: observedAt,
    createdBy: 'synthetic-operator-01',
    source: SOURCE,
    observedAt,
    freshnessStatus: 'FRESH',
    confidence: 1,
  });
  const audit = await persistence.appendAuditEvent({
    actor: 'synthetic-operator-01',
    action: 'consumer.sample',
    entityType: 'directive',
    entityId: created.directive.id,
    scope: 'company',
    payload: { kind: created.directive.kind },
    source: SOURCE,
    observedAt,
    freshnessStatus: 'FRESH',
    confidence: 1,
  });
  return {
    directive: created.directive,
    revision: created.revision,
    audit,
  };
}

export function assertConsumerSample(
  sample: Awaited<ReturnType<typeof persistConsumerSample>>,
): void {
  if (!sample.directive.id.startsWith('cc:') || !sample.directive.currentRevisionId.startsWith('cc:')) {
    throw new Error('directive identity missing cc:* public id');
  }
  if (sample.revision.source.system !== 'manual' || sample.revision.source.kind !== 'consumer') {
    throw new Error('revision SourceRef missing structured fields');
  }
  if (!(sample.revision.observedAt instanceof Date) || sample.revision.observedAt.toISOString().length === 0) {
    throw new Error('revision observedAt missing');
  }
  if (sample.revision.freshnessStatus !== 'FRESH') {
    throw new Error('revision freshnessStatus must be FRESH');
  }
  if (sample.revision.confidence !== 1) {
    throw new Error('revision confidence missing');
  }
  if (sample.audit.source.system !== 'manual' || !sample.audit.source.locator) {
    throw new Error('audit SourceRef missing');
  }
  if (!(sample.audit.observedAt instanceof Date)) {
    throw new Error('audit observedAt missing');
  }
  if (sample.audit.freshnessStatus !== 'FRESH') {
    throw new Error('audit freshnessStatus must be FRESH');
  }
  if (sample.audit.action !== 'consumer.sample') {
    throw new Error('audit action missing');
  }
  if (sample.audit.entityId !== sample.directive.id) {
    throw new Error('audit entity id mismatch');
  }
}
