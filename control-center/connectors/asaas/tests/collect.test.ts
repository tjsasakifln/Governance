import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  collectFinanceSnapshot,
  createFixtureTransport,
  defaultFixturesDir,
  loadFixtureJson,
  loadWebhookEvents,
  mapChargeLifecycle,
  normalizeToFinanceSnapshot,
  parseAsaasConfig,
  reaisToCents,
  recordsContainSecret,
  RecordingTransport,
  snapshotStableView,
  assertGetAllowed,
} from "../src/index.js";
import type { FinanceEntity, FinanceSnapshot } from "../src/index.js";

const NOW = new Date("2026-08-20T15:00:00.000Z");
const FIXTURE_KEY = "fixture-local-key-do-not-send";
const LIVE_LOOKING_KEY = "$aact_UNITTESTONLY_NOT_A_REAL_KEY";

function config(key = FIXTURE_KEY) {
  return parseAsaasConfig({
    ASAAS_ENVIRONMENT: "sandbox",
    ASAAS_API_KEY: key,
  });
}

async function collectFromFixtures(options?: {
  key?: string;
  statusOverrides?: Record<string, number>;
  now?: Date;
}): Promise<{
  snapshot: FinanceSnapshot;
  recording: RecordingTransport;
  logs: Record<string, unknown>[];
}> {
  const logs: Record<string, unknown>[] = [];
  const recording = new RecordingTransport(
    createFixtureTransport({ statusOverrides: options?.statusOverrides }),
  );
  const snapshot = await collectFinanceSnapshot({
    config: config(options?.key ?? FIXTURE_KEY),
    transport: recording,
    webhookEvents: loadWebhookEvents(),
    now: options?.now ?? NOW,
    logSink: (row) => logs.push(row),
  });
  return { snapshot, recording, logs };
}

function chargeById(snapshot: FinanceSnapshot, id: string): FinanceEntity {
  const found = snapshot.entities.charges.find((c) => c.provider_id === id);
  assert.ok(found, `missing charge ${id}`);
  return found;
}

function fixtureChargeValue(id: string): number {
  const page = loadFixtureJson("payments") as { data: Array<{ id: string; value: number }> };
  const row = page.data.find((item) => item.id === id);
  assert.ok(row, `fixture missing ${id}`);
  return row.value;
}

describe("collectFinanceSnapshot from fixtures", () => {
  it("returns customers, charges, subscriptions, pix and receivables", async () => {
    const { snapshot } = await collectFromFixtures();
    assert.ok(snapshot.entities.customers.length >= 2);
    assert.ok(snapshot.entities.charges.length >= 5);
    assert.ok(snapshot.entities.subscriptions.length >= 2);
    assert.ok(snapshot.entities.pix.length >= 1);
    assert.ok(snapshot.entities.receivables.length >= 1);
    assert.equal(snapshot.source, "asaas");
    assert.equal(snapshot.schema_version, "control-center.finance-snapshot.v1");
  });

  it("maps CONFIRMED to paid-not-received and RECEIVED to received", async () => {
    const { snapshot } = await collectFromFixtures();
    const confirmed = chargeById(snapshot, "pay_fixtureConfirmed01");
    const received = chargeById(snapshot, "pay_fixtureReceived01");
    const overdue = chargeById(snapshot, "pay_fixtureOverdue01");
    const refunded = chargeById(snapshot, "pay_fixtureRefunded01");
    const cancelled = chargeById(snapshot, "pay_fixtureCancelled01");

    assert.equal(confirmed.lifecycle, "paid");
    assert.equal(confirmed.provider_status, "CONFIRMED");
    assert.ok(snapshot.buckets.paid.provider_ids.includes(confirmed.provider_id));
    assert.ok(!snapshot.buckets.received.provider_ids.includes(confirmed.provider_id));

    assert.equal(received.lifecycle, "received");
    assert.ok(snapshot.buckets.received.provider_ids.includes(received.provider_id));
    assert.ok(snapshot.buckets.paid.provider_ids.includes(received.provider_id));

    assert.equal(overdue.lifecycle, "overdue");
    assert.equal(refunded.lifecycle, "refunded");
    assert.equal(cancelled.lifecycle, "cancelled");
    assert.equal(cancelled.deleted, true);
    assert.ok(!snapshot.buckets.billed.provider_ids.includes(cancelled.provider_id));

    const inactive = snapshot.entities.subscriptions.find(
      (s) => s.provider_id === "sub_fixtureInactive01",
    );
    assert.ok(inactive);
    assert.equal(inactive.lifecycle, "cancelled");
    assert.equal(inactive.provider_status, "INACTIVE");
    assert.equal(mapChargeLifecycle("CONFIRMED", false), "paid");
    assert.equal(mapChargeLifecycle("RECEIVED", false), "received");
  });

  it("round-trips amounts as integer cents + BRL and keeps ids/references/provenance", async () => {
    const { snapshot } = await collectFromFixtures();
    const confirmed = chargeById(snapshot, "pay_fixtureConfirmed01");
    assert.deepEqual(confirmed.amount, {
      cents: reaisToCents(fixtureChargeValue("pay_fixtureConfirmed01")),
      currency: "BRL",
    });
    assert.equal(
      confirmed.external_reference,
      "cfg:CFG-DIAG-EXP-v1:corr-fixture-01",
    );
    assert.match(confirmed.provider_id, /^pay_/);
    assert.match(confirmed.idempotency_key, /^asaas:sandbox:charge:pay_/);
    assert.equal(confirmed.customer_id, "cus_fixtureAlfa");
    assert.equal(confirmed.provenance.source, "asaas.payments.list");
    assert.equal(confirmed.provenance.observed_at, NOW.toISOString());
    assert.ok(confirmed.provenance.freshness_status);
    assert.equal(typeof confirmed.provenance.confidence, "number");

    for (const bucket of Object.values(snapshot.buckets)) {
      assert.equal(bucket.currency, "BRL");
      assert.equal(Number.isInteger(bucket.cents), true);
      assert.equal(bucket.provenance.source.startsWith("asaas."), true);
      assert.ok(bucket.provenance.observed_at);
      assert.ok(bucket.provenance.freshness_status);
    }
    assert.ok(snapshot.provenance.source);
    assert.ok(snapshot.observed_at);
    assert.ok(snapshot.freshness_status);
  });

  it("keeps contracted billed paid received as distinct totals", async () => {
    const { snapshot } = await collectFromFixtures();
    const { contracted, billed, paid, received } = snapshot.buckets;
    assert.notEqual(contracted.cents, billed.cents);
    assert.notEqual(paid.cents, received.cents);
    assert.ok(paid.cents > received.cents);
    assert.ok(billed.cents > paid.cents);
    assert.ok(received.cents > 0);
    assert.ok(!received.provider_ids.includes("pay_fixtureConfirmed01"));
    const keys = Object.keys(snapshot.buckets).sort();
    assert.deepEqual(keys, ["billed", "contracted", "paid", "received"]);
  });

  it("is idempotent: second collect of the same fixtures does not duplicate entities", async () => {
    const first = await collectFromFixtures();
    const second = await collectFromFixtures();
    assert.equal(
      first.snapshot.entities.charges.length,
      new Set(first.snapshot.entities.charges.map((c) => c.provider_id)).size,
    );
    assert.deepEqual(
      snapshotStableView(first.snapshot),
      snapshotStableView(second.snapshot),
    );
    const receivedCopies = first.snapshot.entities.charges.filter(
      (c) => c.provider_id === "pay_fixtureReceived01",
    );
    assert.equal(receivedCopies.length, 1);
  });

  it("collapses duplicate webhook + list for the same pay_* to one entity", async () => {
    const { snapshot } = await collectFromFixtures();
    const matches = snapshot.entities.charges.filter(
      (c) => c.provider_id === "pay_fixtureReceived01",
    );
    assert.equal(matches.length, 1);
    assert.ok(
      snapshot.observations.some(
        (o) =>
          o.kind === "duplicate" &&
          o.provider_ids.includes("pay_fixtureReceived01"),
      ),
    );
  });

  it("records list CONFIRMED vs webhook PAYMENT_RECEIVED as inconsistency and does not promote", async () => {
    const { snapshot } = await collectFromFixtures();
    const mismatch = snapshot.observations.filter(
      (o) =>
        o.kind === "inconsistency" &&
        o.provider_ids.includes("pay_fixtureConfirmed01"),
    );
    assert.ok(mismatch.length >= 1);
    assert.equal(snapshot.freshness_status, "inconsistent");
    const confirmed = chargeById(snapshot, "pay_fixtureConfirmed01");
    assert.equal(confirmed.lifecycle, "paid");
    assert.equal(confirmed.provenance.freshness_status, "inconsistent");
    assert.ok(!snapshot.buckets.received.provider_ids.includes("pay_fixtureConfirmed01"));
    const blob = JSON.stringify(snapshot);
    assert.doesNotMatch(blob, /"receita"/i);
    assert.doesNotMatch(blob, /"revenue"/i);
  });

  it("records only GET empty-body allowlisted calls on the recording transport", async () => {
    const { recording } = await collectFromFixtures();
    assert.ok(recording.log.length >= 6);
    const paths = new Set<string>();
    for (const entry of recording.log) {
      assert.equal(entry.method, "GET");
      assert.equal(entry.body, null);
      const u = new URL(entry.url);
      assertGetAllowed("GET", u.pathname);
      paths.add(u.pathname);
      assert.doesNotMatch(entry.url, /access_token|api[_-]?key|\$aact_/i);
    }
    for (const required of [
      "/v3/customers",
      "/v3/payments",
      "/v3/subscriptions",
      "/v3/pix/transactions",
      "/v3/finance/balance",
      "/v3/financialTransactions",
    ]) {
      assert.ok(paths.has(required), `missing GET ${required}`);
    }
  });

  it("omits balance on 401/403 instead of inventing it", async () => {
    const { snapshot } = await collectFromFixtures({
      statusOverrides: { "/v3/finance/balance": 403 },
    });
    assert.equal(snapshot.balance.omitted, true);
    if (snapshot.balance.omitted) {
      assert.match(snapshot.balance.reason, /http_403/);
      assert.equal(snapshot.balance.provenance.freshness_status, "absent");
    }
    assert.ok(
      snapshot.observations.some((o) => o.code === "balance_unavailable"),
    );
    assert.ok(snapshot.entities.charges.length > 0);
  });

  it("does not leak API keys into logs or fixtures", async () => {
    const { logs } = await collectFromFixtures({ key: LIVE_LOOKING_KEY });
    assert.equal(recordsContainSecret(logs, LIVE_LOOKING_KEY), false);
    const blob = JSON.stringify(logs);
    assert.doesNotMatch(blob, /\$aact_/);
    assert.doesNotMatch(blob, /UNITTESTONLY/);
    const dir = defaultFixturesDir();
    for (const name of readdirSync(dir)) {
      const text = readFileSync(join(dir, name), "utf8");
      assert.doesNotMatch(text, /\$aact_/);
      assert.doesNotMatch(text, /access_token\s*[:=]/i);
      assert.doesNotMatch(text, /ASAAS_API_KEY\s*=\s*\S+/);
    }
  });

  it("does not copy customer PII into the snapshot", async () => {
    const { snapshot } = await collectFromFixtures();
    const blob = JSON.stringify(snapshot.entities.customers);
    assert.doesNotMatch(blob, /email/i);
    assert.doesNotMatch(blob, /cpf/i);
    assert.doesNotMatch(blob, /phone/i);
  });

  it("exposes the pure normalizer as a shipped entry", () => {
    const snapshot = normalizeToFinanceSnapshot({
      environment: "sandbox",
      observedAt: NOW.toISOString(),
      customers: [{ id: "cus_x" }],
      charges: [
        {
          id: "pay_x",
          status: "CONFIRMED",
          valueReais: 10,
          deleted: false,
          externalReference: "cfg:x:y",
        },
      ],
      subscriptions: [],
      pix: [],
    });
    assert.equal(snapshot.entities.charges[0]?.lifecycle, "paid");
    assert.ok(!snapshot.buckets.received.provider_ids.includes("pay_x"));
    assert.equal(snapshot.buckets.paid.cents, reaisToCents(10));
  });
});
