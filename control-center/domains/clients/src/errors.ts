export const CLIENT_OPS_ERROR_CODES = [
  "missing_provenance",
  "sensitive_field",
  "invalid_input",
  "invalid_scope",
] as const;

export type ClientOpsErrorCode = (typeof CLIENT_OPS_ERROR_CODES)[number];

export class ClientOpsError extends Error {
  readonly code: ClientOpsErrorCode;

  constructor(code: ClientOpsErrorCode, message: string) {
    super(message);
    this.name = "ClientOpsError";
    this.code = code;
  }
}

export function isClientOpsError(value: unknown): value is ClientOpsError {
  return value instanceof ClientOpsError;
}
