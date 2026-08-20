import type { Persistence } from '../../src/index.js';

export async function persistConsumerSample(persistence: Persistence) {
  const observedAt = new Date('2026-03-01T15:04:05.000Z');
  const created = await persistence.createDirective({
    kind: 'decision',
    scope: 'ops.exceptions',
    title: 'Synthetic consumer: prefer exceptions over KPI walls',
    body: 'Consumer-flow sample. No live systems and no personal data.',
    effectiveFrom: observedAt,
    createdBy: 'synthetic-operator-01',
    source: 'synthetic-consumer',
    observedAt,
    freshnessStatus: 'fresh',
    confidence: 1,
  });
  const audit = await persistence.appendAuditEvent({
    actor: 'synthetic-operator-01',
    action: 'consumer.sample',
    entityType: 'directive',
    entityId: created.directive.id,
    scope: 'ops.exceptions',
    payload: { kind: created.directive.kind },
    source: 'synthetic-consumer',
    observedAt,
    freshnessStatus: 'fresh',
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
  if (!sample.directive.id || !sample.directive.currentRevisionId) {
    throw new Error('directive identity missing');
  }
  if (sample.revision.source !== 'synthetic-consumer') {
    throw new Error('revision source missing');
  }
  if (!(sample.revision.observedAt instanceof Date)) {
    throw new Error('revision observedAt missing');
  }
  if (sample.revision.freshnessStatus !== 'fresh') {
    throw new Error('revision freshnessStatus missing');
  }
  if (sample.revision.confidence !== 1) {
    throw new Error('revision confidence missing');
  }
  if (sample.audit.source !== 'synthetic-consumer') {
    throw new Error('audit source missing');
  }
  if (!(sample.audit.observedAt instanceof Date)) {
    throw new Error('audit observedAt missing');
  }
  if (sample.audit.freshnessStatus !== 'fresh') {
    throw new Error('audit freshnessStatus missing');
  }
  if (sample.audit.action !== 'consumer.sample') {
    throw new Error('audit action missing');
  }
  if (sample.audit.entityId !== sample.directive.id) {
    throw new Error('audit entity id mismatch');
  }
}
