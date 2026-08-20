import { jsonObject } from './db.js';
import { moneyFromColumns, parseConfidence } from './money.js';
import type {
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

export type DirectiveRow = {
  id: string;
  kind: DirectiveKind;
  scope: string;
  status: DirectiveStatus;
  title: string;
  body: string;
  effective_from: Date;
  expires_at: Date | null;
  supersedes: string | null;
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
  supersedes: string | null;
  created_by: string;
  source: string;
  observed_at: Date;
  freshness_status: FreshnessStatus;
  confidence: string | number | null;
  recorded_at: Date;
  recorded_by: string;
};

export type CurrentDirectiveRow = {
  directive_id: string;
  revision_id: string;
  kind: DirectiveKind;
  scope: string;
  status: DirectiveStatus;
  title: string;
  effective_from: Date;
  expires_at: Date | null;
  supersedes: string | null;
  created_by: string;
  source: string;
  observed_at: Date;
  freshness_status: FreshnessStatus;
  confidence: string | number | null;
  updated_at: Date;
};

export type CollectorRunRow = {
  id: string;
  collector_name: string;
  idempotency_key: string;
  status: CollectorRun['status'];
  started_at: Date;
  finished_at: Date | null;
  source: string;
  observed_at: Date;
  freshness_status: FreshnessStatus;
  confidence: string | number | null;
  scope: string;
  error_code: string | null;
  stats: unknown;
};

export type ObservationRow = {
  id: string;
  source: string;
  observed_at: Date;
  freshness_status: FreshnessStatus;
  confidence: string | number | null;
  scope: string;
  observation_kind: string;
  payload: unknown;
  money_amount_cents: string | number | null;
  money_currency: string | null;
  idempotency_key: string;
  collector_run_id: string | null;
  created_at: Date;
};

export type SnapshotRow = {
  id: string;
  scope: string;
  snapshot_kind: string;
  source: string;
  observed_at: Date;
  freshness_status: FreshnessStatus;
  confidence: string | number | null;
  payload: unknown;
  money_amount_cents: string | number | null;
  money_currency: string | null;
  created_at: Date;
};

export type AttentionRow = {
  id: string;
  scope: string;
  severity: AttentionItem['severity'];
  title: string;
  body: string;
  status: AttentionItem['status'];
  source: string;
  observed_at: Date;
  freshness_status: FreshnessStatus;
  confidence: string | number | null;
  related_directive_id: string | null;
  money_amount_cents: string | number | null;
  money_currency: string | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type AgentSessionRow = {
  id: string;
  scope: string;
  agent_id: string;
  started_at: Date;
  ended_at: Date | null;
  context_query: unknown;
  source: string;
  observed_at: Date;
  freshness_status: FreshnessStatus;
  confidence: string | number | null;
};

export type AuditEventRow = {
  id: string;
  occurred_at: Date;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  scope: string;
  payload: unknown;
  source: string;
  observed_at: Date;
  freshness_status: FreshnessStatus;
};

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
    supersedes: row.supersedes,
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
    supersedes: row.supersedes,
    createdBy: row.created_by,
    source: row.source,
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
    supersedes: row.supersedes,
    createdBy: row.created_by,
    source: row.source,
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
    source: row.source,
    observedAt: row.observed_at,
    freshnessStatus: row.freshness_status,
    confidence: parseConfidence(row.confidence),
    scope: row.scope,
    errorCode: row.error_code,
    stats: jsonObject(row.stats),
  };
}

export function mapObservation(row: ObservationRow): SourceObservation {
  return {
    id: row.id,
    source: row.source,
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
    source: row.source,
    observedAt: row.observed_at,
    freshnessStatus: row.freshness_status,
    confidence: parseConfidence(row.confidence),
    payload: jsonObject(row.payload),
    money: moneyFromColumns(row.money_amount_cents, row.money_currency),
    createdAt: row.created_at,
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
    source: row.source,
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
    source: row.source,
    observedAt: row.observed_at,
    freshnessStatus: row.freshness_status,
    confidence: parseConfidence(row.confidence),
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
    source: row.source,
    observedAt: row.observed_at,
    freshnessStatus: row.freshness_status,
    confidence: null,
  };
}
