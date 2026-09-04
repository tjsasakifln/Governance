export type SchedulingReadbackState =
  | "APPROVAL_PENDING_READBACK"
  | "APPROVED_NOT_SCHEDULED"
  | "QUEUED"
  | "READBACK_UNKNOWN"
  | "HOLD"
  | "EXCEPTION";

export type ApprovalSource = "DELEGATED_POLICY_APPROVE" | "HUMAN_APPROVE" | "UNKNOWN";

export const ACTIVE_FIRST_TOUCH_POLICY = "CFG-FIRST-TOUCH-ROUTING-v3";
export const SUPERSEDED_FIRST_TOUCH_POLICIES = ["CFG-FIRST-TOUCH-ROUTING-v1", "CFG-FIRST-TOUCH-ROUTING-v2", "v1", "v2"] as const;

export interface SchedulingReadbackInput {
  http_ok?: boolean;
  timeout?: boolean;
  idempotency_key: string;
  approval_source?: string | null;
  policy_id?: string | null;
  policy_version?: string | null;
  policy_canonical?: string | null;
  policy_hash?: string | null;
  executor?: string | null;
  authority?: string | null;
  recipient_hash?: string | null;
  content_hash?: string | null;
  evidence_hash?: string | null;
  source_hash?: string | null;
  window?: string | null;
  blockers?: string[] | null;
  runtime_sha?: string | null;
  readback_at?: string | null;
  freshness?: string | null;
  readback?: {
    status?: string | null;
    state?: string | null;
    due_at?: string | null;
    queued_readback?: number | null;
    window?: string | null;
    policy_canonical?: string | null;
    policy_hash?: string | null;
    executor?: string | null;
    authority?: string | null;
    recipient_hash?: string | null;
    content_hash?: string | null;
    evidence_hash?: string | null;
    source_hash?: string | null;
    runtime_sha?: string | null;
    readback_at?: string | null;
    freshness?: string | null;
    blockers?: string[] | null;
  } | null;
}

export interface SchedulingReadbackResult {
  state: SchedulingReadbackState;
  queued: boolean;
  idempotency_key: string;
  approval_source: ApprovalSource;
  reason_group: "READBACK_UNKNOWN" | "POLICY_FAIL_CLOSED" | null;
  provider_mutation: 0;
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function firstTouchPolicyOf(input: SchedulingReadbackInput): string | null {
  const rb = input.readback;
  const claimed =
    input.policy_canonical ||
    rb?.policy_canonical ||
    input.policy_version ||
    rb?.authority ||
    input.policy_id ||
    null;
  if (!nonempty(claimed)) return null;
  return claimed.trim();
}

function isActiveFirstTouch(claimed: string | null): boolean {
  return claimed === ACTIVE_FIRST_TOUCH_POLICY || claimed === "v3";
}

function policyFailsClosed(claimed: string | null): boolean {
  if (!claimed) return false;
  return !isActiveFirstTouch(claimed);
}

function receiptComplete(input: SchedulingReadbackInput): boolean {
  const rb = input.readback;
  const executor = input.executor || rb?.executor;
  const authority = input.authority || rb?.authority || input.approval_source;
  const policyHash = input.policy_hash || rb?.policy_hash;
  const recipient = input.recipient_hash || rb?.recipient_hash;
  const content = input.content_hash || rb?.content_hash;
  const evidence = input.evidence_hash || rb?.evidence_hash;
  const source = input.source_hash || rb?.source_hash;
  const window = input.window || rb?.window;
  const runtime = input.runtime_sha || rb?.runtime_sha;
  const readbackAt = input.readback_at || rb?.readback_at;
  const freshness = input.freshness || rb?.freshness;
  const blockers = input.blockers !== undefined ? input.blockers : rb?.blockers;
  return (
    Array.isArray(blockers) &&
    [
      executor,
      authority,
      policyHash,
      recipient,
      content,
      evidence,
      source,
      window,
      runtime,
      readbackAt,
      freshness,
      input.idempotency_key,
      rb?.due_at,
    ].every(nonempty) &&
    freshness !== "stale" &&
    freshness !== "STALE"
  );
}

export function classifySchedulingReadback(input: SchedulingReadbackInput): SchedulingReadbackResult {
  const src = input.approval_source === "DELEGATED_POLICY_APPROVE" || input.approval_source === "HUMAN_APPROVE"
    ? input.approval_source
    : "UNKNOWN";
  const key = input.idempotency_key;
  const out = (
    state: SchedulingReadbackState,
    queued = false,
    group: "READBACK_UNKNOWN" | "POLICY_FAIL_CLOSED" | null = "READBACK_UNKNOWN",
  ): SchedulingReadbackResult => ({
    state,
    queued,
    idempotency_key: key,
    approval_source: src,
    reason_group: group,
    provider_mutation: 0,
  });
  const claimed = firstTouchPolicyOf(input);
  if (policyFailsClosed(claimed)) {
    return out("READBACK_UNKNOWN", false, "POLICY_FAIL_CLOSED");
  }
  const rb = input.readback;
  if (input.timeout === true || !rb) return out("APPROVAL_PENDING_READBACK");
  if (rb.status !== "confirmed") {
    return out(rb.status === "unavailable" || rb.status === "stale" || rb.status === "invalid"
      ? "APPROVAL_PENDING_READBACK"
      : "READBACK_UNKNOWN");
  }
  if (rb.state === "QUEUED" && rb.due_at) {
    if (!isActiveFirstTouch(claimed) || !receiptComplete(input)) {
      return out("APPROVAL_PENDING_READBACK", false, claimed ? "READBACK_UNKNOWN" : "POLICY_FAIL_CLOSED");
    }
    return out("QUEUED", true, null);
  }
  if (rb.state === "APPROVED_NOT_SCHEDULED") return out("APPROVED_NOT_SCHEDULED", false, null);
  if (rb.state === "HOLD" || rb.state === "EXCEPTION") return out(rb.state, false, null);
  return out(input.http_ok === true ? "APPROVAL_PENDING_READBACK" : "READBACK_UNKNOWN");
}

export function replayKeepsIdempotencyKey(
  first: SchedulingReadbackResult,
  second: SchedulingReadbackResult,
): boolean {
  return first.idempotency_key === second.idempotency_key && first.queued === false && second.queued === false;
}
