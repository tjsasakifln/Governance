/**
 * Local ClientStatus / provenance contract for this workstream.
 *
 * Canonical types will live in `control-center/contracts` after convergence.
 * This file is a copy of the fields this domain owns plus the shared
 * provenance envelope. Do not import the sibling tree from here.
 *
 * Convergence mapping (documented, not imported):
 * - `source` string here → contracts `Provenance.source` SourceRef
 *   (`manual` → { system: "manual", kind: "human-entry", locator: "manual" },
 *    `governance` → { system: "governance", kind: "canonical", locator: "governance" },
 *    `adapter:<port>` → { system: <port>, kind: "adapter", locator: "adapter:<port>" }).
 * - `freshness_status` lowercase here → contracts uppercase
 *   (fresh→FRESH, stale→STALE, unknown→UNKNOWN, error→ERROR).
 * - `client_slug` / `display_name` / `scope` (`client:<slug>`) / `id`
 *   (`cc:client-status:<slug>`) / `schema_version` match contracts.
 * - Rich delivery fields (health, commitments, next_action, due_dates,
 *   blockers, deliverables, risk) are owned by this domain; the contracts
 *   stub of ClientStatus is thinner and must be extended at convergence.
 * - Money, if ever attached, is `{ amount_cents, currency }` — never floats.
 */

export const SCHEMA_VERSION = "control-center.client-status.v1" as const;

export const UTC_DATETIME_PATTERN =
  "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z$";

export const CLIENT_SLUG_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";

/**
 * Minimum client identity. Mirrors `RESERVED_CLIENT_SLUGS` /
 * `MIN_CLIENT_SLUG_LENGTH` in `control-center/contracts` (documented, not
 * imported — see the convergence note above). A record whose only identifier is
 * one of these tokens has no identity: it belongs in a data-quality queue, not
 * in this store. Ingesting it would publish a client that does not exist.
 */
export const MIN_CLIENT_SLUG_LENGTH = 2;

export const RESERVED_CLIENT_SLUGS = [
  "anonimo",
  "anonymous",
  "client",
  "cliente",
  "default",
  "desconhecido",
  "na",
  "n-a",
  "nao-identificado",
  "nao-informado",
  "no-name",
  "none",
  "null",
  "placeholder",
  "sem-identidade",
  "sem-nome",
  "tbd",
  "undefined",
  "unidentified",
  "unknown",
] as const;

export type ReservedClientSlug = (typeof RESERVED_CLIENT_SLUGS)[number];

export function isReservedClientSlug(value: string): boolean {
  return (RESERVED_CLIENT_SLUGS as readonly string[]).includes(value.trim().toLowerCase());
}

export const FACT_ID_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";

export const OWNER_PATTERN = "^[a-z][a-z0-9_-]{0,63}$";

export const EVIDENCE_REF_PATTERN = "^[a-z0-9][a-z0-9:._/~-]{0,255}$";

export const CURRENCY_PATTERN = "^[A-Z]{3}$";

export const INGEST_SOURCE_PATTERN =
  "^(manual|governance|adapter:[a-z][a-z0-9-]{0,63})$";

export const ANY_SOURCE_PATTERN =
  "^(manual|governance|adapter:[a-z][a-z0-9-]{0,63}|derived:[a-z][a-z0-9-]{0,63})$";

export const FRESHNESS_STATUSES = ["fresh", "stale", "unknown", "error"] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

export const COMMITMENT_STATUSES = [
  "open",
  "due",
  "overdue",
  "done",
  "cancelled",
] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

export const BLOCKER_STATUSES = ["open", "resolved"] as const;
export type BlockerStatus = (typeof BLOCKER_STATUSES)[number];

export const DELIVERABLE_STATUSES = [
  "pending",
  "in_progress",
  "delivered",
  "blocked",
] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];

export const RISK_STATUSES = ["open", "mitigated", "closed"] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];

export const RISK_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type RiskSeverity = (typeof RISK_SEVERITIES)[number];

export const HEALTH_BANDS = ["healthy", "watch", "attention", "critical"] as const;
export type HealthBand = (typeof HEALTH_BANDS)[number];

export const CLIENT_LIFECYCLES = [
  "lead",
  "active",
  "paused",
  "churn_risk",
  "churned",
  "unknown",
] as const;
export type ClientLifecycle = (typeof CLIENT_LIFECYCLES)[number];

export const HEALTH_REASON_CODES = [
  "overdue_commitment",
  "due_soon_commitment",
  "open_blocker",
  "open_risk",
  "blocked_deliverable",
] as const;
export type HealthReasonCode = (typeof HEALTH_REASON_CODES)[number];

export const SOURCE_MANUAL = "manual";
export const SOURCE_GOVERNANCE = "governance";
export const SOURCE_DERIVED_HEALTH = "derived:health-score";
export const SOURCE_DERIVED_NEXT_ACTION = "derived:next-action";
export const SOURCE_DERIVED_DUE_DATES = "derived:due-dates";

/** Every aggregated fact carries this envelope. `confidence` is optional. */
export interface Provenance {
  source: string;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence?: number;
}

/** Integer cents + ISO-4217 currency. Never floats, never formatted strings. */
export interface Money {
  amount_cents: number;
  currency: string;
}

export interface Commitment {
  id: string;
  title: string;
  owner: string;
  due_at: string;
  evidence_ref: string;
  status: CommitmentStatus;
  provenance: Provenance;
}

export interface Blocker {
  id: string;
  title: string;
  owner: string | null;
  evidence_ref: string | null;
  status: BlockerStatus;
  provenance: Provenance;
}

export interface Deliverable {
  id: string;
  title: string;
  status: DeliverableStatus;
  due_at: string | null;
  evidence_ref: string | null;
  provenance: Provenance;
}

export interface Risk {
  id: string;
  title: string;
  severity: RiskSeverity;
  status: RiskStatus;
  evidence_ref: string | null;
  provenance: Provenance;
}

export interface NextAction {
  summary: string;
  due_at: string | null;
  owner: string | null;
  provenance: Provenance;
}

export interface HealthReason {
  code: HealthReasonCode;
  delta: number;
  message: string;
  related_id: string | null;
}

export interface AccountHealth {
  score: number;
  band: HealthBand;
  reasons: HealthReason[];
  provenance: Provenance;
}

export interface DueDate {
  kind: "commitment" | "deliverable";
  ref: string;
  label: string;
  at: string;
  provenance: Provenance;
}

/**
 * Delivery/account-health read model. Not a CRM contact/lead/pipeline record.
 * Identity is a stable slug + non-sensitive display name only.
 */
export interface ClientStatus {
  schema_version: typeof SCHEMA_VERSION;
  id: string;
  scope: string;
  client_slug: string;
  display_name: string;
  lifecycle: ClientLifecycle;
  health: AccountHealth;
  commitments: Commitment[];
  next_action: NextAction | null;
  due_dates: DueDate[];
  blockers: Blocker[];
  deliverables: Deliverable[];
  risk: Risk[];
  provenance: Provenance;
}

export interface AttentionItem {
  client_slug: string;
  display_name: string;
  scope: string;
  why: string[];
  next_action: NextAction | null;
  health_score: number;
  health_band: HealthBand;
  reasons: HealthReason[];
  urgency: number;
}

export interface HomepageAttention {
  client_slug: string;
  display_name: string;
  why: string[];
  next_action_summary: string;
}

export interface DueCommitmentItem {
  client_slug: string;
  display_name: string;
  commitment: Commitment;
  overdue: boolean;
}

export interface OpenBlockerItem {
  client_slug: string;
  display_name: string;
  blocker: Blocker;
}

/**
 * Future adapter port. Collectors in other workstreams implement this.
 * This package does not call Warmbly/Asaas/GitHub.
 */
export interface ClientFactsPort {
  readonly portName: string;
  collect(scope: string): Promise<unknown[]>;
}

export function clientStatusId(slug: string): string {
  return `cc:client-status:${slug}`;
}

export function clientScope(slug: string): string {
  return `client:${slug}`;
}

export function adapterSource(port: string): string {
  return `adapter:${port}`;
}
