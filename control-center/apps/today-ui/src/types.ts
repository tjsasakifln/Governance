/**
 * Local copies of Control Center v1 field names plus the HOJE payload/view.
 * Canonical JSON Schema lives in the contracts workstream
 * (`control-center/contracts`). This app MUST NOT import that package
 * until the convergence campaign.
 *
 * Keep names in lockstep: source, observed_at, freshness_status, confidence,
 * cents+currency, freshness FRESH|STALE|UNKNOWN|ERROR.
 */

import type {
  ActorKind,
  AttentionSeverity,
  AttentionStatus,
  ClientLifecycle,
  ExecutionStatus,
  FreshnessStatus,
  HealthStatus,
  IncidentKind,
  OverrideAction,
  PriorityHorizon,
  ShortcutKind,
} from "./taxonomy.js";
import type { Money } from "./money.js";

export type UtcDateTime = string;
export type ResourceId = string;
export type Scope = string;

export interface SourceRef {
  system: string;
  kind: string;
  locator: string;
  label?: string;
}

export interface ActorRef {
  kind: ActorKind;
  id: string;
  display_name?: string;
}

/**
 * Provenance of aggregated information.
 * `freshness_status` is recency; `confidence` is trust. They are not aliases.
 */
export interface Provenance {
  source: SourceRef;
  observed_at: UtcDateTime;
  freshness_status: FreshnessStatus;
  confidence?: number;
  freshness_window_seconds?: number;
}

export interface AttentionItem {
  schema_version: "control-center.attention-item.v1";
  id: ResourceId;
  scope: Scope;
  severity: AttentionSeverity;
  status: AttentionStatus;
  title: string;
  summary: string;
  provenance: Provenance;
  detected_at: UtcDateTime;
  homepage_eligible: boolean;
  recommended_action?: string;
  related_ids?: ResourceId[];
  incident_kind?: IncidentKind;
}

export interface PriorityRecommendation {
  schema_version: "control-center.priority-recommendation.v1";
  id: ResourceId;
  scope: Scope;
  rank: number;
  title: string;
  rationale: string;
  provenance: Provenance;
  generated_at: UtcDateTime;
  horizon: PriorityHorizon;
  attention_item_ids?: ResourceId[];
  directive_ids?: ResourceId[];
}

export interface ClientStatus {
  schema_version: "control-center.client-status.v1";
  id: ResourceId;
  scope: Scope;
  client_slug: string;
  display_name: string;
  lifecycle: ClientLifecycle;
  provenance: Provenance;
  attention_item_ids?: ResourceId[];
  open_receivables?: Money;
  notes?: string;
}

export interface CommercialAuthorityStamp {
  catalog_authority: "governance";
  commercial_runtime: "warmbly";
  this_document: "read_model";
}

export interface CommercialSnapshot {
  schema_version: "control-center.commercial-snapshot.v1";
  id: ResourceId;
  scope: Scope;
  generated_at: UtcDateTime;
  provenance: Provenance;
  authority: CommercialAuthorityStamp;
  pipeline_open_count: number;
  inbound_unread_count: number;
  at_risk_client_count: number;
  attention_item_ids?: ResourceId[];
}

export interface FinanceSnapshot {
  schema_version: "control-center.finance-snapshot.v1";
  id: ResourceId;
  scope: Scope;
  generated_at: UtcDateTime;
  provenance: Provenance;
  read_model_only: true;
  provider_mutations: "forbidden";
  receivables_open: Money;
  receivables_overdue: Money;
  attention_item_ids?: ResourceId[];
}

export interface EngineeringSnapshot {
  schema_version: "control-center.engineering-snapshot.v1";
  id: ResourceId;
  scope: Scope;
  generated_at: UtcDateTime;
  provenance: Provenance;
  open_pr_count: number;
  failing_check_count: number;
  open_incident_count: number;
  repo_scopes?: Scope[];
  attention_item_ids?: ResourceId[];
}

export interface ServiceHealth {
  schema_version: "control-center.service-health.v1";
  id: ResourceId;
  scope: Scope;
  service_name: string;
  status: HealthStatus;
  provenance: Provenance;
  checked_at: UtcDateTime;
  latency_ms?: number;
  message?: string;
}

/**
 * Local copy of agent-ledger TimelineItem (execution ledger, not agent-session).
 * Convergence maps this from `control-center/domains/agent-activity`.
 */
export interface AgentTimelineItem {
  correlation_id: string;
  agent: { id: string; provider: string };
  repo: string;
  goal: string;
  campaign: string | null;
  started_at: UtcDateTime;
  finished_at: UtcDateTime | null;
  status: ExecutionStatus;
  summary: string;
  blockers: string[];
  residual_work: string[];
  source: SourceRef;
  observed_at: UtcDateTime;
  freshness_status: FreshnessStatus;
  confidence?: number;
}

/**
 * Local copy of attention-engine FounderOverride.
 * Ranking itself is applied upstream; HOJE only flags visibility.
 */
export interface FounderOverride {
  actor: ActorRef;
  at: UtcDateTime;
  action: OverrideAction;
  target_ids: ResourceId[];
}

export const FIXTURE_NAMES = [
  "dia-saudavel",
  "incendio-operacional",
  "dados-stale",
  "zero-atividade",
] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

export interface HojePayload {
  schema_version: "control-center.hoje-payload.v1";
  fixture_name: FixtureName;
  generated_at: UtcDateTime;
  headline: string;
  recommended_actions: PriorityRecommendation[];
  incidents: AttentionItem[];
  clients: ClientStatus[];
  commercial: CommercialSnapshot | null;
  finance: FinanceSnapshot | null;
  engineering: EngineeringSnapshot | null;
  infra: ServiceHealth[];
  agent_activity: AgentTimelineItem[];
  founder_override: FounderOverride | null;
}

export const BAND_IDS = [
  "top3",
  "incidents",
  "clients",
  "commercial",
  "finance",
  "engineering",
  "agents",
  "shortcuts",
] as const;
export type BandId = (typeof BAND_IDS)[number];

export const BAND_LABELS = [
  "Top 3 ações recomendadas",
  "Incidentes/blockers/riscos",
  "Clientes que exigem atenção",
  "Comercial em exceção",
  "Financeiro em exceção",
  "Engenharia/infra em exceção",
  "atividade recente de agentes",
  "shortcuts para registrar decisão/nota",
] as const;
export type BandLabel = (typeof BAND_LABELS)[number];

export type FreshnessTone = "green" | "amber" | "slate" | "red";

export interface HojeRow {
  id: string;
  title: string;
  summary: string;
  source: SourceRef;
  observed_at: UtcDateTime;
  observed_at_local: string;
  freshness_status: FreshnessStatus;
  freshness_tone: FreshnessTone;
  confidence?: number;
  founder_override_visible: boolean;
  founder_override_action?: OverrideAction;
  money?: Money;
  severity?: AttentionSeverity;
  kind?: string;
}

export interface ShortcutRow {
  kind: ShortcutKind;
  label: string;
  hint: string;
}

export interface BandView {
  id: BandId;
  label: BandLabel;
  compressed: boolean;
  compressed_summary: string | null;
  rows: HojeRow[];
  shortcuts: ShortcutRow[];
}

export interface HojeView {
  schema_version: "control-center.hoje-view.v1";
  fixture_name: FixtureName;
  generated_at: UtcDateTime;
  headline: string;
  bands: BandView[];
  charts_emitted: false;
}
