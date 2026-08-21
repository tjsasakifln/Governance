import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AsaasMutationForbiddenError,
  DefaultFetchTransport,
  GetOnlyAsaasClient,
  MUTATION_METHODS,
  RecordingTransport,
  collectFinanceSnapshot,
  createFixtureTransport,
  mapChargeLifecycle,
  parseAsaasConfig,
  recordsContainSecret,
  runAsaasCanary,
  runCanaryCli,
} from "../src/index.js";
import { CAPABILITIES, CANARY_COLLECTORS } from "../src/envelope.js";
import { ASAAS_REQUIRED_SECRETS } from "../src/production-config.js";
import type { HttpRequest, HttpResponse, HttpTransport } from "../src/index.js";

const NOW = new Date("2026-08-21T12:00:00.000Z");
const KEY = "fixture-local-key-do-not-send";
const LIVE_LOOKING_KEY = "$aact_UNITTESTONLY_NOT_A_REAL_KEY";

class BoomTransport implements HttpTransport {
  calls = 0;
  async request(_req: HttpRequest): Promise<HttpResponse> {
    this.calls += 1;
    throw new Error("transport must not be reached");
  }
}

class ScriptedTransport implements HttpTransport {
  readonly calls: HttpRequest[] = [];
  constructor(private readonly handler: (req: HttpRequest) => HttpResponse | Promise<HttpResponse>) {}
  async request(req: HttpRequest): Promise<HttpResponse> {
    this.calls.push(req);
    return this.handler(req);
  }
}

function emptyPage(): unknown {
  return { object: "list", hasMore: false, totalCount: 0, limit: 100, offset: 0, data: [] };
}

function jsonResponse(status: number, body: unknown): HttpResponse {
  return {
    status,
    headers: { "content-type": "application/json" },
    bodyText: JSON.stringify(body),
  };
}

function assertEnvelope(report: Awaited<ReturnType<typeof runAsaasCanary>>): void {
  assert.equal(report.collector, "asaas");
  assert.ok((CANARY_COLLECTORS as readonly string[]).includes(report.collector));
  assert.ok(["FRESH", "STALE", "UNKNOWN", "ERROR"].includes(report.freshness_status));
  assert.ok(report.observed_at.endsWith("Z"));
  assert.equal(typeof report.source.system, "string");
  assert.equal(typeof report.source.kind, "string");
  assert.equal(typeof report.source.locator, "string");
  assert.equal(typeof report.confidence, "number");
  assert.ok(
    report.error === null ||
      (typeof report.error.code === "string" && typeof report.error.message === "string"),
  );
  assert.equal(typeof report.payload, "object");
  assert.equal(typeof report.idempotency_key, "string");
  assert.ok((CAPABILITIES as readonly string[]).includes(report.capability));
}

describe("asaas production canary", () => {
  it("missing secrets yield CREDENTIAL_MISSING / BLOCKED_BY_SECRET and never open a socket", async () => {
    const boom = new BoomTransport();
    const report = await runAsaasCanary({ env: {}, now: NOW, transport: boom });
    assertEnvelope(report);
    assert.equal(report.capability, "BLOCKED_BY_SECRET");
    assert.equal(report.error?.code, "CREDENTIAL_MISSING");
    assert.equal(report.confidence, 0);
    assert.notEqual(report.freshness_status, "FRESH");
    assert.ok((report.payload.required_secrets as string[]).includes("ASAAS_ENVIRONMENT"));
    assert.ok((report.payload.required_secrets as string[]).includes("ASAAS_API_KEY"));
    assert.deepEqual([...ASAAS_REQUIRED_SECRETS], ["ASAAS_ENVIRONMENT", "ASAAS_API_KEY"]);
    assert.equal(boom.calls, 0);
  });

  it("two pinned-clock blocked runs share idempotency_key", async () => {
    const first = await runAsaasCanary({ env: {}, now: NOW, transport: new BoomTransport() });
    const second = await runAsaasCanary({ env: {}, now: NOW, transport: new BoomTransport() });
    assert.equal(first.idempotency_key, second.idempotency_key);
    assert.equal(first.capability, second.capability);
  });

  it("empty 200 lists are success, not error; 401/403/429/5xx stay ERROR", async () => {
    const empty = new ScriptedTransport(() => jsonResponse(200, emptyPage()));
    const emptyReport = await runAsaasCanary({
      env: { ASAAS_ENVIRONMENT: "sandbox", ASAAS_API_KEY: KEY },
      now: NOW,
      transport: empty,
    });
    assertEnvelope(emptyReport);
    assert.notEqual(emptyReport.freshness_status, "ERROR");
    assert.ok(empty.calls.length > 0);

    for (const status of [401, 403, 429, 500, 503]) {
      const failing = new ScriptedTransport(() => jsonResponse(status, { errors: [{ code: "x" }] }));
      const report = await runAsaasCanary({
        env: { ASAAS_ENVIRONMENT: "sandbox", ASAAS_API_KEY: KEY },
        now: NOW,
        transport: failing,
      });
      assertEnvelope(report);
      assert.notEqual(report.freshness_status, "FRESH");
      assert.equal(report.freshness_status, "ERROR");
    }
  });

  it("timeout is ERROR not empty FRESH", async () => {
    let fetchCalls = 0;
    const transport = new DefaultFetchTransport(async () => {
      fetchCalls += 1;
      const err = new Error("This operation was aborted");
      err.name = "TimeoutError";
      throw err;
    }, 20);
    const report = await runAsaasCanary({
      env: { ASAAS_ENVIRONMENT: "sandbox", ASAAS_API_KEY: KEY },
      now: NOW,
      transport,
    });
    assertEnvelope(report);
    assert.notEqual(report.freshness_status, "FRESH");
    assert.ok(fetchCalls >= 1);
  });

  it("POST/PUT/PATCH/DELETE and mutation paths never hit transport; CONFIRMED is not received", async () => {
    const boom = new BoomTransport();
    const config = parseAsaasConfig({ ASAAS_ENVIRONMENT: "sandbox", ASAAS_API_KEY: KEY });
    const client = new GetOnlyAsaasClient(config, boom);
    for (const method of MUTATION_METHODS) {
      await assert.rejects(() => client.request(method, "/v3/payments"), AsaasMutationForbiddenError);
    }
    assert.throws(() => client.post("/v3/checkouts"), AsaasMutationForbiddenError);
    assert.equal(boom.calls, 0);
    assert.equal(mapChargeLifecycle("CONFIRMED", false), "paid");
    assert.notEqual(mapChargeLifecycle("CONFIRMED", false), "received");

    const recording = new RecordingTransport(createFixtureTransport());
    const snapshot = await collectFinanceSnapshot({ config, transport: recording, now: NOW });
    const confirmed = snapshot.entities.charges.find((c) => c.provider_status === "CONFIRMED");
    assert.ok(confirmed);
    assert.equal(confirmed.lifecycle, "paid");
    assert.ok(!snapshot.buckets.received.provider_ids.includes(confirmed.provider_id));
    for (const entry of recording.log) {
      assert.equal(entry.method, "GET");
    }
  });

  it("redacts API keys and does not put PII into canary JSON", async () => {
    const logs: Record<string, unknown>[] = [];
    const report = await runAsaasCanary({
      env: { ASAAS_ENVIRONMENT: "sandbox", ASAAS_API_KEY: LIVE_LOOKING_KEY },
      now: NOW,
      transport: createFixtureTransport(),
      log: (line) => logs.push(JSON.parse(line) as Record<string, unknown>),
    });
    const blob = `${JSON.stringify(report)}\n${JSON.stringify(logs)}`;
    assert.equal(blob.includes(LIVE_LOOKING_KEY), false);
    assert.equal(/\$aact_/i.test(blob), false);
    assert.equal(/@/.test(blob) && /email/i.test(blob), false);
    assert.equal(recordsContainSecret(logs, LIVE_LOOKING_KEY), false);
    assert.equal(
      JSON.stringify(report.payload).includes("cpf") || JSON.stringify(report.payload).includes("email"),
      false,
    );
  });

  it("CLI entry emits BLOCKED_BY_SECRET without secrets", async () => {
    const lines: string[] = [];
    const outcome = await runCanaryCli(["asaas", "--now", NOW.toISOString()], {}, {
      stdout: (line) => lines.push(line),
      stderr: () => undefined,
    });
    assert.equal(outcome.code, 0);
    const parsed = JSON.parse(lines.join("\n")) as Awaited<ReturnType<typeof runAsaasCanary>>;
    assertEnvelope(parsed);
    assert.equal(parsed.capability, "BLOCKED_BY_SECRET");
  });
});
