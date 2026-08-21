import { ValidationError } from './errors.js';

export const COLLECTOR_RUN_STATUSES = ['RUNNING', 'DONE', 'PARTIAL', 'FAILED', 'UNKNOWN'] as const;
export type CollectorRunStatus = (typeof COLLECTOR_RUN_STATUSES)[number];

export const LEGACY_COLLECTOR_RUN_STATUSES = ['started', 'succeeded', 'failed', 'skipped'] as const;
export type LegacyCollectorRunStatus = (typeof LEGACY_COLLECTOR_RUN_STATUSES)[number];

const LEGACY_TO_OBJECTIVE: Record<LegacyCollectorRunStatus, CollectorRunStatus> = {
  started: 'RUNNING',
  succeeded: 'DONE',
  failed: 'FAILED',
  skipped: 'UNKNOWN',
};

export type CollectorRunStatusInput = CollectorRunStatus | LegacyCollectorRunStatus;

export function isCollectorRunStatus(value: unknown): value is CollectorRunStatus {
  return typeof value === 'string' && (COLLECTOR_RUN_STATUSES as readonly string[]).includes(value);
}

export function toObjectiveCollectorRunStatus(value: string): CollectorRunStatus {
  if (isCollectorRunStatus(value)) {
    return value;
  }
  if ((LEGACY_COLLECTOR_RUN_STATUSES as readonly string[]).includes(value)) {
    return LEGACY_TO_OBJECTIVE[value as LegacyCollectorRunStatus];
  }
  throw new ValidationError(
    `collector run status must be RUNNING|DONE|PARTIAL|FAILED|UNKNOWN (legacy started|succeeded|failed|skipped is mapped)`,
  );
}
