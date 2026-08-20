import { parseUtcIso, toUtcIso, type Clock } from "./clock.ts";
import { invalid } from "./errors.ts";
import { rejectUnknownKeys, sanitizeLine, sanitizeMultiline } from "./sanitize.ts";
import { parseScope } from "./scope.ts";
import {
  DIRECTIVE_KINDS,
  FRESHNESS_STATUSES,
  LIMITS,
  PROPOSAL_ACTIONS,
  type CreateDirectiveInput,
  type DirectiveKind,
  type FreshnessStatus,
  type Provenance,
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

export function parseKind(value: unknown): DirectiveKind {
  if (typeof value !== "string" || !(DIRECTIVE_KINDS as readonly string[]).includes(value)) {
    throw invalid(`kind must be one of: ${DIRECTIVE_KINDS.join(", ")}`);
  }
  return value as DirectiveKind;
}

function parseFreshness(value: unknown): FreshnessStatus {
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

function computeFreshness(observedAt: string, now: Date): FreshnessStatus {
  const observed = parseUtcIso(observedAt, "observed_at");
  const ageMs = now.getTime() - observed.getTime();
  if (ageMs < 0) {
    return "unknown";
  }
  const day = 24 * 60 * 60 * 1000;
  return ageMs <= day ? "fresh" : "stale";
}

export function parseProvenance(
  raw: Record<string, unknown>,
  clock: Clock,
): Provenance {
  const source = sanitizeLine(raw.source, "source", LIMITS.sourceChars);
  const observed_at = parseOptionalUtc(raw.observed_at, "observed_at") ?? toUtcIso(clock.now());
  const freshness_status =
    raw.freshness_status === undefined
      ? computeFreshness(observed_at, clock.now())
      : parseFreshness(raw.freshness_status);
  const provenance: Provenance = { source, observed_at, freshness_status };
  if (raw.confidence !== undefined) {
    provenance.confidence = parseConfidence(raw.confidence);
  }
  return provenance;
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
  let status: "active" | "inactive" = "active";
  if (obj.status !== undefined) {
    if (obj.status !== "active" && obj.status !== "inactive") {
      throw invalid("status on create must be active or inactive");
    }
    status = obj.status;
  }
  const effective_from = parseOptionalUtc(obj.effective_from, "effective_from") ?? toUtcIso(clock.now());
  let expires_at: string | null = null;
  if (obj.expires_at !== undefined && obj.expires_at !== null) {
    expires_at = parseOptionalUtc(obj.expires_at, "expires_at") ?? null;
  }
  if (expires_at !== null && parseUtcIso(expires_at, "expires_at").getTime() <= parseUtcIso(effective_from, "effective_from").getTime()) {
    throw invalid("expires_at must be after effective_from");
  }
  let supersedes: string | null = null;
  if (obj.supersedes !== undefined && obj.supersedes !== null) {
    supersedes = sanitizeLine(obj.supersedes, "supersedes", 128);
  }
  const provenance = parseProvenance(obj, clock);
  const input: CreateDirectiveInput = {
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
  };
  if (provenance.confidence !== undefined) {
    input.confidence = provenance.confidence;
  }
  return input;
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
  if (obj.source !== undefined || obj.observed_at !== undefined || obj.freshness_status !== undefined || obj.confidence !== undefined) {
    const provenance = parseProvenance(
      {
        source: obj.source ?? "founder",
        observed_at: obj.observed_at,
        freshness_status: obj.freshness_status,
        confidence: obj.confidence,
      },
      clock,
    );
    if (obj.source !== undefined) {
      input.source = provenance.source;
    }
    if (obj.observed_at !== undefined) {
      input.observed_at = provenance.observed_at;
    }
    if (obj.freshness_status !== undefined) {
      input.freshness_status = provenance.freshness_status;
    }
    if (obj.confidence !== undefined && provenance.confidence !== undefined) {
      input.confidence = provenance.confidence;
    }
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
  const provenance = parseProvenance(obj, clock);
  let target: string | null = null;
  if (obj.target_directive_id !== undefined && obj.target_directive_id !== null) {
    target = sanitizeLine(obj.target_directive_id, "target_directive_id", 128);
  }
  if (obj.action !== "create" && target === null) {
    throw invalid("target_directive_id is required unless action is create");
  }
  const input: SubmitProposalInput = {
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
  };
  if (provenance.confidence !== undefined) {
    input.confidence = provenance.confidence;
  }
  return input;
}

export function parsePathId(value: string, field: string): string {
  return sanitizeLine(value, field, 128);
}
