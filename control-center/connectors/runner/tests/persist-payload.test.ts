import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertSanitizedJson,
  MAX_JSON_BYTES,
} from "@confenge/control-center-persistence";
import { fitPersistPayload, PERSIST_ARRAY_CAP } from "../src/persist-payload.ts";
import { projectCollector } from "../src/projectors/project.ts";

const observedAt = "2026-08-23T01:43:27.187Z";

test("small payloads pass through without truncation metadata", () => {
  const fitted = fitPersistPayload({
    counts: { deals_open: 1 },
    email: "founder@example.com",
    nested: { phone: "+5511999999999", company: "Acme" },
  });
  assert.equal("email" in fitted, false);
  assert.equal("phone" in (fitted.nested as Record<string, unknown>), false);
  assert.equal((fitted.nested as { company: string }).company, "Acme");
  assert.equal("_persist_truncation" in fitted, false);
  assertSanitizedJson(fitted, "small");
});

test("controlled outbound aggregate survives the real projection and persistence boundary", () => {
  const [commercial] = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: observedAt,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0.9,
    payload: {
      confenge_status: {
        readiness: {
          latest_bounded_cohort: {
            cohort_id: "cohort-real-10",
            cohort_hash: "sha256:cohort",
            policy_version: "controlled-email.v1",
            authorized_quantity: 10,
            sent: 0,
            max_daily_volume: 10,
          },
        },
      },
      confenge_intel_report: {
        controlled_email: [{
          cohort_id: "cohort-real-10",
          route_class: "DIRECT_PERSON",
          provider: "smtp",
          attempted: 1,
          delivered: null,
        }],
      },
    },
  });
  assert.ok(commercial);

  const fitted = fitPersistPayload(commercial.payload);
  const operations = fitted.operations as Record<string, unknown>;
  const aggregate = operations.controlled_outbound as {
    current: { sent: number; outcomes: { delivered: number | null } };
  };
  assert.ok(aggregate, "the aggregate must not be removed as address-bearing PII");
  assert.equal(aggregate.current.sent, 0);
  assert.equal(aggregate.current.outcomes.delivered, null);
  assertSanitizedJson(fitted, "controlled-outbound");
});

test("oversized intel exception lists are capped under the persist byte limit", () => {
  const exceptions = Array.from({ length: 500 }, (_, i) => ({
    id: `ex-${i}`,
    code: "orphan_chain",
    reason: "lead without deal ".repeat(40),
    next_action: "review pipeline and owner",
    status: "open",
    identity: { kind: "lead", id: `lead-${i}` },
    allowed_actions: ["ack", "snooze", "assign"],
  }));
  const today = {
    summary: { inferred_emails: ["a@example.com"], note: "x".repeat(40_000) },
    actions: Array.from({ length: 300 }, (_, i) => ({
      id: `act-${i}`,
      title: "follow up ".repeat(50),
    })),
    lanes: { a: "y".repeat(80_000) },
  };
  const raw = {
    operations: { intel_exceptions: exceptions, intel_organic_scoreboard: { windows: ["z".repeat(1_000)] } },
    confenge_today: today,
    email: "leak@example.com",
  };
  const original = JSON.stringify(raw).length;
  assert.ok(original > MAX_JSON_BYTES, `fixture must exceed persist limit, got ${original}`);

  const fitted = fitPersistPayload(raw);
  const bytes = JSON.stringify(fitted).length;
  assert.ok(bytes <= MAX_JSON_BYTES, `fitted payload is ${bytes} bytes`);
  assert.equal("email" in fitted, false);
  const truncation = fitted._persist_truncation as {
    reason: string;
    original_bytes: number;
    arrays_capped: boolean;
    array_cap: number;
  };
  assert.ok(truncation);
  assert.equal(truncation.reason, "payload_exceeds_persist_limit");
  assert.equal(truncation.array_cap, PERSIST_ARRAY_CAP);
  assert.equal(truncation.arrays_capped, true);
  const ops = fitted.operations as { intel_exceptions: unknown[] };
  assert.ok(Array.isArray(ops.intel_exceptions));
  assert.ok(ops.intel_exceptions.length <= PERSIST_ARRAY_CAP);
  assertSanitizedJson(fitted, "fitted");
});
