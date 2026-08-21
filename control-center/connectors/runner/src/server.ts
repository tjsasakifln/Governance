import { once } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import {
  createPersistence,
  createPoolFromEnv,
  expectedMigrationsPresent,
  pingStore,
  stripSecretOrPiiKeys,
  type Persistence,
} from "@confenge/control-center-persistence";
import type pg from "pg";
import { COLLECTOR_NAMES, type CollectFn, type CollectorName } from "./run.ts";
import { CollectorScheduler, scheduleFromEnv } from "./scheduler.ts";

export type CollectorServerOptions = {
  collectFns?: Partial<Record<CollectorName, CollectFn>>;
  clock?: () => Date;
  persistence?: Persistence;
  pool?: pg.Pool;
  schedulerEnabled?: boolean;
  closePoolOnStop?: boolean;
  names?: readonly CollectorName[];
};

type Runtime = {
  persistence: Persistence | null;
  pool: pg.Pool | null;
  scheduler: CollectorScheduler | null;
  closePoolOnStop: boolean;
  collectFns?: Partial<Record<CollectorName, CollectFn>>;
  clock: () => Date;
  env: NodeJS.ProcessEnv;
  names: readonly CollectorName[];
};

const runtimes = new WeakMap<Server, Runtime>();

function listenPort(env: NodeJS.ProcessEnv): number {
  const raw = env.PORT ?? "8080";
  const port = Number.parseInt(raw, 10);
  return Number.isInteger(port) ? port : 8080;
}

function isProduction(env: NodeJS.ProcessEnv): boolean {
  return (env.NODE_ENV ?? "").trim() === "production";
}

function manualRunEnabled(env: NodeJS.ProcessEnv): boolean {
  if (isProduction(env) && env.CC_COLLECTOR_MANUAL_RUN !== "1") {
    return false;
  }
  return env.CC_COLLECTOR_MANUAL_RUN === "1" || !isProduction(env);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(stripSecretOrPiiKeys(body)));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function handleReady(runtime: Runtime, res: ServerResponse): Promise<void> {
  if (!runtime.pool || !runtime.persistence) {
    json(res, 503, { ready: false, reason: "store_unavailable" });
    return;
  }
  try {
    await runtime.pool.query("SELECT 1");
  } catch {
    json(res, 503, { ready: false, reason: "database_unreachable" });
    return;
  }
  try {
    const present = await expectedMigrationsPresent(runtime.pool);
    if (!present) {
      json(res, 503, { ready: false, reason: "migrations_missing" });
      return;
    }
  } catch {
    json(res, 503, { ready: false, reason: "migrations_missing" });
    return;
  }
  if (!runtime.scheduler?.initialized) {
    json(res, 503, { ready: false, reason: "scheduler_not_initialized" });
    return;
  }
  try {
    await pingStore(runtime.pool);
  } catch {
    json(res, 503, { ready: false, reason: "store_not_functional" });
    return;
  }
  json(res, 200, { ready: true, service: "control-center-collector" });
}

async function handleLast(runtime: Runtime, res: ServerResponse): Promise<void> {
  if (!runtime.persistence) {
    json(res, 503, { error: "store_unavailable" });
    return;
  }
  try {
    const rows = await runtime.persistence.listLatestCollectorRuns();
    json(res, 200, {
      collectors: rows.map((row) => ({
        collector: row.collector,
        run_id: row.runId,
        status: row.status,
        freshness_status: row.freshnessStatus,
        started_at: row.startedAt.toISOString(),
        finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
        observed_at: row.observedAt.toISOString(),
        error_code: row.errorCode,
      })),
    });
  } catch {
    json(res, 503, { error: "store_unavailable" });
  }
}

async function handleStatus(runtime: Runtime, res: ServerResponse): Promise<void> {
  if (!runtime.persistence) {
    json(res, 503, { error: "store_unavailable" });
    return;
  }
  try {
    const now = runtime.clock();
    const rows = await runtime.persistence.listLatestCollectorRuns();
    const byCollector = new Map(rows.map((row) => [row.collector, row]));
    const sources = (runtime.names ?? COLLECTOR_NAMES).map((name) => {
      const row = byCollector.get(name);
      const observedAt = row?.observedAt ?? null;
      const ageSeconds =
        observedAt !== null ? Math.max(0, Math.floor((now.getTime() - observedAt.getTime()) / 1000)) : null;
      return {
        collector: name,
        freshness_status: row?.freshnessStatus ?? null,
        status: row?.status ?? null,
        age_seconds: ageSeconds,
        observed_at: observedAt ? observedAt.toISOString() : null,
        last_error: row?.errorCode ? { code: row.errorCode } : null,
      };
    });
    json(res, 200, { utc: true, sources });
  } catch {
    json(res, 503, { error: "store_unavailable" });
  }
}

async function handleRun(req: IncomingMessage, runtime: Runtime, res: ServerResponse): Promise<void> {
  if (!manualRunEnabled(runtime.env)) {
    json(res, 403, { error: "manual_run_disabled" });
    return;
  }
  const expected = (runtime.env.CC_COLLECTOR_RUN_TOKEN ?? "").trim();
  if (!expected) {
    json(res, 403, { error: "manual_run_token_required" });
    return;
  }
  const provided = String(req.headers["x-cc-collector-run-token"] ?? "").trim();
  if (provided !== expected) {
    json(res, 401, { error: "unauthorized" });
    return;
  }
  if (!runtime.persistence || !runtime.scheduler?.initialized) {
    json(res, 503, { error: "store_unavailable" });
    return;
  }
  let names = [...(runtime.names ?? COLLECTOR_NAMES)];
  try {
    const body = await readJson(req);
    if (body && typeof body === "object" && "names" in body && Array.isArray((body as { names: unknown }).names)) {
      names = (body as { names: unknown[] }).names.filter(
        (item): item is CollectorName =>
          typeof item === "string" && (COLLECTOR_NAMES as readonly string[]).includes(item),
      );
    }
  } catch {
    json(res, 400, { error: "invalid_json" });
    return;
  }
  const correlationId = `cc-run:${runtime.clock().toISOString()}`;
  const persistence = runtime.persistence;
  await persistence.appendAuditEvent({
    actor: "collector-runner",
    action: "collector.manual_run",
    entityType: "collector_run",
    entityId: null,
    scope: "company",
    payload: { correlationId, names },
    source: { system: "control-center", kind: "collector-runner", locator: "manual-run" },
    observedAt: runtime.clock(),
    freshnessStatus: "FRESH",
    confidence: 1,
  });
  const results = [];
  for (const name of names) {
    const outcome = await runtime.scheduler.runSource(name);
    results.push({ collector: name, outcome });
  }
  const last = await persistence.listLatestCollectorRuns();
  const statuses = last.map((row) => row.status);
  const aggregate = statuses.includes("FAILED") && statuses.some((item) => item === "DONE")
    ? "PARTIAL"
    : statuses.every((item) => item === "DONE")
      ? "DONE"
      : statuses.includes("PARTIAL")
        ? "PARTIAL"
        : statuses.includes("FAILED")
          ? "FAILED"
          : "UNKNOWN";
  json(res, 200, {
    correlation_id: correlationId,
    status: aggregate,
    results,
    collectors: last.map((row) => ({
      collector: row.collector,
      run_id: row.runId,
      status: row.status,
      freshness_status: row.freshnessStatus,
      observed_at: row.observedAt.toISOString(),
      error_code: row.errorCode,
    })),
  });
}

export function startCollectorServer(
  env: NodeJS.ProcessEnv = process.env,
  options: CollectorServerOptions = {},
): Server {
  const host = (env.HOST ?? "127.0.0.1").trim() || "127.0.0.1";
  const port = listenPort(env);
  const pool = options.pool ?? options.persistence?.pool ?? tryPool(env);
  const persistence = options.persistence ?? (pool ? createPersistence(pool) : null);
  const schedulerEnabled = options.schedulerEnabled ?? env.CC_COLLECTOR_SCHEDULER !== "0";
  const names = options.names ?? COLLECTOR_NAMES;
  const clock = options.clock ?? (() => new Date());
  const scheduler =
    pool && persistence && schedulerEnabled
      ? new CollectorScheduler(pool, persistence, scheduleFromEnv(env), {
          env,
          clock,
          collectFns: options.collectFns,
          names,
        })
      : null;
  const runtime: Runtime = {
    persistence,
    pool,
    scheduler,
    closePoolOnStop: options.closePoolOnStop ?? (!options.pool && !options.persistence && pool !== null),
    collectFns: options.collectFns,
    clock,
    env,
    names,
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    if (req.method === "GET" && url.pathname === "/healthz") {
      json(res, 200, { ok: true, service: "control-center-collector" });
      return;
    }
    if (req.method === "GET" && url.pathname === "/ready") {
      void handleReady(runtime, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/last") {
      void handleLast(runtime, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/status") {
      void handleStatus(runtime, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/run") {
      void handleRun(req, runtime, res);
      return;
    }
    json(res, 404, { error: "not_found" });
  });
  runtimes.set(server, runtime);
  server.listen(port, host);
  if (scheduler) {
    void scheduler.start();
  }
  return server;
}

export async function stopCollectorServer(server: Server): Promise<void> {
  const runtime = runtimes.get(server);
  if (runtime?.scheduler) {
    await runtime.scheduler.stop();
  }
  await new Promise<void>((resolve, reject) => {
    if (typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    }
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  if (runtime?.closePoolOnStop && runtime.pool) {
    await runtime.pool.end();
  }
  runtimes.delete(server);
}

export function collectorSchedulerOf(server: Server): CollectorScheduler | null {
  return runtimes.get(server)?.scheduler ?? null;
}

export async function whenCollectorServerListening(server: Server): Promise<number> {
  if (!server.listening) {
    await once(server, "listening");
  }
  const address = server.address();
  if (typeof address === "object" && address) {
    return address.port;
  }
  throw new Error("collector server is not listening on a TCP port");
}

export async function whenCollectorSchedulerReady(server: Server, timeoutMs = 10_000): Promise<void> {
  const runtime = runtimes.get(server);
  if (!runtime) {
    throw new Error("unknown collector server");
  }
  if (!runtime.scheduler) {
    return;
  }
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (runtime.scheduler.initialized) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }
  throw new Error("collector scheduler did not initialize");
}

function tryPool(env: NodeJS.ProcessEnv): pg.Pool | null {
  try {
    if (!env.CONTROL_CENTER_DATABASE_URL) {
      return null;
    }
    return createPoolFromEnv(env);
  } catch {
    return null;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const server = startCollectorServer();
  const shutdown = () => {
    void stopCollectorServer(server).finally(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
