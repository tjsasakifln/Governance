export class DirectiveUiError extends Error {
  readonly code: string;
  readonly fields: Readonly<Record<string, string>>;

  constructor(code: string, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = "DirectiveUiError";
    this.code = code;
    this.fields = fields;
  }
}

export function isDirectiveUiError(error: unknown): error is DirectiveUiError {
  return error instanceof DirectiveUiError;
}
