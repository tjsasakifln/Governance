import assert from "node:assert/strict";
import { test } from "node:test";
import { availabilityFromEnvelope } from "../src/projectors/availability.ts";
import { projectCollector } from "../src/projectors/project.ts";
import { CONFENGE_OPERATIONAL_REPOS } from "../src/projectors/types.ts";

const now = "2026-08-21T12:00:00.000Z";

test("missing secret stays BLOCKED_BY_SECRET and never FRESH", () => {
  const envelope = {
    collector: "warmbly",
    freshness_status: "UNKNOWN" as const,
    observed_at: now,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0,
    error: { code: "BLOCKED_BY_SECRET", message: "token missing" },
    payload: { ok: false },
  };
  assert.equal(availabilityFromEnvelope(envelope), "BLOCKED_BY_SECRET");
  const [commercial] = projectCollector(envelope);
  assert.ok(commercial);
  assert.equal(commercial.availability, "BLOCKED_BY_SECRET");
  assert.notEqual(commercial.freshness_status, "FRESH");
  assert.equal(commercial.snapshot_kind, "commercial");
});

test("Warmbly counts project to commercial snapshot with labeled acquisition cohorts", () => {
  const projected = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: now,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0.8,
    payload: {
      counts: { deals_open: 2, deals_stalled: 1, tasks_overdue: 3, inbox_unread: 4, inbound_now: 1 },
      deal_value_open: { amount_cents: 150050, currency: "BRL" },
      attention: [{ id: "ex-1", kind: "overdue_task", title: "Overdue", why: "task due" }],
      operations: {
        deals: [
          {
            id: "deal-1",
            name: "Acme",
            status: "open",
            created_at: "2026-08-20T00:00:00.000Z",
            updated_at: "2026-08-20T00:00:00.000Z",
          },
        ],
        contacts: [{ id: "c-1", company: "Acme", created_at: "2026-08-20T00:00:00.000Z" }],
        intel_scoreboard: { schema: "confenge.inbound_truth_scoreboard.v1", stages: [] },
      },
      confenge_status: { auto_send_enabled: false },
    },
  });
  const commercial = projected.find((row) => row.snapshot_kind === "commercial");
  assert.ok(commercial);
  assert.equal(commercial.availability, "FRESH");
  const funnel = commercial.payload.funnel as { opportunities?: number; new_leads?: number };
  assert.equal(funnel.opportunities, 2);
  assert.equal(funnel.new_leads, 1);
  assert.equal("qualified" in funnel, false);
  const ops = commercial.payload.operations as {
    auto_send: { enabled: boolean };
    cohorts: { mixing_rule: string; acquisition: Array<{ window: string; population: number; reply_rate: { numerator: number; denominator: number } }> };
  };
  assert.equal(ops.auto_send.enabled, false);
  assert.match(ops.cohorts.mixing_rule, /labeled_separately/);
  assert.deepEqual(
    ops.cohorts.acquisition.map((row) => row.window),
    ["7d", "28d", "90d", "open"],
  );
  const rate = ops.cohorts.acquisition[0]?.reply_rate;
  assert.equal(typeof rate?.numerator, "number");
  assert.equal(typeof rate?.denominator, "number");
  const clients = projected.find((row) => row.snapshot_kind === "clients");
  assert.ok(clients);
});

test("finance projector keeps paid distinct from effectively_received", () => {
  const [finance] = projectCollector({
    collector: "asaas",
    freshness_status: "FRESH",
    observed_at: now,
    source: { system: "asaas", kind: "collector-runner", locator: "asaas" },
    confidence: 0.7,
    payload: {
      buckets: {
        contracted: { cents: 1000, currency: "BRL" },
        billed: { cents: 800, currency: "BRL" },
        paid: { cents: 500, currency: "BRL" },
        received: { cents: 200, currency: "BRL" },
      },
    },
  });
  assert.ok(finance);
  assert.equal((finance.payload.paid as { amount_cents: number }).amount_cents, 500);
  assert.equal((finance.payload.effectively_received as { amount_cents: number }).amount_cents, 200);
  assert.notEqual(finance.payload.paid, finance.payload.effectively_received);
});

test("engineering projector emits company plus repo snapshots from allowlist", () => {
  const rows = projectCollector({
    collector: "github",
    freshness_status: "FRESH",
    observed_at: now,
    source: { system: "github", kind: "collector-runner", locator: "github" },
    confidence: 0.6,
    payload: {
      snapshot: {
        allowlist: [...CONFENGE_OPERATIONAL_REPOS],
        repos: [
          {
            repo: { full_name: "tjsasakifln/warmbly", default_branch: "main" },
            open_pull_requests: [{ number: 104, title: "x", draft: false }],
            check_failures: [{ name: "ci" }],
            workflow_failures: [],
          },
        ],
      },
    },
  });
  assert.ok(rows.some((row) => row.scope === "company"));
  assert.ok(rows.some((row) => row.scope === "repo:tjsasakifln/warmbly"));
  const company = rows.find((row) => row.scope === "company");
  assert.equal((company?.payload.failing_check_count as number) > 0, true);
});

test("reply_rate denominator is contacted count and is never substituted with population", () => {
  const projected = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: now,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0.8,
    payload: {
      counts: { deals_open: 0, inbound_now: 0 },
      operations: {
        contacts: [
          { id: "c-1", company: "Only population", created_at: "2026-08-20T00:00:00.000Z" },
          {
            id: "c-2",
            company: "Contacted silent",
            created_at: "2026-08-20T00:00:00.000Z",
            last_activity_at: "2026-08-20T01:00:00.000Z",
          },
          {
            id: "c-3",
            company: "Replied",
            created_at: "2026-08-20T00:00:00.000Z",
            last_activity_at: "2026-08-20T01:00:00.000Z",
            campaign_lead: { status: "replied" },
          },
        ],
      },
    },
  });
  const commercial = projected.find((row) => row.snapshot_kind === "commercial");
  assert.ok(commercial);
  const ops = commercial.payload.operations as {
    cohorts: {
      acquisition: Array<{
        window: string;
        population: number;
        contacted: number;
        reply_rate: { numerator: number; denominator: number; ratio: number | null };
        qualified_reply_rate: { denominator: number };
      }>;
    };
  };
  const open = ops.cohorts.acquisition.find((row) => row.window === "open");
  assert.ok(open);
  assert.equal(open.population, 3);
  assert.equal(open.contacted, 2);
  assert.equal(open.reply_rate.numerator, 1);
  assert.equal(open.reply_rate.denominator, 2);
  assert.equal(open.qualified_reply_rate.denominator, 2);
  assert.notEqual(open.reply_rate.denominator, open.population);
});

test("empty collector payload is NO_DATA not a healthy zero funnel", () => {
  const [commercial] = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: now,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0.5,
    payload: { counts: {} },
  });
  assert.ok(commercial);
  assert.equal(commercial.availability, "NO_DATA");
  assert.equal(commercial.payload.funnel, undefined);
});
