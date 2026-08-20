export class PersistenceError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PersistenceError';
    this.code = code;
  }
}

export class ValidationError extends PersistenceError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('VALIDATION', message, options);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends PersistenceError {
  constructor(message: string) {
    super('NOT_FOUND', message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends PersistenceError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('CONFLICT', message, options);
    this.name = 'ConflictError';
  }
}

export class AppendOnlyError extends PersistenceError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('APPEND_ONLY', message, options);
    this.name = 'AppendOnlyError';
  }
}
