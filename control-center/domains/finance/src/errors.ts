export class FinanceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FinanceError";
    this.code = code;
  }
}

export class FinanceValidationError extends FinanceError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "FinanceValidationError";
  }
}

export class FinanceDeniedError extends FinanceError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "FinanceDeniedError";
  }
}
