import { jsonObject } from './db.js';
import { asTextArray, mapSourceRef, moneyFromColumns, parseConfidence } from './money.js';
import type {
  AgentActivity,
  AgentActivityRevision,
  AgentSession,
  AttentionItem,
  AuditEvent,
  CollectorRun,
  CurrentDirective,
  Directive,
  DirectiveKind,
  DirectiveRevision,
  DirectiveStatus,
  FreshnessStatus,
  OperationalSnapshot,
  SourceObservation,
} from './types.js';

type SourceColumns = {
  source_system: string;
  source_kind: string;
  source_locator: string;
  source_label: string | null;
};

export type DirectiveRow = {
  id: string;
  kind: DirectiveKind;
  scope: string;
  status: DirectiveStatus;
  title: string;
  body: string;
  effective_from: Date;
  expires_at: Date | null;
  supersedes: unknown;
  created_by: string;
  created_at: Date;
  current_revision_id: string;
};

export type DirectiveRevisionRow = {
  id: string;
  directive_id: string;
  revision_no: number;
  kind: DirectiveKind;
  scope: string;
  status: DirectiveStatus;
  title: string;
  body: string;
  effective_from: Date;
  expires_at: Date | null;
  supersedes: unknown;
  created_by: string;
  observed_at: Date;
  freshness_status: FreshnessStatus;
  confidence: string | number;
  recorded_at: Date;
  recorded_by: string;
} & SourceColumns;

export type CurrentDirectiveRow = {
  directive_id: string;
  revision_id: string;
  kind: DirectiveKind;
  scope: string;
  status: DirectiveStatus;
  title: string;
  effective_from: Date;
  expires_at: Date | null;
  supersedes: unknown;
  created_by: string;
  observed_at: Date;
  freshness_status: FreshnessStatus;
  confidence: string | number;
  updated_at: Date;
} & SourceColumns;

export type CollectorRunRow = {
  id: string;
  collector_name: string;
  idempotency_key: string;
  status: CollectorRun['status'];
  started_at: Date;
  finished_at: Date | null;
  observed_at: Date;
  freshness_status: FreshnessStatus;
  confidence: string | number;
  scope: string;
  error_code: string | null;
  error_message: string | null;
  stats: unknown;
  payload_ref: string | null;
  revision_no: number;
} & SourceColumns;

export type ObservationRow = {
  id: string;
  observed_at: Date;
  freshness_status: FreshnessStatus;
  confidence: string | number;
  scope: string;
  observation_kind: string;
  payload: unknown;
  money_amount_cents: string | number | null;
  money_currency: string | null;
  idempotency_key: string;
  collector_run_id: string | null;
  created_at: Date;
} & SourceColumns;

export type SnapshotRow = {
  id: string;
  scope: string;
  snapshot_kind: string;
  observed_at: Date;
  freshness_status: FreshnessStatus;
  confidence: string | number;
  payload: unknown;
  money_amount_cents: string | number | null;
  money_currency: string | null;
  created_at: Date;
  idempotency_key: string;
  revision_no: number;
} & SourceColumns;

export type AttentionRow = {
  id: string;
  scope: string;
  severity: AttentionItem['severity'];
  title: string;
  body: string;
  status: AttentionItem['status'];
  observed_at: Date;
  freshness_status: FreshnessStatus;
  confidence: string | number;
  related_directive_id: string | null;
  money_amount_cents: string | number | null;
  money_currency: string | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
} & SourceColumns;

export type AgentSessionRow = {
  id: string;
  scope: string;
  agent_id: string;
  started_at: Date;
  ended_at: Date | null;
  context_query: unknown;
  observed_at: Date;
  freshness_status: FreshnessStatus;
  confidence: string | number;
} & SourceColumns;

export type AgentActivityRow = {
  id: string;
  correlation_id: string;
  scope: string;
  agent_id: string;
  status: AgentActivity['status'];
  goal: string;
  summary: string;
  started_at: Date;
  finished_at: Date | null;
  observed_at: Date;
  freshness_status: FreshnessStatus;
  confidence: string | number;
  payload: unknown;
  current_revision_no: number;
  created_at: Date;
} & SourceColumns;

export type AgentActivityRevisionRow = {
  id: string;
  activity_id: string;
  revision_no: number;
  status: AgentActivity['status'];
  summary: string;
  observed_at: Date;
  freshness_status: FreshnessStatus;
  confidence: string | number;
  recorded_at: Date;
} & SourceColumns;

export type AuditEventRow = {
  id: string;
  occurred_at: Date;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  scope: string;
  payload: unknown;
  observed_at: Date;
  freshness_status: FreshnessStatus;
  confidence: string | number;
} & SourceColumns;

export function mapDirective(row: DirectiveRow): Directive {
  return {
    id: row.id,
    kind: row.kind,
    scope: row.scope,
    status: row.status,
    title: row.title,
    body: row.body,
    effectiveFrom: row.effective_from,
    expiresAt: row.expires_at,
    supersedes: asTextArray(row.supersedes),
    createdBy: row.created_by,
    createdAt: row.created_at,
    currentRevisionId: row.current_revision_id,
  };
}

export function mapRevision(row: DirectiveRevisionRow): DirectiveRevision {
  return {
    id: row.id,
    directiveId: row.directive_id,
    revisionNo: row.revision_no,
    kind: row.kind,
    scope: row.scope,
    status: row.status,
    title: row.title,
    body: row.body,
    effectiveFrom: row.effective_from,
    expiresAt: row.expires_at,
    supersedes: asTextArray(row.supersedes),
    createdBy: row.created_by,
    source: mapSourceRef(row),
    observedAt: row.observed_at,
    freshnessStatus: row.freshness_status,
    confidence: parseConfidence(row.confidence),
    recordedAt: row.recorded_at,
    recordedBy: row.recorded_by,
  };
}

export function mapCurrentDirective(row: CurrentDirectiveRow): CurrentDirective {
  return {
    directiveId: row.directive_id,
    revisionId: row.revision_id,
    kind: row.kind,
    scope: row.scope,
    status: row.status,
    title: row.title,
    effectiveFrom: row.effective_from,
    expiresAt: row.expires_at,
    supersedes: asTextArray(row.supersedes),
    createdBy: row.created_by,
    source: mapSourceRef(row),
    observedAt: row.observed_at,
    freshnessStatus: row.freshness_status,
    confidence: parseConfidence(row.confidence),
    updatedAt: row.updated_at,
  };
}

export function mapCollectorRun(row: CollectorRunRow): CollectorRun {
  return {
    id: row.id,
    collectorName: row.collector_name,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    source: mapSourceRef(row),
    observedAt: row.observed_at,
    freshnessStatus: row.freshness_status,
    confidence: parseConfidence(row.confidence),
    scope: row.scope,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    stats: jsonObject(row.stats),
    payloadRef: row.payload_ref,
    revisionNo: Number(row.revision_no),
  };
}

export function mapObservation(row: ObservationRow): SourceObservation {
  return {
    id: row.id,
    source: mapSourceRef(row),
    observedAt: row.observed_at,
    freshnessStatus: row.freshness_status,
    confidence: parseConfidence(row.confidence),
    scope: row.scope,
    observationKind: row.observation_kind,
    payload: jsonObject(row.payload),
    money: moneyFromColumns(row.money_amount_cents, row.money_currency),
    idempotencyKey: row.idempotency_key,
    collectorRunId: row.collector_run_id,
    createdAt: row.created_at,
  };
}

export function mapSnapshot(row: SnapshotRow): OperationalSnapshot {
  return {
    id: row.id,
    scope: row.scope,
    snapshotKind: row.snapshot_kind,
    source: mapSourceRef(row),
    observedAt: row.observed_at,
    freshnessStatus: row.freshness_status,
    confidence: parseConfidence(row.confidence),
    payload: jsonObject(row.payload),
    money: moneyFromColumns(row.money_amount_cents, row.money_currency),
    createdAt: row.created_at,
    idempotencyKey: row.idempotency_key,
    revisionNo: Number(row.revision_no),
  };
}

export function mapAttention(row: AttentionRow): AttentionItem {
  return {
    id: row.id,
    scope: row.scope,
    severity: row.severity,
    title: row.title,
    body: row.body,
    status: row.status,
    source: mapSourceRef(row),
    observedAt: row.observed_at,
    freshnessStatus: row.freshness_status,
    confidence: parseConfidence(row.confidence),
    relatedDirectiveId: row.related_directive_id,
    money: moneyFromColumns(row.money_amount_cents, row.money_currency),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapAgentSession(row: AgentSessionRow): AgentSession {
  return {
    id: row.id,
    scope: row.scope,
    agentId: row.agent_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    contextQuery: jsonObject(row.context_query),
    source: mapSourceRef(row),
    observedAt: row.observed_at,
    freshnessStatus: row.freshness_status,
    confidence: parseConfidence(row.confidence),
  };
}

export function mapAgentActivity(row: AgentActivityRow): AgentActivity {
  return {
    id: row.id,
    correlationId: row.correlation_id,
    scope: row.scope,
    agentId: row.agent_id,
    status: row.status,
    goal: row.goal,
    summary: row.summary,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    source: mapSourceRef(row),
    observedAt: row.observed_at,
    freshnessStatus: row.freshness_status,
    confidence: parseConfidence(row.confidence),
    payload: jsonObject(row.payload),
    currentRevisionNo: row.current_revision_no,
    createdAt: row.created_at,
  };
}

export function mapAgentActivityRevision(row: AgentActivityRevisionRow): AgentActivityRevision {
  return {
    id: row.id,
    activityId: row.activity_id,
    revisionNo: row.revision_no,
    status: row.status,
    summary: row.summary,
    source: mapSourceRef(row),
    observedAt: row.observed_at,
    freshnessStatus: row.freshness_status,
    confidence: parseConfidence(row.confidence),
    recordedAt: row.recorded_at,
  };
}

export function mapAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actor: row.actor,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    scope: row.scope,
    payload: jsonObject(row.payload),
    source: mapSourceRef(row),
    observedAt: row.observed_at,
    freshnessStatus: row.freshness_status,
    confidence: parseConfidence(row.confidence),
  };
}
