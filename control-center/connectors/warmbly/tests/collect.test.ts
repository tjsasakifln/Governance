import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attentionSlice,
  collect,
  collectFromWarmblyPayload,
} from "../src/collect.ts";
import { COMMERCIAL_SNAPSHOT_SCHEMA, SNAPSHOT_SOURCE } from "../src/contracts/snapshot.ts";
import { WarmblyClient } from "../src/http/client.ts";
import { startFixtureStub } from "../src/stub-server.ts";
import { loadFixture, NOW } from "./helpers.ts";

describe("collectFromWarmblyPayload (shipped normalize)", () => {
  it("maps Warmbly-shaped fixtures into CommercialSnapshot + observations with provenance", () => {
    const payload = loadFixture("commercial-runtime.json");
    const snapshot = collectFromWarmblyPayload(payload, { now: NOW });

    assert.equal(snapshot.schema, COMMERCIAL_SNAPSHOT_SCHEMA);
    assert.equal(snapshot.source, SNAPSHOT_SOURCE);
    assert.equal(snapshot.observed_at, NOW.toISOString());
    assert.ok(["FRESH", "STALE", "UNKNOWN", "ERROR"].includes(snapshot.freshness_status));
    assert.equal(snapshot.health.status, "ok");
    assert.equal(snapshot.health.api_version, "v1");

    for (const row of snapshot.attention) {
      assert.equal(row.provenance.source, "warmbly");
      assert.equal(row.provenance.observed_at, NOW.toISOString());
      assert.ok(row.provenance.freshness_status);
    }
    for (const obs of snapshot.observations) {
      assert.equal(obs.provenance.source, "warmbly");
      assert.equal(obs.provenance.observed_at, NOW.toISOString());
      assert.ok(obs.provenance.freshness_status);
    }

    const alpha = snapshot.attention.find((a) => a.entity_ref?.id === "acc-needs-1");
    assert.ok(alpha);
    assert.equal(alpha.provenance.confidence, 0.8);

    const inbound = snapshot.attention.find((a) => a.entity_ref?.id === "inbound-new-1");
    assert.ok(inbound);
    assert.equal(inbound.provenance.confidence, 0.9);
  });

  it("converts deal values to integer cents + currency and does not replica the pipeline", () => {
    const snapshot = collectFromWarmblyPayload(loadFixture("commercial-runtime.json"), { now: NOW });
    assert.ok(snapshot.deal_value_open);
    assert.equal(Number.isInteger(snapshot.deal_value_open.amount_cents), true);
    assert.equal(snapshot.deal_value_open.currency, "BRL");
    assert.equal(snapshot.deal_value_open.amount_cents, Math.round(1500.5 * 100) + Math.round(2000 * 100));

    assert.equal("deals" in snapshot, false);
    assert.equal("pipelines" in snapshot, false);
    assert.equal("tasks" in snapshot, false);
    assert.equal("contacts" in snapshot, false);
    assert.equal("stages" in snapshot, false);
    assert.ok(!JSON.stringify(snapshot.attention).includes("Qualificação"));
  });

  it("derives commercial attention from mixed fixtures without owning the pipeline", () => {
    const snapshot = collectFromWarmblyPayload(loadFixture("commercial-runtime.json"), { now: NOW });
    assert.ok(snapshot.attention.length > 0);

    const ids = snapshot.attention.map((a) => a.id);
    assert.ok(ids.includes("warmbly:task:task-overdue-1:overdue_task"));
    assert.ok(ids.includes("warmbly:task:task-next-1:next_action"));
    assert.ok(ids.includes("warmbly:deal:deal-stalled-1:stalled_deal"));
    assert.ok(ids.includes("warmbly:campaign:camp-tripped-1:campaign_signal"));
    assert.ok(ids.includes("warmbly:unibox:unread:inbox_signal"));
    assert.ok(ids.includes("warmbly:unibox:awaiting_reply:inbox_signal"));
    assert.ok(ids.includes("warmbly:account:acc-needs-1:confenge_attention"));
    assert.ok(ids.includes("warmbly:inbound_lead:inbound-new-1:inbound_lead"));

    assert.ok(!ids.some((id) => id.includes("task-done-1")));
    assert.ok(!ids.some((id) => id.includes("deal-healthy-1")));
    assert.ok(!ids.some((id) => id.includes("deal-won-1")));
    assert.ok(!ids.some((id) => id.includes("camp-active-1")));
    assert.ok(!ids.some((id) => id.includes("inbound-done-1")));

    const overdue = snapshot.attention.find((a) => a.id.includes("task-overdue-1"));
    assert.ok(overdue);
    assert.match(overdue.title, /Gama/);
    assert.equal(overdue.kind, "overdue_task");
  });

  it("is idempotent: second collect of the same fixtures keeps stable ids and no duplicate attention rows", () => {
    const payload = loadFixture("commercial-runtime.json");
    const a = collectFromWarmblyPayload(payload, { now: NOW });
    const b = collectFromWarmblyPayload(payload, { now: NOW });
    assert.deepEqual(attentionSlice(a), attentionSlice(b));
    const idSet = new Set(a.attention.map((row) => row.id));
    assert.equal(idSet.size, a.attention.length);
  });

  it("fail-closes a missing Confenge endpoint with required_upstream_contract and UNKNOWN/ERROR freshness", () => {
    const snapshot = collectFromWarmblyPayload(loadFixture("missing-endpoint.json"), { now: NOW });
    const gap = snapshot.observations.find((o) => o.http_path === "/v1/confenge/attention");
    assert.ok(gap);
    assert.ok(gap.provenance.freshness_status === "UNKNOWN" || gap.provenance.freshness_status === "ERROR");
    const contract = snapshot.required_upstream_contract.find((c) => c.path === "/v1/confenge/attention");
    assert.ok(contract);
    assert.equal(contract.method, "GET");
    assert.ok(contract.min_request.path);
    assert.ok(contract.min_response.body);
    assert.ok(snapshot.attention.some((a) => a.id.includes("task-overdue-1")));
    assert.equal(snapshot.attention.some((a) => a.kind === "confenge_attention"), false);
  });
});

describe("collect() against a local Warmbly-shaped stub", () => {
  it("returns the same non-empty attention slice on two runs", async () => {
    const payload = loadFixture("commercial-runtime.json");
    const token = "wmbly_collect_stub_token";
    const stub = await startFixtureStub({ payload, token });
    try {
      const client = () =>
        new WarmblyClient({
          baseUrl: stub.url,
          token,
          timeoutMs: 2_000,
          maxRetries: 0,
          logger: () => undefined,
        });
      const run1 = await collect({ client: client(), now: NOW });
      const run2 = await collect({ client: client(), now: NOW });
      assert.equal(run1.schema, COMMERCIAL_SNAPSHOT_SCHEMA);
      assert.ok(run1.attention.length > 0);
      assert.deepEqual(attentionSlice(run1), attentionSlice(run2));
      assert.equal(
        stub.calls.some((c) => c.method === "PATCH" || c.method === "PUT" || c.method === "DELETE"),
        false,
      );
    } finally {
      await stub.close();
    }
  });
});
