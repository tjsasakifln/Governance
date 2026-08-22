import assert from "node:assert/strict";
import { test } from "node:test";
import { collectFromWarmblyPayload } from "../../warmbly/src/mapper/normalize.ts";
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

test("intel exceptions above LIST_CAP stay capped and keep an honest total", () => {
  const intelExceptions = Array.from({ length: 60 }, (_, i) => ({
    id: `ex-intel-${i}`,
    code: "orphan_chain",
    reason: `lead without deal ${i}`,
    next_action: "review",
    status: "open",
  }));
  const projected = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: now,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0.8,
    payload: {
      counts: { deals_open: 1, inbound_now: 0 },
      operations: { intel_exceptions: intelExceptions },
    },
  });
  const commercial = projected.find((row) => row.snapshot_kind === "commercial");
  assert.ok(commercial);
  const ops = commercial.payload.operations as {
    overview: { exceptions: number; exceptions_shown: number };
    exceptions: unknown[];
    intel: { exceptions: unknown[]; exceptions_total: number; exceptions_capped: boolean };
  };
  assert.equal(ops.overview.exceptions, 60);
  assert.equal(ops.overview.exceptions_shown, 50);
  assert.equal(ops.exceptions.length, 50);
  assert.equal(ops.intel.exceptions.length, 50);
  assert.equal(ops.intel.exceptions_total, 60);
  assert.equal(ops.intel.exceptions_capped, true);
  const serialized = JSON.stringify(commercial.payload);
  assert.ok(serialized.length < 512 * 1024, `commercial snapshot is ${serialized.length} bytes`);
});

test("mapper-capped intel_exceptions keep the declared upstream total", () => {
  const intelExceptions = Array.from({ length: 50 }, (_, i) => ({
    id: `ex-intel-${i}`,
    code: "orphan_chain",
    reason: `lead without deal ${i}`,
    next_action: "review",
    status: "open",
  }));
  const projected = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: now,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0.8,
    payload: {
      counts: { deals_open: 1, inbound_now: 0 },
      operations: {
        cap: 50,
        intel_exceptions: intelExceptions,
        intel_exceptions_total: 362,
      },
    },
  });
  const commercial = projected.find((row) => row.snapshot_kind === "commercial");
  assert.ok(commercial);
  const ops = commercial.payload.operations as {
    overview: { exceptions: number; exceptions_shown: number };
    exceptions: unknown[];
    intel: { exceptions: unknown[]; exceptions_total: number; exceptions_capped: boolean };
  };
  assert.equal(ops.intel.exceptions.length, 50);
  assert.equal(ops.intel.exceptions_total, 362);
  assert.equal(ops.intel.exceptions_capped, true);
  assert.equal(ops.overview.exceptions, 362);
  assert.equal(ops.overview.exceptions_shown, 50);
  assert.equal(ops.exceptions.length, 50);
});

test("shipped mapper cap then projector preserves intel_exceptions_total", () => {
  const exceptions = Array.from({ length: 62 }, (_, i) => ({
    id: `ex-${i}`,
    organization_id: "org",
    code: "orphan_chain",
    reason: "lead without deal",
    next_action: "review",
    status: "open",
  }));
  const snapshot = collectFromWarmblyPayload(
    {
      health: { status: "ok" },
      pipelines: [],
      deals: { data: [] },
      tasks: { data: [] },
      contacts: { data: [] },
      confenge_intel_exceptions: exceptions,
    },
    { now: new Date(now) },
  );
  assert.equal(snapshot.operations?.intel_exceptions_total, 62);
  assert.equal(Array.isArray(snapshot.operations?.intel_exceptions) && snapshot.operations.intel_exceptions.length, 50);
  const projected = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: now,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0.8,
    payload: snapshot,
  });
  const commercial = projected.find((row) => row.snapshot_kind === "commercial");
  assert.ok(commercial);
  const ops = commercial.payload.operations as {
    overview: { exceptions: number; exceptions_shown: number };
    intel: { exceptions: unknown[]; exceptions_total: number; exceptions_capped: boolean };
  };
  assert.equal(ops.intel.exceptions.length, 50);
  assert.equal(ops.intel.exceptions_total, 62);
  assert.equal(ops.intel.exceptions_capped, true);
  assert.equal(ops.overview.exceptions, 62);
  assert.equal(ops.overview.exceptions_shown, 50);
});

test("intel exceptions feed Commercial Exceptions and organic scoreboard feeds Crescimento", () => {
  const projected = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: now,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0.8,
    payload: {
      counts: { deals_open: 1, inbound_now: 0 },
      attention: [{ id: "att-1", kind: "overdue_task", title: "legacy attention", why: "task due" }],
      operations: {
        intel_exceptions: [
          { id: "ex-intel-1", code: "orphan_chain", reason: "lead without deal", next_action: "review", status: "open" },
        ],
        intel_scoreboard: {
          schema_version: "confenge.inbound_truth_scoreboard.v1",
          stages: [{ id: "lead_persisted", status: "TRUE" }],
        },
        intel_organic_scoreboard: {
          schema_version: "confenge.organic_scoreboard.v1",
          windows: [
            {
              id: "28d",
              by_source: [{ layers: [{ id: "LEAD_VALID", status: "UNKNOWN", count: 0, denominator: 0 }] }],
            },
          ],
          sources: ["organic_search"],
        },
      },
    },
  });
  const commercial = projected.find((row) => row.snapshot_kind === "commercial");
  assert.ok(commercial);
  const ops = commercial.payload.operations as {
    exceptions: Array<{ id: string; source: string; why: string }>;
    growth: { organic_scoreboard: { configured: boolean; windows: unknown[] }; scoreboard: { configured: boolean } };
  };
  assert.equal(ops.exceptions.some((row) => row.id === "ex-intel-1"), true);
  assert.equal(ops.exceptions.some((row) => row.id === "att-1"), true);
  const intel = ops.exceptions.find((row) => row.id === "ex-intel-1");
  assert.equal(intel?.source, "warmbly.intel.exceptions");
  assert.match(intel?.why ?? "", /lead without deal/);
  assert.equal(ops.growth.organic_scoreboard.configured, true);
  assert.equal(Array.isArray(ops.growth.organic_scoreboard.windows), true);
  assert.equal(ops.growth.scoreboard.configured, true);
});

test("absent intel sources stay NO_DATA and a data wrapper is never configured", () => {
  const projected = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: now,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0.5,
    payload: {
      counts: { deals_open: 0, inbound_now: 0 },
      operations: {
        intel_scoreboard: { data: { schema_version: "confenge.inbound_truth_scoreboard.v1", stages: [{ id: "x" }] } },
      },
    },
  });
  const commercial = projected.find((row) => row.snapshot_kind === "commercial");
  assert.ok(commercial);
  const ops = commercial.payload.operations as {
    cohorts: { inbound_truth: { configured: boolean; availability: string } };
    growth: { organic_scoreboard: { configured: boolean; availability: string } };
  };
  assert.equal(ops.cohorts.inbound_truth.configured, false);
  assert.equal(ops.cohorts.inbound_truth.availability, "NO_DATA");
  assert.equal(ops.growth.organic_scoreboard.configured, false);
  assert.equal(ops.growth.organic_scoreboard.availability, "NO_DATA");
});

test("acquisition cohort excludes unrelated same-window deals and does not fake conversion without a join", () => {
  const projected = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: now,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0.8,
    payload: {
      counts: { deals_open: 2, inbound_now: 0 },
      operations: {
        contacts: [{ id: "c-member", company: "Member Co", created_at: "2026-08-20T00:00:00.000Z" }],
        deals: [
          {
            id: "deal-linked",
            status: "open",
            contact_id: "c-member",
            created_at: "2026-08-20T02:00:00.000Z",
          },
          {
            id: "deal-unrelated",
            status: "open",
            contact_id: "c-other",
            created_at: "2026-08-20T03:00:00.000Z",
          },
          {
            id: "deal-linked-dup",
            status: "open",
            contact_id: "c-member",
            created_at: "2026-08-20T04:00:00.000Z",
          },
          {
            id: "deal-linked",
            status: "open",
            contact_id: "c-member",
            created_at: "2026-08-20T05:00:00.000Z",
          },
          {
            id: "win-unrelated",
            status: "won",
            contact_id: "c-stranger",
            created_at: "2026-08-19T00:00:00.000Z",
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
        opportunity_created: number | null;
        won: number | null;
        opportunity_conversion: { ratio: number | null; numerator: number | null; denominator: number; availability?: string; omitted_reason?: string };
        win_conversion: { ratio: number | null; numerator: number | null };
        join: { availability: string };
      }>;
    };
  };
  const open = ops.cohorts.acquisition.find((row) => row.window === "open");
  assert.ok(open);
  assert.equal(open.population, 1);
  assert.equal(open.join.availability, "PROVEN");
  assert.equal(open.opportunity_created, 2);
  assert.equal(open.won, 0);
  assert.equal(open.opportunity_conversion.numerator, 2);
  assert.equal(open.opportunity_conversion.denominator, 1);
  assert.equal(open.opportunity_conversion.ratio, 2);
  assert.equal(open.win_conversion.numerator, 0);
});

test("missing durable join yields JOIN_UNPROVEN null conversion, never a fabricated zero", () => {
  const projected = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: now,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0.8,
    payload: {
      counts: { deals_open: 1, inbound_now: 0 },
      operations: {
        contacts: [{ id: "c-1", company: "No join", created_at: "2026-08-20T00:00:00.000Z" }],
        deals: [{ id: "deal-no-join", status: "open", created_at: "2026-08-20T00:00:00.000Z" }],
      },
    },
  });
  const commercial = projected.find((row) => row.snapshot_kind === "commercial");
  assert.ok(commercial);
  const ops = commercial.payload.operations as {
    cohorts: {
      acquisition: Array<{
        window: string;
        opportunity_created: number | null;
        opportunity_conversion: { ratio: number | null; numerator: number | null; availability?: string; omitted_reason?: string };
        join: { availability: string; reason?: string };
      }>;
    };
  };
  const open = ops.cohorts.acquisition.find((row) => row.window === "open");
  assert.ok(open);
  assert.equal(open.join.availability, "JOIN_UNPROVEN");
  assert.equal(open.join.reason, "durable_contact_to_deal_join_unavailable");
  assert.equal(open.opportunity_conversion.ratio, null);
  assert.equal(open.opportunity_conversion.numerator, null);
  assert.equal(open.opportunity_conversion.availability, "JOIN_UNPROVEN");
  assert.equal(open.opportunity_conversion.omitted_reason, "durable_contact_to_deal_join_unavailable");
  assert.notEqual(open.opportunity_conversion.ratio, 0);
  assert.equal(open.opportunity_created, null);
});

test("clients snapshot labels unavailable sources and does not claim full 360", () => {
  const projected = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: now,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0.8,
    payload: {
      counts: { deals_open: 1, inbound_now: 0 },
      operations: {
        deals: [{ id: "deal-1", name: "Acme", status: "open", created_at: now, updated_at: now }],
      },
    },
  });
  const clients = projected.find((row) => row.snapshot_kind === "clients");
  assert.ok(clients);
  assert.equal(clients.payload.client_360, "partial_warmbly_only");
  assert.equal(clients.payload.identity_resolution, "not_proven");
  const sources = clients.payload.sources as { asaas: string; governance: string };
  assert.equal(sources.asaas, "UNKNOWN");
  assert.equal(sources.governance, "UNKNOWN");
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

const CURRENCY_SOURCE = { system: "warmbly", kind: "collector-runner", locator: "warmbly" };

function commercialPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const projected = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: now,
    source: CURRENCY_SOURCE,
    confidence: 0.8,
    payload: { counts: { deals_open: 0, inbound_now: 0 }, ...payload },
  });
  const commercial = projected.find((row) => row.snapshot_kind === "commercial");
  assert.ok(commercial);
  return commercial.payload;
}

test("commercial projector denominates an undenominated pipeline in the BRL catalog currency", () => {
  const body = commercialPayload({ deal_value_open: { amount_cents: 480_000 } });
  assert.deepEqual(body.pipeline_nominal, {
    amount_cents: 480_000,
    currency: "BRL",
    source: CURRENCY_SOURCE,
    observed_at: now,
    freshness_status: "FRESH",
    confidence: 0.8,
  });
});

test("commercial projector omits a zero pipeline instead of stamping it with a currency", () => {
  // The reported bug: Warmbly's deals_summary reported a zero open value in its
  // own default currency, and the surface printed "Pipeline nominal USD 0,00".
  assert.equal(commercialPayload({ deal_value_open: { amount_cents: 0, currency: "USD" } }).pipeline_nominal, undefined);
  assert.equal(commercialPayload({ deal_value_open: { amount_cents: 0 } }).pipeline_nominal, undefined);
});

test("commercial projector fails closed on a pipeline currency that is not ISO-4217", () => {
  assert.equal(
    commercialPayload({ deal_value_open: { amount_cents: 100, currency: "reais" } }).pipeline_nominal,
    undefined,
  );
});

test("commercial projector forwards per-currency totals without merging them", () => {
  const body = commercialPayload({
    deal_value_open_by_currency: [
      { amount_cents: 10_000, currency: "BRL" },
      { amount_cents: 5_000, currency: "USD" },
    ],
  });
  const split = body.pipeline_nominal_by_currency as Array<{ amount_cents: number; currency: string }>;
  assert.equal(split.length, 2);
  assert.deepEqual(
    split.map((m) => [m.currency, m.amount_cents]),
    [
      ["BRL", 10_000],
      ["USD", 5_000],
    ],
  );
  assert.equal(body.pipeline_nominal, undefined);
});

test("commercial projector keeps a deal value undenominated rather than guessing when the code is unreadable", () => {
  const body = commercialPayload({
    operations: {
      deals: [
        { id: "d1", status: "open", value: { amount_cents: 100, currency: "BRL" }, updated_at: now },
        { id: "d2", status: "open", value: { amount_cents: 100, currency: "reais" }, updated_at: now },
      ],
    },
  });
  const ops = body.operations as { pipeline: Array<Record<string, unknown>> };
  assert.deepEqual(ops.pipeline[0]?.value, { amount_cents: 100, currency: "BRL" });
  assert.equal(ops.pipeline[1]?.value, undefined);
});

test("finance projector fails closed on an unreadable bucket currency and defaults an absent one to BRL", () => {
  const projected = projectCollector({
    collector: "asaas",
    freshness_status: "FRESH",
    observed_at: now,
    source: { system: "asaas", kind: "collector-runner", locator: "asaas" },
    confidence: 0.8,
    payload: {
      contracted: { amount_cents: 5_000_000 },
      billed: { amount_cents: 4_000_000, currency: "reais" },
      paid: { amount_cents: 2_500_000, currency: "brl" },
    },
  });
  const finance = projected.find((row) => row.snapshot_kind === "finance");
  assert.ok(finance);
  assert.deepEqual(finance.payload.contracted, { amount_cents: 5_000_000, currency: "BRL" });
  assert.equal(finance.payload.billed, undefined);
  assert.deepEqual(finance.payload.paid, { amount_cents: 2_500_000, currency: "BRL" });
});
