export const PROJECTOR_VERSION = "control-center.projector.v1" as const;

export const AVAILABILITY = [
  "NO_DATA",
  "NOT_CONFIGURED",
  "BLOCKED_BY_SECRET",
  "UPSTREAM_ERROR",
  "STALE",
  "UNKNOWN",
  "FRESH",
] as const;
export type Availability = (typeof AVAILABILITY)[number];

export const FRESHNESS = ["FRESH", "STALE", "UNKNOWN", "ERROR"] as const;
export type FreshnessStatus = (typeof FRESHNESS)[number];

export const DOMAIN_SNAPSHOT_KINDS = [
  "commercial",
  "finance",
  "clients",
  "engineering",
  "infrastructure",
  "pncp",
] as const;
export type DomainSnapshotKind = (typeof DOMAIN_SNAPSHOT_KINDS)[number];

export const CONFENGE_OPERATIONAL_REPOS = [
  "tjsasakifln/Governance",
  "tjsasakifln/warmbly",
  "tjsasakifln/extra-cli",
  "tjsasakifln/web-cfg",
] as const;

export const COHORT_WINDOWS = ["7d", "28d", "90d", "open"] as const;
export type CohortWindow = (typeof COHORT_WINDOWS)[number];

export const LIST_CAP = 50;
export const TINY_DENOMINATOR = 10;

export interface SourceRef {
  system: string;
  kind: string;
  locator: string;
  label?: string;
}

export interface CollectorEnvelope {
  collector: string;
  freshness_status: FreshnessStatus;
  observed_at: string;
  source: SourceRef;
  confidence: number;
  error?: { code: string; message: string };
  payload: unknown;
}

export interface ProjectedSnapshot {
  projector_version: typeof PROJECTOR_VERSION;
  snapshot_kind: DomainSnapshotKind;
  scope: string;
  payload: Record<string, unknown>;
  freshness_status: FreshnessStatus;
  availability: Availability;
  confidence: number;
  observed_at: string;
  source: SourceRef;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const rec = asRecord(value);
  if (rec && Array.isArray(rec.data)) return rec.data;
  if (rec && Array.isArray(rec.items)) return rec.items;
  if (rec && Array.isArray(rec.repos)) return rec.repos;
  return [];
}

export function capList<T>(items: readonly T[], cap = LIST_CAP): T[] {
  return items.slice(0, cap);
}

export function isoOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.endsWith("Z") ? value : fallback;
}

export function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function integerOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}
