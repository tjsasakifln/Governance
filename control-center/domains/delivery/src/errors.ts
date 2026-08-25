export type WorkOrderErrorCode =
  | "INVALID_COMMAND"
  | "INVALID_EVENT"
  | "ILLEGAL_TRANSITION"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "MISSING_AUTHORITY"
  | "MISSING_EVIDENCE";

export class WorkOrderError extends Error {
  constructor(
    readonly code: WorkOrderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkOrderError";
  }
}

export function invariant(
  condition: unknown,
  code: WorkOrderErrorCode,
  message: string,
): asserts condition {
  if (!condition) {
    throw new WorkOrderError(code, message);
  }
}
