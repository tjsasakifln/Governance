export {
  DIRECTIVE_KINDS,
  DIRECTIVE_STATUSES,
  FRESHNESS_STATUSES,
  SCOPE_LITERALS,
  type DirectiveKind,
  type DirectiveStatus,
  type FreshnessStatus,
  type SourceRef,
} from './canonical.js';

import type { DirectiveKind, DirectiveStatus, FreshnessStatus, SourceRef } from './canonical.js';
import type { CollectorRunStatus, CollectorRunStatusInput } from './run-status.js';

export { COLLECTOR_RUN_STATUSES, type CollectorRunStatus, type CollectorRunStatusInput } from './run-status.js';

export const ATTENTION_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type AttentionSeverity = (typeof ATTENTION_SEVERITIES)[number];

export const ATTENTION_STATUSES = ['open', 'acknowledged', 'resolved', 'dismissed'] as const;
export type AttentionStatus = (typeof ATTENTION_STATUSES)[number];

export const AGENT_ACTIVITY_STATUSES = [
  'RUNNING',
  'DONE',
  'PARTIAL',
  'BLOCKED',
  'FAILED',
  'UNKNOWN',
] as const;
export type AgentActivityStatus = (typeof AGENT_ACTIVITY_STATUSES)[number];

export type Money = {
  amountCents: number;
  currency: string;
};

export type Provenance = {
  source: SourceRef;
  observedAt: Date;
  freshnessStatus: FreshnessStatus;
  confidence: number;
};

export type Directive = {
  id: string;
  kind: DirectiveKind;
  scope: string;
  status: DirectiveStatus;
  title: string;
  body: string;
  effectiveFrom: Date;
  expiresAt: Date | null;
  supersedes: string[];
  createdBy: string;
  createdAt: Date;
  currentRevisionId: string;
};

export type DirectiveRevision = {
  id: string;
  directiveId: string;
  revisionNo: number;
  kind: DirectiveKind;
  scope: string;
  status: DirectiveStatus;
  title: string;
  body: string;
  effectiveFrom: Date;
  expiresAt: Date | null;
  supersedes: string[];
  createdBy: string;
  recordedAt: Date;
  recordedBy: string;
} & Provenance;

export type CurrentDirective = {
  directiveId: string;
  revisionId: string;
  kind: DirectiveKind;
  scope: string;
  status: DirectiveStatus;
  title: string;
  effectiveFrom: Date;
  expiresAt: Date | null;
  supersedes: string[];
  createdBy: string;
  updatedAt: Date;
} & Provenance;

export type CollectorRun = {
  id: string;
  collectorName: string;
  idempotencyKey: string;
  status: CollectorRunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  scope: string;
  errorCode: string | null;
  errorMessage: string | null;
  stats: Record<string, unknown>;
  payloadRef: string | null;
  revisionNo: number;
} & Provenance;

export type SourceObservation = {
  id: string;
  scope: string;
  observationKind: string;
  payload: Record<string, unknown>;
  money: Money | null;
  idempotencyKey: string;
  collectorRunId: string | null;
  createdAt: Date;
} & Provenance;

export type OperationalSnapshot = {
  id: string;
  scope: string;
  snapshotKind: string;
  payload: Record<string, unknown>;
  money: Money | null;
  createdAt: Date;
  idempotencyKey: string;
  revisionNo: number;
} & Provenance;

export type AttentionItem = {
  id: string;
  scope: string;
  severity: AttentionSeverity;
  title: string;
  body: string;
  status: AttentionStatus;
  relatedDirectiveId: string | null;
  money: Money | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
} & Provenance;

export type AgentSession = {
  id: string;
  scope: string;
  agentId: string;
  startedAt: Date;
  endedAt: Date | null;
  contextQuery: Record<string, unknown>;
} & Provenance;

export type AgentActivity = {
  id: string;
  correlationId: string;
  scope: string;
  agentId: string;
  status: AgentActivityStatus;
  goal: string;
  summary: string;
  startedAt: Date;
  finishedAt: Date | null;
  payload: Record<string, unknown>;
  currentRevisionNo: number;
  createdAt: Date;
} & Provenance;

export type AgentActivityRevision = {
  id: string;
  activityId: string;
  revisionNo: number;
  status: AgentActivityStatus;
  summary: string;
  recordedAt: Date;
} & Provenance;

export type AuditEvent = {
  id: string;
  occurredAt: Date;
  actor: string;
  action: string;
  entityType: string;
  entityId: string | null;
  scope: string;
  payload: Record<string, unknown>;
} & Provenance;

export type CreateDirectiveInput = {
  id?: string;
  revisionId?: string;
  kind: DirectiveKind;
  scope: string;
  status?: DirectiveStatus;
  title: string;
  body: string;
  effectiveFrom: Date;
  expiresAt?: Date | null;
  createdBy: string;
  recordedBy?: string;
  supersedes?: string[];
} & Provenance;

export type SupersedeDirectiveInput = {
  existingId: string;
  kind: DirectiveKind;
  scope: string;
  title: string;
  body: string;
  effectiveFrom: Date;
  expiresAt?: Date | null;
  createdBy: string;
  recordedBy?: string;
} & Provenance;

export type RecordObservationInput = {
  scope: string;
  observationKind: string;
  payload?: Record<string, unknown>;
  money?: Money | null;
  idempotencyKey: string;
  collectorRunId?: string | null;
} & Provenance;

export type StartCollectorRunInput = {
  collectorName: string;
  idempotencyKey: string;
  scope: string;
} & Provenance;

export type FinishCollectorRunInput = {
  id: string;
  status: CollectorRunStatusInput;
  errorCode?: string | null;
  errorMessage?: string | null;
  stats?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  payloadRef?: string | null;
  observedAt: Date;
  freshnessStatus: FreshnessStatus;
  confidence: number;
};

export type RecordSnapshotInput = {
  scope: string;
  snapshotKind: string;
  payload: Record<string, unknown>;
  money?: Money | null;
  idempotencyKey?: string;
} & Provenance;

export type ReviseSnapshotInput = {
  id: string;
  payload: Record<string, unknown>;
  observedAt: Date;
  freshnessStatus: FreshnessStatus;
  confidence: number;
  source: SourceRef;
};

export type RetentionPolicyInput = {
  maxAgeDays: number;
  applyDeletes?: boolean;
  actor: string;
  scope?: string;
  observedAt?: Date;
};

export type CreateAttentionItemInput = {
  scope: string;
  severity: AttentionSeverity;
  title: string;
  body: string;
  status?: AttentionStatus;
  relatedDirectiveId?: string | null;
  money?: Money | null;
  expiresAt?: Date | null;
} & Provenance;

export type StartAgentSessionInput = {
  scope: string;
  agentId: string;
  contextQuery?: Record<string, unknown>;
} & Provenance;

export type RecordAgentActivityInput = {
  correlationId: string;
  agentId: string;
  scope: string;
  status?: AgentActivityStatus;
  goal: string;
  summary: string;
  startedAt?: Date;
  finishedAt?: Date | null;
  payload?: Record<string, unknown>;
} & Provenance;

export type AppendAuditEventInput = {
  actor: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  scope: string;
  payload?: Record<string, unknown>;
} & Provenance;
