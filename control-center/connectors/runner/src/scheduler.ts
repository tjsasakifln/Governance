import { randomInt } from "node:crypto";
import type pg from "pg";
import type { Persistence } from "@confenge/control-center-persistence";
import { trySourceLock, unlockSource } from "./advisory-lock.ts";
import { persistSourceResult } from "./persist.ts";
import {
  COLLECTOR_NAMES,
  type CollectFn,
  type CollectorName,
  runCollectors,
} from "./run.ts";

export type SourceSchedule = {
  intervalMs: number;
  jitterMs: number;
  timeoutMs: number;
  runOnStart: boolean;
};

export type SchedulerConfig = {
  sources: Record<CollectorName, SourceSchedule>;
};

export function scheduleFromEnv(env: NodeJS.ProcessEnv): SchedulerConfig {
  const intervalMs = readPositiveInt(env.CC_COLLECTOR_INTERVAL_MS, 300_000);
  const jitterMs = readNonNegativeInt(env.CC_COLLECTOR_JITTER_MS, 15_000);
  const timeoutMs = readPositiveInt(env.CC_COLLECTOR_TIMEOUT_MS, 60_000);
  const runOnStart = env.CC_COLLECTOR_RUN_ON_START !== "0";
  const sources = {} as Record<CollectorName, SourceSchedule>;
  for (const name of COLLECTOR_NAMES) {
    const prefix = `CC_COLLECTOR_${name.toUpperCase()}_`;
    sources[name] = {
      intervalMs: readPositiveInt(env[`${prefix}INTERVAL_MS`], intervalMs),
      jitterMs: readNonNegativeInt(env[`${prefix}JITTER_MS`], jitterMs),
      timeoutMs: readPositiveInt(env[`${prefix}TIMEOUT_MS`], timeoutMs),
      runOnStart: env[`${prefix}RUN_ON_START`] === "0" ? false : env[`${prefix}RUN_ON_START`] === "1" ? true : runOnStart,
    };
  }
  return { sources };
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function readNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

export class CollectorScheduler {
  initialized = false;
  private readonly timers = new Map<CollectorName, ReturnType<typeof setTimeout>>();
  private readonly inflightRuns = new Set<Promise<unknown>>();
  private stopping = false;

  constructor(
    private readonly pool: pg.Pool,
    private readonly persistence: Persistence,
    private readonly config: SchedulerConfig,
    private readonly options: {
      env: NodeJS.ProcessEnv;
      clock: () => Date;
      collectFns?: Partial<Record<CollectorName, CollectFn>>;
      names?: readonly CollectorName[];
      log?: (line: string) => void;
    },
  ) {}

  async start(): Promise<void> {
    await this.pool.query("SELECT 1");
    if (this.stopping) {
      return;
    }
    this.initialized = true;
    const names = this.options.names ?? COLLECTOR_NAMES;
    for (const name of names) {
      const delay = this.config.sources[name].runOnStart ? 0 : this.nextDelay(name);
      this.arm(name, delay);
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    await Promise.all([...this.inflightRuns]);
    this.initialized = false;
  }

  async runSource(name: CollectorName): Promise<"ran" | "skipped" | "stopped"> {
    if (this.stopping || !this.initialized) {
      return "stopped";
    }
    const run = this.runSourceLocked(name);
    this.inflightRuns.add(run);
    try {
      return await run;
    } finally {
      this.inflightRuns.delete(run);
    }
  }

  private async runSourceLocked(name: CollectorName): Promise<"ran" | "skipped" | "stopped"> {
    if (this.stopping || !this.initialized) {
      return "stopped";
    }
    const client = await this.pool.connect();
    let locked = false;
    try {
      locked = await trySourceLock(client, name);
      if (!locked) {
        return "skipped";
      }
      const envelope = await this.collectWithTimeout(name);
      await persistSourceResult(this.persistence, envelope);
      return "ran";
    } finally {
      try {
        if (locked) {
          await unlockSource(client, name);
        }
      } finally {
        client.release();
      }
    }
  }

  private async collectWithTimeout(name: CollectorName): Promise<import("./run.ts").CollectorEnvelope> {
    const now = this.options.clock();
    const timeoutMs = this.config.sources[name].timeoutMs;
    const controller = new AbortController();
    const collectPromise = this.invokeCollect(name, now, controller.signal);
    const raced = await raceCollect(collectPromise, timeoutMs);
    if (raced.timedOut) {
      controller.abort();
      await collectPromise.then(
        () => undefined,
        () => undefined,
      );
      return timeoutEnvelope(name, now);
    }
    if (!controller.signal.aborted) {
      controller.abort();
    }
    if (raced.error) {
      const message = raced.error instanceof Error ? raced.error.message : "collect failed";
      return {
        collector: name,
        freshness_status: "ERROR",
        observed_at: now.toISOString(),
        source: { system: name, kind: "collector-runner", locator: name },
        confidence: 0,
        error: { code: "collect_failed", message },
        payload: { ok: false },
      };
    }
    return raced.value ?? timeoutEnvelope(name, now);
  }

  private invokeCollect(
    name: CollectorName,
    now: Date,
    signal: AbortSignal,
  ): Promise<import("./run.ts").CollectorEnvelope> {
    const collectFn = this.options.collectFns?.[name];
    if (collectFn) {
      return collectFn({ env: this.options.env, now, signal });
    }
    return runCollectors({
      names: [name],
      env: this.options.env,
      now,
      log: this.options.log ?? (() => undefined),
      signal,
    }).then((result) => result.collectors[0] ?? timeoutEnvelope(name, now));
  }

  private arm(name: CollectorName, delayMs: number): void {
    if (this.stopping) {
      return;
    }
    const timer = setTimeout(() => {
      void this.runSource(name)
        .catch(() => undefined)
        .finally(() => {
          this.arm(name, this.nextDelay(name));
        });
    }, delayMs);
    timer.unref();
    this.timers.set(name, timer);
  }

  private nextDelay(name: CollectorName): number {
    const spec = this.config.sources[name];
    const jitter = spec.jitterMs > 0 ? randomInt(0, spec.jitterMs + 1) : 0;
    return spec.intervalMs + jitter;
  }
}

function raceCollect<T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<{ timedOut: true } | { timedOut: false; value?: T; error?: unknown }> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) {
        return;
      }
      done = true;
      resolve({ timedOut: true });
    }, timeoutMs);
    work.then(
      (value) => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        resolve({ timedOut: false, value });
      },
      (error: unknown) => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        resolve({ timedOut: false, error });
      },
    );
  });
}

function timeoutEnvelope(collector: CollectorName, now: Date): import("./run.ts").CollectorEnvelope {
  return {
    collector,
    freshness_status: "ERROR",
    observed_at: now.toISOString(),
    source: { system: collector, kind: "collector-runner", locator: collector },
    confidence: 0,
    error: { code: "timeout", message: "collector timed out" },
    payload: { ok: false },
  };
}
