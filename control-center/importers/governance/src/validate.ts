import {
  CANDIDATE_SCHEMA,
  COMMIT_SHA_PATTERN,
  CONTENT_HASH_PATTERN,
  DIRECTIVE_KINDS,
  DIRECTIVE_STATUSES,
  FRESHNESS_STATUSES,
  IDEMPOTENCY_KEY_PATTERN,
  IMPORT_RESULT_SCHEMA,
  RESOURCE_ID_PATTERN,
  SOURCE_SYSTEM,
  UTC_DATETIME_PATTERN,
  type ImportResult,
  type MemoryCandidate,
  type UnclassifiableItem,
} from "./types.js";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function assertValidCandidate(candidate: MemoryCandidate): void {
  if (candidate.schema_version !== CANDIDATE_SCHEMA) {
    throw new ValidationError(`invalid schema_version: ${candidate.schema_version}`);
  }
  if (!RESOURCE_ID_PATTERN.test(candidate.id)) {
    throw new ValidationError(`invalid id: ${candidate.id}`);
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(candidate.idempotency_key)) {
    throw new ValidationError(`invalid idempotency_key: ${candidate.idempotency_key}`);
  }
  if (!DIRECTIVE_KINDS.includes(candidate.kind)) {
    throw new ValidationError(`invalid kind: ${String(candidate.kind)}`);
  }
  if (!DIRECTIVE_STATUSES.includes(candidate.status)) {
    throw new ValidationError(`invalid status: ${String(candidate.status)}`);
  }
  if (!UTC_DATETIME_PATTERN.test(candidate.observed_at)) {
    throw new ValidationError("observed_at must be UTC RFC3339 with Z");
  }
  if (!UTC_DATETIME_PATTERN.test(candidate.effective_from)) {
    throw new ValidationError("effective_from must be UTC RFC3339 with Z");
  }
  if (candidate.expires_at !== null && !UTC_DATETIME_PATTERN.test(candidate.expires_at)) {
    throw new ValidationError("expires_at must be UTC RFC3339 with Z or null");
  }
  if (!FRESHNESS_STATUSES.includes(candidate.freshness_status)) {
    throw new ValidationError(`invalid freshness_status: ${candidate.freshness_status}`);
  }
  if (typeof candidate.confidence !== "number" || candidate.confidence < 0 || candidate.confidence > 1) {
    throw new ValidationError("confidence must be in [0, 1]");
  }
  if (!CONTENT_HASH_PATTERN.test(candidate.content_hash)) {
    throw new ValidationError(`invalid content_hash: ${candidate.content_hash}`);
  }
  if (candidate.source_path.length === 0 || candidate.source_path.includes("..")) {
    throw new ValidationError("invalid source_path");
  }
  if (!COMMIT_SHA_PATTERN.test(candidate.commit_sha) || /^0+$/.test(candidate.commit_sha)) {
    throw new ValidationError("commit_sha missing or fabricated");
  }
  if (candidate.source.system !== SOURCE_SYSTEM) {
    throw new ValidationError(`source.system must be ${SOURCE_SYSTEM}`);
  }
  if (candidate.source.locator !== candidate.source_path) {
    throw new ValidationError("source.locator must equal source_path");
  }
  if (candidate.created_by.id.length === 0) {
    throw new ValidationError("created_by.id required");
  }
  if (candidate.audit.length < 1) {
    throw new ValidationError("audit trail required");
  }
  if (candidate.title.length === 0 || candidate.body.length === 0) {
    throw new ValidationError("title and body required");
  }
  if (candidate.scope.length === 0) {
    throw new ValidationError("scope required");
  }
}

export function assertValidUnclassifiable(item: UnclassifiableItem): void {
  if (item.source_path.length === 0) {
    throw new ValidationError("unclassifiable source_path required");
  }
  if (!CONTENT_HASH_PATTERN.test(item.content_hash)) {
    throw new ValidationError("unclassifiable content_hash required");
  }
  if (item.commit_sha !== null && !COMMIT_SHA_PATTERN.test(item.commit_sha)) {
    throw new ValidationError("unclassifiable commit_sha invalid");
  }
  if (!UTC_DATETIME_PATTERN.test(item.observed_at)) {
    throw new ValidationError("unclassifiable observed_at must be UTC");
  }
  if (item.reason.length === 0) {
    throw new ValidationError("unclassifiable reason required");
  }
}

export function assertValidResult(result: ImportResult): void {
  if (result.schema_version !== IMPORT_RESULT_SCHEMA) {
    throw new ValidationError("invalid import result schema");
  }
  if (!UTC_DATETIME_PATTERN.test(result.observed_at)) {
    throw new ValidationError("result observed_at must be UTC");
  }
  for (const candidate of result.candidates) {
    assertValidCandidate(candidate);
  }
  for (const item of result.unclassifiable) {
    assertValidUnclassifiable(item);
  }
  const ids = result.candidates.map((candidate) => candidate.id);
  if (new Set(ids).size !== ids.length) {
    throw new ValidationError("duplicate candidate ids");
  }
  const keys = result.candidates.map((candidate) => candidate.idempotency_key);
  if (new Set(keys).size !== keys.length) {
    throw new ValidationError("duplicate idempotency keys");
  }
}
