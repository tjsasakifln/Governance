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
  private readonly inFlight = new Map<CollectorName, Promise<void>>();
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
    await Promise.all([...this.inFlight.values()]);
    this.initialized = false;
  }

  async runSource(name: CollectorName): Promise<"ran" | "skipped" | "stopped"> {
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
      const timeoutMs = this.config.sources[name].timeoutMs;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      timer.unref();
      try {
        const now = this.options.clock();
        const collectFn = this.options.collectFns?.[name];
        let envelope: import("./run.ts").CollectorEnvelope | undefined;
        try {
          envelope = collectFn
            ? await Promise.race([
                collectFn({ env: this.options.env, now, signal: controller.signal }),
                abortError(controller.signal, name, now),
              ])
            : (await runCollectors({
                names: [name],
                env: this.options.env,
                now,
                log: this.options.log ?? (() => undefined),
              })).collectors[0];
        } catch (error) {
          const message = error instanceof Error ? error.message : "collect failed";
          envelope = {
            collector: name,
            freshness_status: "ERROR",
            observed_at: now.toISOString(),
            source: { system: name, kind: "collector-runner", locator: name },
            confidence: 0,
            error: { code: "collect_failed", message },
            payload: { ok: false },
          };
        }
        if (!envelope) {
          return "ran";
        }
        await persistSourceResult(this.persistence, envelope);
      } finally {
        clearTimeout(timer);
      }
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

  private arm(name: CollectorName, delayMs: number): void {
    if (this.stopping) {
      return;
    }
    const timer = setTimeout(() => {
      const running = this.runSource(name)
        .catch(() => undefined)
        .finally(() => {
          this.inFlight.delete(name);
          this.arm(name, this.nextDelay(name));
        });
      this.inFlight.set(name, running.then(() => undefined));
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

async function abortError(
  signal: AbortSignal,
  collector: CollectorName,
  now: Date,
): Promise<import("./run.ts").CollectorEnvelope> {
  if (signal.aborted) {
    return timeoutEnvelope(collector, now);
  }
  return new Promise((resolve) => {
    signal.addEventListener(
      "abort",
      () => {
        resolve(timeoutEnvelope(collector, now));
      },
      { once: true },
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
