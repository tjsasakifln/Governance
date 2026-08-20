export const LEDGER_ERROR_CODES = [
  "invalid_input",
  "missing_provenance",
  "sensitive_field",
  "not_found",
] as const;

export type LedgerErrorCode = (typeof LEDGER_ERROR_CODES)[number];

export class LedgerError extends Error {
  readonly code: LedgerErrorCode;

  constructor(code: LedgerErrorCode, message: string) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}

export function isLedgerError(value: unknown): value is LedgerError {
  return value instanceof LedgerError;
}
