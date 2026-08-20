export const DIRECTIVE_KINDS = [
  'decision',
  'directive',
  'fact',
  'constraint',
  'priority',
  'risk',
  'hypothesis',
] as const;
export type DirectiveKind = (typeof DIRECTIVE_KINDS)[number];

export const DIRECTIVE_STATUSES = [
  'draft',
  'active',
  'superseded',
  'expired',
  'withdrawn',
] as const;
export type DirectiveStatus = (typeof DIRECTIVE_STATUSES)[number];

export const FRESHNESS_STATUSES = ['fresh', 'stale', 'unknown', 'expired'] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

export const COLLECTOR_RUN_STATUSES = ['started', 'succeeded', 'failed', 'skipped'] as const;
export type CollectorRunStatus = (typeof COLLECTOR_RUN_STATUSES)[number];

export const ATTENTION_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type AttentionSeverity = (typeof ATTENTION_SEVERITIES)[number];

export const ATTENTION_STATUSES = ['open', 'acknowledged', 'resolved', 'dismissed'] as const;
export type AttentionStatus = (typeof ATTENTION_STATUSES)[number];

export type Money = {
  amountCents: number;
  currency: string;
};

export type Provenance = {
  source: string;
  observedAt: Date;
  freshnessStatus: FreshnessStatus;
  confidence: number | null;
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
  supersedes: string | null;
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
  supersedes: string | null;
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
  supersedes: string | null;
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
  stats: Record<string, unknown>;
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
  kind: DirectiveKind;
  scope: string;
  status?: DirectiveStatus;
  title: string;
  body: string;
  effectiveFrom: Date;
  expiresAt?: Date | null;
  createdBy: string;
  recordedBy?: string;
  supersedes?: string | null;
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
  status: Exclude<CollectorRunStatus, 'started'>;
  errorCode?: string | null;
  stats?: Record<string, unknown>;
  observedAt: Date;
  freshnessStatus: FreshnessStatus;
  confidence?: number | null;
};

export type RecordSnapshotInput = {
  scope: string;
  snapshotKind: string;
  payload: Record<string, unknown>;
  money?: Money | null;
} & Provenance;

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

export type AppendAuditEventInput = {
  actor: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  scope: string;
  payload?: Record<string, unknown>;
} & Provenance;
