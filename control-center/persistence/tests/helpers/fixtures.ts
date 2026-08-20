import type { FreshnessStatus, SourceRef } from '../../src/index.js';

export const SYNTHETIC_SOURCE: SourceRef = {
  system: 'manual',
  kind: 'fixture',
  locator: 'synthetic-test',
  label: 'synthetic',
};

export function provenance(scope = 'company', freshnessStatus: FreshnessStatus = 'FRESH') {
  return {
    scope,
    source: { ...SYNTHETIC_SOURCE },
    observedAt: new Date('2026-04-01T00:00:00.000Z'),
    freshnessStatus,
    confidence: 0.75,
    createdBy: 'synthetic-operator-01',
  };
}

export const SAMPLE_UUID = '550e8400-e29b-41d4-a716-446655440000';
