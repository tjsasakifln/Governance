import { parseUtcIso, toUtcIso, type Clock } from "./clock.ts";
import { invalid } from "./errors.ts";
import { assertResourceId } from "./ids.ts";
import { rejectUnknownKeys, sanitizeLine, sanitizeMultiline } from "./sanitize.ts";
import { parseScope } from "./scope.ts";
import {
  SOURCE_KIND_PATTERN,
  SOURCE_SYSTEM_PATTERN,
} from "./taxonomy.ts";
import {
  CREATE_STATUSES,
  DIRECTIVE_KINDS,
  FRESHNESS_STATUSES,
  LIMITS,
  PROPOSAL_ACTIONS,
  type CreateDirectiveInput,
  type CreateStatus,
  type DirectiveKind,
  type FreshnessStatus,
  type Provenance,
  type ResourceId,
  type SourceRef,
  type SubmitProposalInput,
  type VersionDirectiveInput,
} from "./types.ts";

const CREATE_KEYS = [
  "kind",
  "title",
  "body",
  "scope",
  "status",
  "effective_from",
  "expires_at",
  "supersedes",
  "source",
  "observed_at",
  "freshness_status",
  "confidence",
] as const;

const VERSION_KEYS = [
  "title",
  "body",
  "effective_from",
  "expires_at",
  "source",
  "observed_at",
  "freshness_status",
  "confidence",
] as const;

const PROPOSAL_KEYS = [
  "action",
  "kind",
  "title",
  "body",
  "scope",
  "target_directive_id",
  "rationale",
  "source",
  "observed_at",
  "freshness_status",
  "confidence",
] as const;

const SOURCE_KEYS = ["system", "kind", "locator", "label"] as const;
const SOURCE_SYSTEM_RE = new RegExp(SOURCE_SYSTEM_PATTERN);
const SOURCE_KIND_RE = new RegExp(SOURCE_KIND_PATTERN);

const FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000;

export function parseKind(value: unknown): DirectiveKind {
  if (typeof value !== "string" || !(DIRECTIVE_KINDS as readonly string[]).includes(value)) {
    throw invalid(`kind must be one of: ${DIRECTIVE_KINDS.join(", ")}`);
  }
  return value as DirectiveKind;
}

export function parseFreshness(value: unknown): FreshnessStatus {
  if (typeof value !== "string" || !(FRESHNESS_STATUSES as readonly string[]).includes(value)) {
    throw invalid(`freshness_status must be one of: ${FRESHNESS_STATUSES.join(", ")}`);
  }
  return value as FreshnessStatus;
}

function parseConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw invalid("confidence must be a finite number in [0, 1]");
  }
  return value;
}

function parseOptionalUtc(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw invalid(`${field} must be an ISO-8601 UTC timestamp`);
  }
  parseUtcIso(value, field);
  return toUtcIso(new Date(value));
}

/**
 * Age-based classification for omitted freshness. Never returns UNKNOWN or
 * ERROR: those statuses are explicit. Future observed_at is invalid, not
 * coerced to UNKNOWN. ERROR is never produced or rewritten here.
 */
function computeFreshness(observedAt: string, now: Date): FreshnessStatus {
  const observed = parseUtcIso(observedAt, "observed_at");
  const ageMs = now.getTime() - observed.getTime();
  if (ageMs < 0) {
    throw invalid("observed_at must not be in the future");
  }
  return ageMs <= FRESHNESS_WINDOW_MS ? "FRESH" : "STALE";
}

export function parseSourceRef(raw: unknown, field = "source"): SourceRef {
  if (typeof raw === "string") {
    throw invalid(`${field} must be a SourceRef object; a bare string is not accepted`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw invalid(`${field} must be a SourceRef object`);
  }
  const obj = raw as Record<string, unknown>;
  rejectUnknownKeys(obj, SOURCE_KEYS, field);
  const system = sanitizeLine(obj.system, `${field}.system`, LIMITS.sourceSystemChars);
  if (!SOURCE_SYSTEM_RE.test(system)) {
    throw invalid(`${field}.system must be a lowercase kebab source system`);
  }
  const kind = sanitizeLine(obj.kind, `${field}.kind`, LIMITS.sourceKindChars);
  if (!SOURCE_KIND_RE.test(kind)) {
    throw invalid(`${field}.kind must be a lowercase source kind`);
  }
  const locator = sanitizeLine(obj.locator, `${field}.locator`, LIMITS.sourceLocatorChars);
  const ref: SourceRef = { system, kind, locator };
  if (obj.label !== undefined) {
    ref.label = sanitizeLine(obj.label, `${field}.label`, LIMITS.sourceLabelChars);
  }
  return ref;
}

export function parseSupersedes(raw: unknown): ResourceId[] | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  if (typeof raw === "string") {
    throw invalid("supersedes must be an array of canonical resource ids; a scalar string is not accepted");
  }
  if (!Array.isArray(raw)) {
    throw invalid("supersedes must be an array of canonical resource ids or null");
  }
  if (raw.length > LIMITS.supersedesMax) {
    throw invalid(`supersedes exceeds ${LIMITS.supersedesMax} ids`);
  }
  const ids = raw.map((item, i) => assertResourceId(item, `supersedes[${i}]`));
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    throw invalid("supersedes ids must be unique");
  }
  return ids.length === 0 ? null : ids;
}

export function parseProvenance(raw: Record<string, unknown>, clock: Clock, confidenceRequired: boolean): Provenance {
  const source = parseSourceRef(raw.source);
  const observed_at = parseOptionalUtc(raw.observed_at, "observed_at") ?? toUtcIso(clock.now());
  const freshness_status =
    raw.freshness_status === undefined
      ? computeFreshness(observed_at, clock.now())
      : parseFreshness(raw.freshness_status);
  if (confidenceRequired && raw.confidence === undefined) {
    throw invalid("confidence is required on aggregated provenance");
  }
  const confidence = raw.confidence === undefined ? 1 : parseConfidence(raw.confidence);
  return { source, observed_at, freshness_status, confidence };
}

export function parseCreateInput(raw: unknown, clock: Clock): CreateDirectiveInput {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw invalid("body must be an object");
  }
  const obj = raw as Record<string, unknown>;
  rejectUnknownKeys(obj, CREATE_KEYS, "directive");
  if (obj.created_by !== undefined) {
    throw invalid("created_by is server-assigned from the actor");
  }
  const kind = parseKind(obj.kind);
  const title = sanitizeLine(obj.title, "title", LIMITS.titleChars);
  const body = sanitizeMultiline(obj.body, "body", LIMITS.bodyChars);
  const scope = parseScope(obj.scope);
  let status: CreateStatus = "active";
  if (obj.status !== undefined) {
    if (typeof obj.status !== "string" || !(CREATE_STATUSES as readonly string[]).includes(obj.status)) {
      throw invalid("status on create must be draft or active");
    }
    status = obj.status as CreateStatus;
  }
  const effective_from = parseOptionalUtc(obj.effective_from, "effective_from") ?? toUtcIso(clock.now());
  let expires_at: string | null = null;
  if (obj.expires_at !== undefined && obj.expires_at !== null) {
    expires_at = parseOptionalUtc(obj.expires_at, "expires_at") ?? null;
  }
  if (expires_at !== null && parseUtcIso(expires_at, "expires_at").getTime() <= parseUtcIso(effective_from, "effective_from").getTime()) {
    throw invalid("expires_at must be after effective_from");
  }
  const supersedes = parseSupersedes(obj.supersedes);
  const provenance = parseProvenance(obj, clock, true);
  return {
    kind,
    title,
    body,
    scope,
    status,
    effective_from,
    expires_at,
    supersedes,
    source: provenance.source,
    observed_at: provenance.observed_at,
    freshness_status: provenance.freshness_status,
    confidence: provenance.confidence,
  };
}

export function parseVersionInput(raw: unknown, clock: Clock): VersionDirectiveInput {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw invalid("body must be an object");
  }
  const obj = raw as Record<string, unknown>;
  rejectUnknownKeys(obj, VERSION_KEYS, "version");
  if (obj.kind !== undefined) {
    throw invalid("kind is immutable across versions; supersede to change kind");
  }
  if (obj.created_by !== undefined) {
    throw invalid("created_by is server-assigned from the actor");
  }
  const input: VersionDirectiveInput = {};
  if (obj.title !== undefined) {
    input.title = sanitizeLine(obj.title, "title", LIMITS.titleChars);
  }
  if (obj.body !== undefined) {
    input.body = sanitizeMultiline(obj.body, "body", LIMITS.bodyChars);
  }
  const effective = parseOptionalUtc(obj.effective_from, "effective_from");
  if (effective !== undefined) {
    input.effective_from = effective;
  }
  if (obj.expires_at !== undefined) {
    input.expires_at = obj.expires_at === null ? null : parseOptionalUtc(obj.expires_at, "expires_at") ?? null;
  }
  if (obj.source !== undefined) {
    input.source = parseSourceRef(obj.source);
  }
  if (obj.observed_at !== undefined) {
    const observed = parseOptionalUtc(obj.observed_at, "observed_at");
    if (observed !== undefined) {
      input.observed_at = observed;
    }
  }
  if (obj.freshness_status !== undefined) {
    input.freshness_status = parseFreshness(obj.freshness_status);
  }
  if (obj.confidence !== undefined) {
    input.confidence = obj.confidence === null ? null : parseConfidence(obj.confidence);
  }
  if (obj.observed_at !== undefined && obj.freshness_status === undefined && input.observed_at) {
    input.freshness_status = computeFreshness(input.observed_at, clock.now());
  }
  if (Object.keys(input).length === 0) {
    throw invalid("version requires at least one field");
  }
  return input;
}

export function parseProposalInput(raw: unknown, clock: Clock): SubmitProposalInput {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw invalid("body must be an object");
  }
  const obj = raw as Record<string, unknown>;
  rejectUnknownKeys(obj, PROPOSAL_KEYS, "proposal");
  if (typeof obj.action !== "string" || !(PROPOSAL_ACTIONS as readonly string[]).includes(obj.action)) {
    throw invalid(`action must be one of: ${PROPOSAL_ACTIONS.join(", ")}`);
  }
  const provenance = parseProvenance(obj, clock, true);
  let target: ResourceId | null = null;
  if (obj.target_directive_id !== undefined && obj.target_directive_id !== null) {
    target = assertResourceId(obj.target_directive_id, "target_directive_id");
  }
  if (obj.action !== "create" && target === null) {
    throw invalid("target_directive_id is required unless action is create");
  }
  return {
    action: obj.action as SubmitProposalInput["action"],
    kind: parseKind(obj.kind),
    title: sanitizeLine(obj.title, "title", LIMITS.titleChars),
    body: sanitizeMultiline(obj.body, "body", LIMITS.bodyChars),
    scope: parseScope(obj.scope),
    target_directive_id: target,
    rationale: sanitizeMultiline(obj.rationale, "rationale", LIMITS.rationaleChars),
    source: provenance.source,
    observed_at: provenance.observed_at,
    freshness_status: provenance.freshness_status,
    confidence: provenance.confidence,
  };
}

export function parsePathId(value: string, field: string): ResourceId {
  return assertResourceId(value, field);
}
