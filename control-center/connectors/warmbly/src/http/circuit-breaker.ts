export type CircuitState = "closed" | "open" | "half_open";

export type CircuitBreakerOptions = {
  failureThreshold: number;
  resetMs: number;
  now?: () => number;
};

export class CircuitOpenError extends Error {
  readonly code = "CIRCUIT_OPEN" as const;
  constructor(message = "Warmbly circuit breaker is open; fail-closed without upstream call") {
    super(message);
    this.name = "CircuitOpenError";
  }
}

export class CircuitBreaker {
  private failures = 0;
  private state: CircuitState = "closed";
  private openedAt = 0;
  private readonly failureThreshold: number;
  private readonly resetMs: number;
  private readonly now: () => number;

  constructor(opts: CircuitBreakerOptions) {
    this.failureThreshold = opts.failureThreshold;
    this.resetMs = opts.resetMs;
    this.now = opts.now ?? (() => Date.now());
  }

  getState(): CircuitState {
    this.maybeHalfOpen();
    return this.state;
  }

  assertClosed(): void {
    if (this.getState() === "open") {
      throw new CircuitOpenError();
    }
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = "closed";
    this.openedAt = 0;
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.state === "half_open" || this.failures >= this.failureThreshold) {
      this.state = "open";
      this.openedAt = this.now();
    }
  }

  private maybeHalfOpen(): void {
    if (this.state === "open" && this.now() - this.openedAt >= this.resetMs) {
      this.state = "half_open";
    }
  }
}
