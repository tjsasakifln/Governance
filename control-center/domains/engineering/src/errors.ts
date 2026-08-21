export const ENGINEERING_ERROR_CODES = [
  "missing_provenance",
  "invalid_input",
  "invalid_scope",
  "unusable_observation",
] as const;

export type EngineeringErrorCode = (typeof ENGINEERING_ERROR_CODES)[number];

export class EngineeringError extends Error {
  readonly code: EngineeringErrorCode;

  constructor(code: EngineeringErrorCode, message: string) {
    super(message);
    this.name = "EngineeringError";
    this.code = code;
  }
}

export function isEngineeringError(value: unknown): value is EngineeringError {
  return value instanceof EngineeringError;
}
