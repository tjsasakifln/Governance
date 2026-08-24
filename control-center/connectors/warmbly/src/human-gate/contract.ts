/**
 * The slice of `confenge.human-gate.v1` this connector actually depends on.
 *
 * This is deliberately NOT a copy of the Warmbly-owned schema document — that
 * one lives at `contracts/human-gate-v1.schema.json` and is compared byte for
 * byte against the authority in `tests/human-gate-contract.test.ts`. What lives
 * here is narrower and different in kind: the exact request fields this
 * connector will put on the wire, the exact response fields it reads back, and
 * the exact upstream routes it will build. If Warmbly renames a field or moves a
 * route, the pin in `tests/human-gate-adjust-contract.test.ts` fails here rather
 * than silently forwarding a body the backend ignores.
 */

/** Canonical contract this connector speaks. Owned by Warmbly, referenced by name. */
export const HUMAN_GATE_CONTRACT = "confenge.human-gate.v1";

/**
 * Single source for the upstream cohort route prefix. Every human-gate route is
 * composed from this constant, so the six operations can never drift apart from
 * one another, and a prefix change is one edit plus one failing contract pin.
 */
export const WARMBLY_COHORTS_PREFIX = "/v1/confenge/cohorts";

/**
 * Every operation the human gate can name. There is deliberately no generic
 * proxy entry and no `send`, `queue`, `resume` or `payment` member: the type
 * itself is part of the security boundary.
 *
 * `dispatch` is the one deliberate widening, and it is narrow on purpose. It
 * names exactly one upstream route — `POST {prefix}/{cohortId}/dispatch` — which
 * is the call that hands an already-GO'd cohort to Warmbly's own queue. It does
 * not send: Warmbly enqueues each member and its worker delivers inside the
 * send window under the rolling-hour governor. Every gate that matters stays
 * upstream and none of them is expressible from here: Warmbly re-checks the
 * durable human-gate GO, the grant's revocation and expiry, `auto_send` and
 * `green_autorun` being off, the pause state and the file kill switch, and caps
 * the batch at ten regardless of what this connector asks for.
 */
export const HUMAN_GATE_OPERATIONS = [
  "list_cohorts",
  "read_cohort",
  "read_candidate",
  "create",
  "reproduce",
  "validation",
  "review",
  "adjust",
  "decision",
  "dispatch",
] as const;
export type HumanGateOperation = (typeof HUMAN_GATE_OPERATIONS)[number];

/** Operations that mutate. Only these carry an idempotency key. */
export const HUMAN_GATE_WRITE_OPERATIONS = [
  "create",
  "reproduce",
  "validation",
  "review",
  "adjust",
  "decision",
  "dispatch",
] as const;

/**
 * Route classes this connector must never be able to construct, at any prefix.
 * Kept as data so `tests/human-gate-negative-allowlist.test.ts` can enumerate
 * them instead of a reviewer having to remember the list.
 *
 * `dispatch` left this list when the cockpit gained the control that hands a
 * GO'd cohort to Warmbly's queue. Nothing else did, and the removal buys exactly
 * one fixed route: the negative tests still prove that `dispatch` is
 * unreachable at every other shape — under `/candidates/`, at the bare prefix,
 * through traversal, and on every method except POST.
 */
export const FORBIDDEN_HUMAN_GATE_SEGMENTS = [
  "send",
  "queue",
  "resume",
  "auto-send",
  "autosend",
  "payment",
  "payments",
  "charge",
  "enroll",
  "deliver",
] as const;

/** How a call ended. `UNKNOWN` is never collapsed into `REFUSED`. */
export const HUMAN_GATE_OUTCOMES = ["APPLIED", "REFUSED", "UNKNOWN"] as const;
export type HumanGateOutcome = (typeof HUMAN_GATE_OUTCOMES)[number];

// ---------------------------------------------------------------------------
// adjust — POST {prefix}/{id}/candidates/{candidateId}/adjust
// ---------------------------------------------------------------------------

/**
 * Exactly the fields the adjust request may carry. Anything else is refused by
 * `validateAdjustRequest` before a URL is built, not dropped silently: a caller
 * that believes it set `mailbox` must be told the field does not exist, because
 * silently ignoring it is how a recipient override gets shipped believing it
 * works.
 */
export const ADJUST_REQUEST_FIELDS = [
  "subject",
  "body_text",
  "reason",
  "confirmation",
  "expected_frozen_hash",
] as const;
export type AdjustRequestField = (typeof ADJUST_REQUEST_FIELDS)[number];

/**
 * Edge-only fields the gate consumes and never forwards in the body. The
 * idempotency key travels as the `Idempotency-Key` header, exactly as the other
 * five writes do.
 */
export const ADJUST_EDGE_ONLY_FIELDS = ["idempotency_key"] as const;

/**
 * Named because they are the tempting ones: each would widen the blast radius of
 * an "adjust the copy" call into recipient selection, provenance forgery or
 * routing. The schema refuses them; this list exists so the refusal is tested by
 * name rather than by a reviewer's memory.
 */
export const ADJUST_REFUSED_FIELDS = [
  "mailbox",
  "recipient",
  "evidence",
  "source",
  "policy_version",
  "route_class",
  "composer_version",
] as const;

export interface CohortAdjustmentDiffEntry {
  field: string;
  before: unknown;
  after: unknown;
}

/** The `adjustment` object of a 201. Field names are Warmbly's, not ours. */
export const ADJUSTMENT_FIELDS = [
  "id",
  "cohort_id",
  "from_version",
  "to_version",
  "candidate_id",
  "before_content_hash",
  "after_content_hash",
  "before_frozen_hash",
  "after_frozen_hash",
  "diff",
  "revoked_authorization_id",
  "actor_id",
  "correlation_id",
  "receipt",
  "created_at",
] as const;

export interface CohortAdjustment {
  id: string;
  cohort_id: string;
  from_version: number | string;
  to_version: number | string;
  candidate_id: string;
  before_content_hash: string;
  after_content_hash: string;
  before_frozen_hash: string;
  after_frozen_hash: string;
  diff: CohortAdjustmentDiffEntry[];
  revoked_authorization_id: string | null;
  actor_id: string;
  correlation_id: string;
  receipt: string;
  created_at: string;
}

/** Top-level 201 body. `cohort` is the full new-version payload, passed through. */
export const ADJUST_RESPONSE_FIELDS = ["contract_version", "cohort", "adjustment"] as const;

export interface CohortAdjustResponse {
  contract_version: typeof HUMAN_GATE_CONTRACT;
  cohort: Record<string, unknown>;
  adjustment: CohortAdjustment;
}

/**
 * Server-owned refusal codes for adjust, with the status each arrives on. The
 * connector never invents one of these and never rewrites one into another; the
 * map exists so the edge can be pinned against the backend's vocabulary.
 */
export const ADJUST_ERROR_CODES = {
  frozen_hash_mismatch: 409,
  confirmation_mismatch: 409,
  version_superseded: 409,
  authority_active: 409,
  immutable_field: 422,
  copy_qa_failed: 422,
  candidate_not_found: 404,
} as const satisfies Record<string, number>;
export type AdjustErrorCode = keyof typeof ADJUST_ERROR_CODES;

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

export type AdjustRequest = Record<AdjustRequestField, string>;

export type AdjustValidation =
  | { ok: true; value: AdjustRequest }
  | { ok: false; code: string; message: string; fields: string[] };

/**
 * Canonical 8-4-4-4-12 UUID. The looser `[0-9a-fA-F-]{36}` this module replaced
 * matched 36 hyphens, which is not an id — every route now composes its upstream
 * URL only after this returns true.
 */
const CANONICAL_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_UUID.test(value);
}

/** Source of truth for the route regexes, so pattern and guard cannot diverge. */
export const UUID_PATTERN_SOURCE =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/**
 * Strict, closed-world validation of the adjust request body.
 *
 * Closed-world is the point: `additionalProperties: false` semantics are what
 * stops `{"mailbox": "..."}` from reaching a backend that might one day honour
 * it. Refusal happens before any URL is built and before any socket is opened.
 */
export function validateAdjustRequest(body: unknown): AdjustValidation {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      code: "invalid_adjust_payload",
      message: "the adjust request body must be a JSON object",
      fields: [],
    };
  }
  const record = body as Record<string, unknown>;
  const allowed = new Set<string>([...ADJUST_REQUEST_FIELDS, ...ADJUST_EDGE_ONLY_FIELDS]);
  const unexpected = Object.keys(record).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    return {
      ok: false,
      code: "unexpected_field",
      message: `the adjust request refuses unknown fields: ${unexpected.sort().join(", ")}`,
      fields: unexpected.sort(),
    };
  }
  const missing: string[] = [];
  const value = {} as AdjustRequest;
  for (const field of ADJUST_REQUEST_FIELDS) {
    const raw = record[field];
    if (typeof raw !== "string" || raw.trim() === "") {
      missing.push(field);
      continue;
    }
    value[field] = raw;
  }
  if (missing.length > 0) {
    return {
      ok: false,
      code: "invalid_adjust_payload",
      message: `every adjust field is required and must be a non-empty string: ${missing.join(", ")}`,
      fields: missing,
    };
  }
  return { ok: true, value };
}
