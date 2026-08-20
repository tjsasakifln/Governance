export class FailClosedError extends Error {
  readonly code = "fail_closed";

  constructor(message: string) {
    super(message);
    this.name = "FailClosedError";
  }
}

export function failClosed(message: string): never {
  throw new FailClosedError(message);
}

export function isFailClosed(err: unknown): err is FailClosedError {
  return err instanceof FailClosedError;
}
