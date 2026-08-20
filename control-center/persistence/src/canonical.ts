/**
 * Local canonical primitives for Control Center persistence v1.
 * Encoded here so this package does not depend on sibling workstreams.
 */

export const FRESHNESS_STATUSES = ['FRESH', 'STALE', 'UNKNOWN', 'ERROR'] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

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
  'revoked',
  'expired',
] as const;
export type DirectiveStatus = (typeof DIRECTIVE_STATUSES)[number];

export const SCOPE_LITERALS = [
  'company',
  'commercial',
  'finance',
  'clients',
  'infrastructure',
  'inbound',
] as const;
export type ScopeLiteral = (typeof SCOPE_LITERALS)[number];

export const RESOURCE_ID_PATTERN = '^cc:[a-z][a-z0-9-]*:[A-Za-z0-9._~-]+$';
export const RESOURCE_ID_RE = new RegExp(RESOURCE_ID_PATTERN);

export const SCOPE_CORE =
  '(?:company|commercial|finance|clients|infrastructure|inbound|repo:[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)?|client:[a-z0-9]+(?:-[a-z0-9]+)*|(?!company:|commercial:|finance:|clients:|infrastructure:|inbound:|repo:|client:)[a-z][a-z0-9-]*:[A-Za-z0-9._:~-]+)';
export const SCOPE_PATTERN = `^${SCOPE_CORE}$`;
export const SCOPE_RE = new RegExp(SCOPE_PATTERN);

export const SOURCE_SYSTEM_PATTERN = '^[a-z][a-z0-9-]*$';
export const SOURCE_SYSTEM_RE = new RegExp(SOURCE_SYSTEM_PATTERN);
export const SOURCE_KIND_PATTERN = '^[a-z][a-z0-9._-]*$';
export const SOURCE_KIND_RE = new RegExp(SOURCE_KIND_PATTERN);

export const UUID_PATTERN =
  '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
export const UUID_RE = new RegExp(UUID_PATTERN, 'i');

export const CURRENCY_PATTERN = '^[A-Z]{3}$';
export const CURRENCY_RE = new RegExp(CURRENCY_PATTERN);

export const CONFIDENCE_MIN = 0;
export const CONFIDENCE_MAX = 1;

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
