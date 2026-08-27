export type SchedulingReadbackState =
  | "APPROVAL_PENDING_READBACK"
  | "APPROVED_NOT_SCHEDULED"
  | "QUEUED"
  | "READBACK_UNKNOWN"
  | "HOLD"
  | "EXCEPTION";

export type ApprovalSource = "DELEGATED_POLICY_APPROVE" | "HUMAN_APPROVE" | "UNKNOWN";

export interface SchedulingReadbackInput {
  http_ok?: boolean;
  timeout?: boolean;
  idempotency_key: string;
  approval_source?: string | null;
  readback?: {
    status?: string | null;
    state?: string | null;
    due_at?: string | null;
    queued_readback?: number | null;
  } | null;
}

export interface SchedulingReadbackResult {
  state: SchedulingReadbackState;
  queued: boolean;
  idempotency_key: string;
  approval_source: ApprovalSource;
  reason_group: "READBACK_UNKNOWN" | null;
}

export function classifySchedulingReadback(input: SchedulingReadbackInput): SchedulingReadbackResult {
  const src = input.approval_source === "DELEGATED_POLICY_APPROVE" || input.approval_source === "HUMAN_APPROVE"
    ? input.approval_source
    : "UNKNOWN";
  const key = input.idempotency_key;
  const out = (
    state: SchedulingReadbackState,
    queued = false,
    group: "READBACK_UNKNOWN" | null = "READBACK_UNKNOWN",
  ): SchedulingReadbackResult => ({
    state,
    queued,
    idempotency_key: key,
    approval_source: src,
    reason_group: group,
  });
  const rb = input.readback;
  if (input.timeout === true || !rb) return out("APPROVAL_PENDING_READBACK");
  if (rb.status !== "confirmed") {
    return out(rb.status === "unavailable" || rb.status === "stale" || rb.status === "invalid"
      ? "APPROVAL_PENDING_READBACK"
      : "READBACK_UNKNOWN");
  }
  if (rb.state === "QUEUED" && rb.due_at) return out("QUEUED", true, null);
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
