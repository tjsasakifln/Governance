import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchWarmblyPayload } from "../src/collector/fetch.ts";
import { normalizeIntelEnvelope } from "../src/collector/envelope.ts";
import { WarmblyClient } from "../src/http/client.ts";
import { collect } from "../src/collect.ts";
import { projectCollector } from "../../runner/src/projectors/project.ts";

const SCOREBOARD = {
  schema_version: "confenge.inbound_truth_scoreboard.v1",
  stages: [{ id: "lead_persisted", label: "Lead persistido", status: "TRUE", numerator: 1, denominator: 2 }],
  include_synthetic: false,
  production_path: "live",
};

const EXECUTIVE = {
  schema_version: "confenge.executive_intel.v1",
  month: "2026-08",
  qco: 3,
  inbound_qualified_pipeline: 1,
};

const REPORT = {
  schema_version: "confenge.observability_report.v1",
  month: "2026-08",
  include_synthetic: false,
  real_empty: false,
  controlled_email: [],
};

const EXCEPTIONS = [
  { id: "ex-intel-1", code: "orphan_chain", reason: "lead without deal", next_action: "review", status: "open" },
];

const ORGANIC = {
  schema_version: "confenge.organic_scoreboard.v1",
  generated_at: "2026-08-21T12:00:00.000Z",
  include_synthetic: false,
  real_empty: false,
  windows: [
    {
      id: "28d",
      by_source: [
        {
          organic_source: "organic_search",
          layers: [{ id: "LEAD_VALID", status: "UNKNOWN", count: 0, denominator: 0, observation: "no ingest" }],
        },
      ],
    },
  ],
  sources: ["organic_search"],
  recommendation: "NEED_MORE_DATA",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "API-Version": "v1" },
  });
}

function clientFor(bodies: Record<string, { status: number; json: unknown }>): WarmblyClient {
  return new WarmblyClient({
    baseUrl: "http://warmbly.test",
    token: "wmbly_test_token",
    timeoutMs: 2_000,
    maxRetries: 0,
    logger: () => undefined,
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
      const path = new URL(url).pathname;
      const hit = bodies[path];
      if (!hit) return jsonResponse(404, { error: "not found", path });
      return jsonResponse(hit.status, hit.json);
    },
  });
}

describe("normalizeIntelEnvelope (shipped rule)", () => {
  it("unwraps scoreboard/executive/report/exceptions/organic wrapped in data", () => {
    assert.deepEqual(normalizeIntelEnvelope({ data: SCOREBOARD }, "intel_scoreboard"), {
      ok: true,
      value: SCOREBOARD,
    });
    assert.deepEqual(normalizeIntelEnvelope({ data: EXECUTIVE }, "intel_executive"), {
      ok: true,
      value: EXECUTIVE,
    });
    assert.deepEqual(normalizeIntelEnvelope({ data: REPORT }, "intel_report"), {
      ok: true,
      value: REPORT,
    });
    assert.deepEqual(normalizeIntelEnvelope({ data: EXCEPTIONS }, "intel_exceptions"), {
      ok: true,
      value: EXCEPTIONS,
    });
    assert.deepEqual(normalizeIntelEnvelope({ data: ORGANIC }, "intel_organic_scoreboard"), {
      ok: true,
      value: ORGANIC,
    });
  });

  it("preserves a raw scoreboard that already is the payload", () => {
    const raw = normalizeIntelEnvelope(SCOREBOARD, "intel_scoreboard");
    assert.equal(raw.ok, true);
    if (raw.ok) assert.equal(raw.value, SCOREBOARD);
  });

  it("rejects {data:null} and unrelated objects as CONTRACT_DRIFT", () => {
    const nulled = normalizeIntelEnvelope({ data: null }, "intel_scoreboard");
    assert.equal(nulled.ok, false);
    if (!nulled.ok) assert.equal(nulled.code, "CONTRACT_DRIFT");
    const unrelated = normalizeIntelEnvelope({ foo: 1, bar: "x" }, "intel_scoreboard");
    assert.equal(unrelated.ok, false);
    if (!unrelated.ok) assert.equal(unrelated.code, "CONTRACT_DRIFT");
  });

  it("rejects synthetic or unproven intel reports instead of publishing them as real", () => {
    for (const includeSynthetic of [true, undefined]) {
      const candidate = { ...REPORT, include_synthetic: includeSynthetic };
      const result = normalizeIntelEnvelope({ data: candidate }, "intel_report");
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "CONTRACT_DRIFT");
        assert.match(result.reason, /include_synthetic=false/);
      }
    }
    const contradictory = normalizeIntelEnvelope(
      { ...REPORT, real_empty: true, controlled_email: [{ cohort_id: "not-empty" }] },
      "intel_report",
    );
    assert.equal(contradictory.ok, false);
    if (!contradictory.ok) assert.match(contradictory.reason, /real_empty/);
  });
});

describe("fetchWarmblyPayload assignment path", () => {
  it("assigns inner intel objects from Warmbly {data} envelopes", async () => {
    const { payload } = await fetchWarmblyPayload(
      clientFor({
        "/health": { status: 200, json: { status: "ok" } },
        "/v1/confenge/intel/scoreboard": { status: 200, json: { data: SCOREBOARD } },
        "/v1/confenge/intel/executive": { status: 200, json: { data: EXECUTIVE } },
        "/v1/confenge/intel/report": { status: 200, json: { data: REPORT } },
        "/v1/confenge/intel/exceptions": { status: 200, json: { data: EXCEPTIONS } },
        "/v1/confenge/intel/organic-scoreboard": { status: 200, json: { data: ORGANIC } },
      }),
    );
    assert.deepEqual(payload.confenge_intel_scoreboard, SCOREBOARD);
    assert.deepEqual(payload.confenge_intel_executive, EXECUTIVE);
    assert.deepEqual(payload.confenge_intel_report, REPORT);
    assert.deepEqual(payload.confenge_intel_exceptions, EXCEPTIONS);
    assert.deepEqual(payload.confenge_intel_organic_scoreboard, ORGANIC);
    assert.equal(
      (payload.unavailable ?? []).some((row) => row.path.includes("/intel/")),
      false,
    );
  });

  it("records CONTRACT_DRIFT for {data:null} and unrelated objects and never stores a wrapper", async () => {
    const { payload } = await fetchWarmblyPayload(
      clientFor({
        "/health": { status: 200, json: { status: "ok" } },
        "/v1/confenge/intel/scoreboard": { status: 200, json: { data: null } },
        "/v1/confenge/intel/executive": { status: 200, json: { hello: "world" } },
      }),
    );
    assert.equal(payload.confenge_intel_scoreboard, undefined);
    assert.equal(payload.confenge_intel_executive, undefined);
    const drifts = (payload.unavailable ?? []).filter((row) => row.reason.startsWith("CONTRACT_DRIFT"));
    assert.equal(drifts.length >= 2, true);
    assert.equal(
      JSON.stringify(payload).includes('"data":null'),
      false,
    );
  });

  it("keeps HTTP 404 as a gap and never fakes empty intel data", async () => {
    const { payload } = await fetchWarmblyPayload(
      clientFor({
        "/health": { status: 200, json: { status: "ok" } },
      }),
    );
    assert.equal(payload.confenge_intel_scoreboard, undefined);
    assert.equal(payload.confenge_intel_exceptions, undefined);
    const gap = (payload.unavailable ?? []).find((row) => row.path === "/v1/confenge/intel/scoreboard");
    assert.ok(gap);
    assert.equal(gap.status, 404);
    const snapshot = await collect({
      client: clientFor({ "/health": { status: 200, json: { status: "ok" } } }),
      now: new Date("2026-08-21T12:00:00.000Z"),
    });
    assert.equal(snapshot.operations?.intel_scoreboard ?? null, null);
    const projected = projectCollector({
      collector: "warmbly",
      freshness_status: "FRESH",
      observed_at: "2026-08-21T12:00:00.000Z",
      source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
      confidence: 0.5,
      payload: snapshot,
    });
    const commercial = projected.find((row) => row.snapshot_kind === "commercial");
    assert.ok(commercial);
    const inbound = (commercial.payload.operations as { cohorts: { inbound_truth: { configured: boolean } } })
      .cohorts.inbound_truth;
    assert.equal(inbound.configured, false);
  });
});
