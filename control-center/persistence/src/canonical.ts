/**
 * Persistence canonical primitives. Public ontology is control-center/contracts.
 * Helpers below are storage-side; they must not invent a second freshness enum.
 */
import {
  CONFIDENCE_MAX as CONTRACTS_CONFIDENCE_MAX,
  CONFIDENCE_MIN as CONTRACTS_CONFIDENCE_MIN,
  CURRENCY_PATTERN as CONTRACTS_CURRENCY_PATTERN,
  DIRECTIVE_KINDS as CONTRACTS_DIRECTIVE_KINDS,
  DIRECTIVE_STATUSES as CONTRACTS_DIRECTIVE_STATUSES,
  FRESHNESS_STATUSES as CONTRACTS_FRESHNESS_STATUSES,
  RESOURCE_ID_PATTERN as CONTRACTS_RESOURCE_ID_PATTERN,
  SCOPE_CORE as CONTRACTS_SCOPE_CORE,
  SCOPE_LITERALS as CONTRACTS_SCOPE_LITERALS,
  SCOPE_PATTERN as CONTRACTS_SCOPE_PATTERN,
} from "@confenge/control-center-contracts";

export const FRESHNESS_STATUSES = CONTRACTS_FRESHNESS_STATUSES;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

export const DIRECTIVE_KINDS = CONTRACTS_DIRECTIVE_KINDS;
export type DirectiveKind = (typeof DIRECTIVE_KINDS)[number];

export const DIRECTIVE_STATUSES = CONTRACTS_DIRECTIVE_STATUSES;
export type DirectiveStatus = (typeof DIRECTIVE_STATUSES)[number];

export const SCOPE_LITERALS = CONTRACTS_SCOPE_LITERALS;
export type ScopeLiteral = (typeof SCOPE_LITERALS)[number];

export const RESOURCE_ID_PATTERN = CONTRACTS_RESOURCE_ID_PATTERN;
export const RESOURCE_ID_RE = new RegExp(RESOURCE_ID_PATTERN);

export const SCOPE_CORE = CONTRACTS_SCOPE_CORE;
export const SCOPE_PATTERN = CONTRACTS_SCOPE_PATTERN;
export const SCOPE_RE = new RegExp(SCOPE_PATTERN);

export const CONFIDENCE_MIN = CONTRACTS_CONFIDENCE_MIN;
export const CONFIDENCE_MAX = CONTRACTS_CONFIDENCE_MAX;
export const CURRENCY_PATTERN = CONTRACTS_CURRENCY_PATTERN;

export const SOURCE_SYSTEM_PATTERN = '^[a-z][a-z0-9-]*$';
export const SOURCE_SYSTEM_RE = new RegExp(SOURCE_SYSTEM_PATTERN);
export const SOURCE_KIND_PATTERN = '^[a-z][a-z0-9._-]*$';
export const SOURCE_KIND_RE = new RegExp(SOURCE_KIND_PATTERN);

export const UUID_PATTERN =
  '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
export const UUID_RE = new RegExp(UUID_PATTERN, 'i');

export const CURRENCY_RE = new RegExp(CURRENCY_PATTERN);

export type SourceRef = {
  system: string;
  kind: string;
  locator: string;
  label?: string;
};

export function isFreshnessStatus(value: unknown): value is FreshnessStatus {
  return typeof value === 'string' && (FRESHNESS_STATUSES as readonly string[]).includes(value);
}

export function isDirectiveStatus(value: unknown): value is DirectiveStatus {
  return typeof value === 'string' && (DIRECTIVE_STATUSES as readonly string[]).includes(value);
}

export function isDirectiveKind(value: unknown): value is DirectiveKind {
  return typeof value === 'string' && (DIRECTIVE_KINDS as readonly string[]).includes(value);
}

export function isScope(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 2 && value.length <= 128 && SCOPE_RE.test(value);
}

export function isResourceId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 6 &&
    value.length <= 128 &&
    RESOURCE_ID_RE.test(value) &&
    !UUID_RE.test(value)
  );
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function isConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= CONFIDENCE_MIN && value <= CONFIDENCE_MAX;
}

export function isSourceRef(value: unknown): value is SourceRef {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.system !== 'string' || !SOURCE_SYSTEM_RE.test(record.system) || record.system.length > 64) {
    return false;
  }
  if (typeof record.kind !== 'string' || !SOURCE_KIND_RE.test(record.kind) || record.kind.length > 64) {
    return false;
  }
  if (typeof record.locator !== 'string' || record.locator.length < 1 || record.locator.length > 512) {
    return false;
  }
  if (record.label !== undefined) {
    if (typeof record.label !== 'string' || record.label.length < 1 || record.label.length > 128) {
      return false;
    }
  }
  return true;
}

export function looksLikeExpiredFreshness(value: unknown): boolean {
  return typeof value === 'string' && value.toLowerCase() === 'expired';
}

export function looksLikeWithdrawnStatus(value: unknown): boolean {
  return typeof value === 'string' && value.toLowerCase() === 'withdrawn';
}
