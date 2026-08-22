/**
 * Local CommercialSnapshot / SourceObservation contract.
 *
 * Canonical schemas live in control-center/contracts/ (owned by a parallel
 * workstream). This file is the adapter-local shape used until convergence.
 * Do not import that package from here.
 */

export const COMMERCIAL_SNAPSHOT_SCHEMA =
  "control-center.commercial-snapshot.v1" as const;

export const SNAPSHOT_SOURCE = "warmbly" as const;

export type FreshnessStatus = "FRESH" | "STALE" | "UNKNOWN" | "ERROR";

export type Money = {
  amount_cents: number;
  currency: string;
};

export type Provenance = {
  source: typeof SNAPSHOT_SOURCE;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence?: number;
};

export type AttentionKind =
  | "overdue_task"
  | "next_action"
  | "stalled_deal"
  | "exception_state"
  | "inbox_signal"
  | "campaign_signal"
  | "inbound_lead"
  | "confenge_attention";

export type AttentionSeverity = "high" | "medium" | "low";

export type EntityRef = {
  type: string;
  id: string;
};

export type CommercialAttentionItem = {
  id: string;
  kind: AttentionKind;
  title: string;
  why: string;
  severity: AttentionSeverity;
  entity_ref?: EntityRef;
  due_at?: string;
  commercial_state?: string;
  provenance: Provenance;
};

export type SourceObservation = {
  id: string;
  surface: string;
  kind: "fetch" | "gap" | "health";
  provenance: Provenance;
  http_method?: string;
  http_path?: string;
  http_status?: number;
  note?: string;
};

export type RequiredUpstreamContract = {
  id: string;
  method: "GET" | "POST" | "HEAD";
  path: string;
  reason: string;
  min_request: {
    method: string;
    path: string;
    query?: Record<string, string>;
    headers: string[];
    body?: Record<string, unknown>;
  };
  min_response: {
    status: number;
    body: Record<string, unknown>;
  };
};

export type CommercialCounts = {
  contacts: number;
  deals_open: number;
  deals_stalled: number;
  tasks_open: number;
  tasks_overdue: number;
  campaigns_active: number;
  inbox_unread: number;
  inbox_awaiting_reply: number;
  inbound_now: number;
  confenge_attention: number;
  attention: number;
};

export type ConnectorHealth = {
  status: string;
  api_version?: string;
  confenge_enabled?: boolean;
  version?: string;
};

export type CommercialSnapshot = {
  schema: typeof COMMERCIAL_SNAPSHOT_SCHEMA;
  source: typeof SNAPSHOT_SOURCE;
  observed_at: string;
  freshness_status: FreshnessStatus;
  health: ConnectorHealth;
  counts: CommercialCounts;
  deal_value_open?: Money;
  /**
   * Per-currency open pipeline totals, present only when the open deals span
   * more than one currency. The totals are never summed and never converted:
   * the Control Center has no rate source with a date and a provenance.
   */
  deal_value_open_by_currency?: Money[];
  attention: CommercialAttentionItem[];
  observations: SourceObservation[];
  required_upstream_contract: RequiredUpstreamContract[];
  /** Capped operational slice for Control Center projection. Not a CRM replica. */
  operations?: Record<string, unknown>;
};
