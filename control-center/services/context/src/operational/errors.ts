export class OperationalUnavailableError extends Error {
  readonly code = "operational_unavailable" as const;

  constructor(message = "operational views are unavailable") {
    super(message);
    this.name = "OperationalUnavailableError";
  }
}

export function isOperationalUnavailableError(err: unknown): err is OperationalUnavailableError {
  return err instanceof OperationalUnavailableError;
}
