/** HTTP 2xx is never QUEUED. Timeout keeps the same idempotency key. */
export const SCHEDULING_CHAIN = [
  "DRAFTED",
  "QA",
  "HUMAN_APPROVE",
  "DELEGATED_POLICY_APPROVE",
  "APPROVAL_PENDING_READBACK",
  "APPROVED_NOT_SCHEDULED",
  "QUEUED",
] as const;

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

function approvalSource(raw: string | null | undefined): ApprovalSource {
  if (raw === "DELEGATED_POLICY_APPROVE" || raw === "HUMAN_APPROVE") return raw;
  return "UNKNOWN";
}

export function classifySchedulingReadback(input: SchedulingReadbackInput): SchedulingReadbackResult {
  const source = approvalSource(input.approval_source);
  const key = input.idempotency_key;
  const pending = (state: SchedulingReadbackState, group: "READBACK_UNKNOWN" | null = "READBACK_UNKNOWN"): SchedulingReadbackResult => ({
    state,
    queued: false,
    idempotency_key: key,
    approval_source: source,
    reason_group: group,
  });
  if (input.timeout === true || !input.readback) {
    return pending("APPROVAL_PENDING_READBACK");
  }
  const status = input.readback.status;
  if (status !== "confirmed") {
    return pending(status === "unavailable" || status === "stale" || status === "invalid" ? "APPROVAL_PENDING_READBACK" : "READBACK_UNKNOWN");
  }
  const state = input.readback.state;
  if (state === "QUEUED" && input.readback.due_at) {
    return {
      state: "QUEUED",
      queued: true,
      idempotency_key: key,
      approval_source: source,
      reason_group: null,
    };
  }
  if (state === "APPROVED_NOT_SCHEDULED") {
    return pending("APPROVED_NOT_SCHEDULED", null);
  }
  if (state === "HOLD" || state === "EXCEPTION") {
    return { state, queued: false, idempotency_key: key, approval_source: source, reason_group: null };
  }
  if (input.http_ok === true) {
    return pending("APPROVAL_PENDING_READBACK");
  }
  return pending("READBACK_UNKNOWN");
}

export function replayKeepsIdempotencyKey(
  first: SchedulingReadbackResult,
  second: SchedulingReadbackResult,
): boolean {
  return first.idempotency_key === second.idempotency_key && first.queued === false && second.queued === false;
}
