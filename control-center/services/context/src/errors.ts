export type ErrorCode =
  | "missing_actor"
  | "unknown_actor"
  | "unknown_actor_role"
  | "invalid_actor_id"
  | "agent_mutation_forbidden"
  | "silent_replace_forbidden"
  | "payload_too_large"
  | "invalid_input"
  | "directive_not_found"
  | "proposal_not_found"
  | "kind_immutable"
  | "conflict"
  | "store_misconfigured"
  | "operator_action_forbidden"
  | "warmbly_review_failed";

export class ServiceError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;

  constructor(code: ErrorCode, message: string, httpStatus: number) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function authError(code: ErrorCode, message: string): ServiceError {
  return new ServiceError(code, message, 401);
}

export function forbidden(code: ErrorCode, message: string): ServiceError {
  return new ServiceError(code, message, 403);
}

export function invalid(message: string): ServiceError {
  return new ServiceError("invalid_input", message, 400);
}

export function notFound(code: ErrorCode, message: string): ServiceError {
  return new ServiceError(code, message, 404);
}

export function conflict(message: string): ServiceError {
  return new ServiceError("conflict", message, 409);
}

export function payloadTooLarge(message: string): ServiceError {
  return new ServiceError("payload_too_large", message, 413);
}

export function isServiceError(err: unknown): err is ServiceError {
  return err instanceof ServiceError;
}
