import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import {
  PNCP_HEALTHY_LABEL,
  evaluatePncpFreshness,
} from "../src/index.js";
import { fixturePath } from "./helpers.js";

describe("configurable metrics sources (API, DB view, health artifact)", () => {
  test("http_api live-shaped payload classifies via shipped parser", async () => {
    const raw = await readFile(fixturePath("pipeline-vivo.json"), "utf8");
    const payload: unknown = JSON.parse(raw);
    const result = await evaluatePncpFreshness({
      kind: "http_api",
      httpUrl: "https://metrics.example.invalid/pncp",
      fetchImpl: async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    assert.equal(result.snapshot.source_kind, "http_api");
    assert.equal(result.serviceHealth.freshness_status, "FRESH");
    assert.equal(result.serviceHealth.healthy, true);
    assert.ok(result.sourceObservation.observed_at);
  });

  test("http_api 401 is credential ERROR, never FRESH", async () => {
    const result = await evaluatePncpFreshness({
      kind: "http_api",
      httpUrl: "https://metrics.example.invalid/pncp",
      now: new Date("2026-08-20T12:00:00.000Z"),
      fetchImpl: async () => new Response("nope", { status: 401 }),
    });
    assert.equal(result.serviceHealth.freshness_status, "ERROR");
    assert.ok(result.classification.reasons.includes("credential_unavailable"));
    assert.equal(result.serviceHealth.healthy, false);
    assert.notEqual(result.serviceHealth.label, PNCP_HEALTHY_LABEL);
  });

  test("http_api unreachable is ERROR, never FRESH", async () => {
    const result = await evaluatePncpFreshness({
      kind: "http_api",
      httpUrl: "https://metrics.example.invalid/pncp",
      now: new Date("2026-08-20T12:00:00.000Z"),
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });
    assert.equal(result.serviceHealth.freshness_status, "ERROR");
    assert.ok(result.classification.reasons.includes("metrics_source_unreachable"));
    assert.equal(result.serviceHealth.healthy, false);
  });

  test("db_view row uses extra-cli column aliases", async () => {
    const result = await evaluatePncpFreshness({
      kind: "db_view",
      now: new Date("2026-08-20T12:00:00.000Z"),
      dbRow: {
        source: "pncp",
        last_success_at: "2026-08-20T11:40:00.000Z",
        last_ingested_at: "2026-08-20T11:30:00.000Z",
        latest_business_date: "2026-08-20T11:45:00.000Z",
        recent_records: 64,
        consecutive_errors: 0,
        collector_heartbeat_at: "2026-08-20T11:55:00.000Z",
        credential_status: "available",
      },
    });
    assert.equal(result.snapshot.source_kind, "db_view");
    assert.equal(result.serviceHealth.freshness_status, "FRESH");
    assert.equal(result.snapshot.last_item_observed_at, "2026-08-20T11:30:00.000Z");
    assert.equal(result.snapshot.source_max_timestamp, "2026-08-20T11:45:00.000Z");
    assert.equal(result.snapshot.recent_window_count, 64);
  });

  test("db_view query callback fail-closes when it throws", async () => {
    const result = await evaluatePncpFreshness({
      kind: "db_view",
      now: new Date("2026-08-20T12:00:00.000Z"),
      queryView: async () => {
        throw new Error("dsn missing");
      },
    });
    assert.equal(result.serviceHealth.freshness_status, "ERROR");
    assert.equal(result.serviceHealth.healthy, false);
    assert.ok(result.classification.reasons.includes("metrics_unreadable"));
  });
});
