/**
 * Local contracts for the commercial executive read model.
 *
 * Canonical JSON Schema for CommercialSnapshot lives in
 * `control-center/contracts/` (parallel workstream). Persistence taxonomies
 * live in `control-center/persistence/`. The Warmbly HTTP collector lives in
 * `control-center/connectors/warmbly/`. This package MUST NOT import those
 * trees; it ships a local adapter until the convergence campaign.
 *
 * Freshness closed set here matches the contracts workstream
 * (`FRESH` | `STALE` | `UNKNOWN` | `ERROR`), not persistence
 * (`fresh` | `stale` | `unknown` | `expired`). Do not rewrite persistence.
 */

export const SUMMARY_SCHEMA_VERSION =
  "control-center.commercial-summary.v1" as const;

export const OBSERVATION_SCHEMA_VERSION =
  "control-center.commercial-observations.v1" as const;

export const FRESHNESS_STATUSES = [
  "FRESH",
  "STALE",
  "UNKNOWN",
  "ERROR",
] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

export const FUNNEL_KEYS = [
  "novos_leads",
  "qualificados",
  "oportunidades",
  "propostas",
  "clientes",
] as const;
export type FunnelKey = (typeof FUNNEL_KEYS)[number];

export const ATTENTION_KINDS = [
  "extra_historical_as_offer",
  "unknown_offer_id",
  "offer_version_drift",
  "missing_next_action",
  "stalled_stage",
  "conversion_window_gap",
  "aging",
] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

export const ATTENTION_SEVERITIES = [
  "critical",
  "high",
  "medium",
  "low",
] as const;
export type AttentionSeverity = (typeof ATTENTION_SEVERITIES)[number];

export const PIPELINE_TREATMENTS = ["present", "insufficient_data"] as const;
export type PipelineTreatment = (typeof PIPELINE_TREATMENTS)[number];

export const DEFAULT_CURRENCY = "BRL";
export const EXTRA_HISTORICAL_AMOUNT_CENTS = 1_000_000;
export const EXTRA_HISTORICAL_EXCEPTION_ID = "CFG-EXC-EXTRA-HISTORICAL-v1";
export const ATTENTION_NOW_LIMIT = 3;
export const FRESHNESS_WINDOW_SECONDS = 86_400;
export const AGING_MS = 14 * 24 * 60 * 60 * 1000;
export const STALL_MS = 14 * 24 * 60 * 60 * 1000;
export const CONVERSION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Pin identity only. Never a copied catalog (no names, prices, terms, copy). */
export type KnownOfferPin = {
  offer_id: string;
  offer_version: string;
};

export type ExtraHistoricalMarker = {
  kind: "extra_historical";
  exception_id: string;
  amount_cents: number;
  currency: string;
};

export type GovernanceOfferPin = {
  authority_id: string;
  catalog_id: string;
  catalog_authority: "governance";
  known_offers: KnownOfferPin[];
  not_an_offer: ExtraHistoricalMarker[];
  observed_at?: string;
  freshness_status?: FreshnessStatus;
  confidence?: number;
};

export type SourceRef = {
  system: string;
  kind: string;
  locator: string;
  label?: string;
};

export type Provenance = {
  source: SourceRef;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence?: number;
  freshness_window_seconds?: number;
};

export type Money = {
  amount_cents: number;
  currency: string;
};

/**
 * Warmbly-shaped commercial record. Later the Warmbly connector can emit this
 * without this package calling Warmbly itself.
 *
 * `value` is Warmbly major-unit money (float). Conversion to cents is
 * fail-closed: not silently rounded.
 * `probability` is a closed unit interval. Warmbly CRM deals currently have
 * no win-probability field; weighted pipeline stays insufficient_data unless
 * the input explicitly marks probabilities reliable.
 */
export type WarmblyCommercialRecord = {
  id: string;
  entity: "deal" | "inbound_lead" | "contact" | "task";
  status?: string | null;
  funnel_stage?: FunnelKey | "UNKNOWN" | string | null;
  stage_id?: string | null;
  stage_name?: string | null;
  stage_entered_at?: string | null;
  value?: number | null;
  amount_cents?: number | null;
  currency?: string | null;
  probability?: number | null;
  probability_reliable?: boolean | null;
  offer_id?: string | null;
  offer_version?: string | null;
  treated_as_catalog_offer?: boolean | null;
  next_action?: string | null;
  next_action_at?: string | null;
  last_activity_at?: string | null;
  expected_close_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  observed_at?: string | null;
  freshness_status?: FreshnessStatus | string | null;
  confidence?: number | null;
  deal_id?: string | null;
  inbound_lead_id?: string | null;
  due_date?: string | null;
};

export type StageMap = Record<string, FunnelKey>;

export type CommercialObservationSet = {
  schema_version: typeof OBSERVATION_SCHEMA_VERSION | string;
  observed_at?: string | null;
  source?: Partial<SourceRef> | string | null;
  freshness_status?: FreshnessStatus | string | null;
  confidence?: number | null;
  records?: WarmblyCommercialRecord[] | null;
  stage_map?: StageMap | null;
  offer_pin?: GovernanceOfferPin | null;
};

export type AggregatedFigure = {
  key: string;
  value: number;
  source: SourceRef;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence?: number;
};

export type PipelineMoney = {
  treatment: PipelineTreatment;
  amount_cents?: number;
  currency?: string;
  reason?: string;
  provenance: Provenance;
};

export type ExceptionRow = {
  id: string;
  kind: AttentionKind;
  record_id: string;
  severity: AttentionSeverity;
  title: string;
  summary: string;
  recommended_action: string;
  provenance: Provenance;
};

export type AttentionItem = {
  id: string;
  kind: AttentionKind;
  record_id: string;
  severity: AttentionSeverity;
  horizon: "now";
  title: string;
  summary: string;
  recommended_action: string;
  provenance: Provenance;
};

export type CommercialSummary = {
  schema_version: typeof SUMMARY_SCHEMA_VERSION;
  scope: "commercial";
  generated_at: string;
  authority: {
    catalog_authority: "governance";
    commercial_runtime: "warmbly";
    this_document: "read_model";
    offer_pin: {
      authority_id: string;
      catalog_id: string;
      pin_observed_at: string;
    };
  };
  provenance: Provenance;
  funnel: Record<FunnelKey, AggregatedFigure>;
  pipeline: {
    nominal: PipelineMoney;
    weighted: PipelineMoney;
  };
  exceptions: ExceptionRow[];
  attention: {
    horizon: "now";
    items: AttentionItem[];
  };
  unclassified: AggregatedFigure;
};

export type ProjectOptions = {
  now?: Date;
};

/**
 * Sibling interfaces expected at convergence. Documented here; not imported.
 *
 * control-center/connectors/warmbly:
 *   collectFromWarmblyPayload(payload) → Warmbly-shaped records compatible
 *   with CommercialObservationSet.records (read-only GET/POST search).
 *
 * control-center/contracts:
 *   CommercialSnapshot v1 is currently a thin cockpit document
 *   (pipeline_open_count, inbound_unread_count, at_risk_client_count).
 *   This executive summary is a richer local projection. A later additive
 *   schema revision should carry funnel + pipeline money + attention.
 *
 * control-center/persistence:
 *   Store the summary payload as an operational snapshot scoped `commercial`.
 *   Map local FRESHNESS_STATUSES to persistence casing at the boundary;
 *   do not change persistence enums from this workstream.
 *
 * control-center/services/context + MCP:
 *   Agents query by scope `commercial`. They do not receive this whole
 *   document unless that scope is granted.
 */
export const EXPECTED_CONVERGENCE = {
  warmbly_connector: "control-center/connectors/warmbly",
  contracts: "control-center/contracts",
  persistence: "control-center/persistence",
  context_service: "control-center/services/context",
  mcp: "control-center/mcp",
} as const;
