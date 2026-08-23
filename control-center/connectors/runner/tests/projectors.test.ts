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

test("real Warmbly mapping selects controlled-email telemetry by cohort and policy", () => {
  const normalized = collectFromWarmblyPayload({
    counts: { deals_open: 0, inbound_now: 0 },
    confenge_status: {
      readiness: {
        latest_bounded_cohort: {
          authorization_id: "auth-10",
          cohort_id: "cohort-real-10",
          cohort_hash: "sha256:cohort",
          policy_version: "controlled-email.v2",
          allowed_route_classes: ["DIRECT_PERSON"],
          route_class_distribution: { DIRECT_PERSON: 1 },
          authorized_quantity: 10,
          sent: 0,
          reserved: 0,
          max_daily_volume: 10,
          state: "active",
          authorized_at: "2026-08-21T10:00:00.000Z",
          expires_at: "2026-08-22T10:00:00.000Z",
        },
      },
    },
    confenge_intel_report: {
      schema_version: "confenge.inbound_learning_report.v1",
      month: "2026-08",
      include_synthetic: false,
      real_empty: false,
      controlled_email: [
        {
          cohort_id: "cohort-real-10",
          policy_version: "controlled-email.v1",
          route_class: "DIRECT_PERSON",
          provider: "smtp",
          attempted: 9,
          provider_accepted: 9,
          delivered: 9,
          hard_bounce: 0,
        },
        {
          cohort_id: "cohort-real-10",
          policy_version: "controlled-email.v2",
          route_class: "DIRECT_PERSON",
          provider: "smtp",
          attempted: 1,
          provider_accepted: 1,
          delivered: null,
          hard_bounce: 0,
        },
      ],
    },
  }, { now: new Date(now) });
  assert.equal("confenge_status" in normalized, false, "the mapper must not need a test-only top-level injection");
  const projected = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: now,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0.9,
    payload: normalized,
  });
  const commercial = projected.find((row) => row.snapshot_kind === "commercial");
  assert.ok(commercial);
  const controlled = (commercial.payload.operations as Record<string, unknown>).controlled_outbound as {
    current: { sent: number; max_daily_volume: number; outcomes: Record<string, number | null> };
    report_month: string | null;
    rows: Array<{ cohort_id: string; policy_version: string; provider_accepted: number }>;
  };
  assert.equal(controlled.current.sent, 0, "an observed reservation-ledger zero must survive");
  assert.equal(controlled.current.max_daily_volume, 10);
  assert.equal(controlled.current.outcomes.provider_accepted, 1);
  assert.equal(controlled.current.outcomes.delivered, null, "SMTP accepted must not become delivery");
  assert.equal(controlled.current.outcomes.hard_bounce, 0, "an observed zero must survive");
  assert.equal(controlled.report_month, "2026-08");
  assert.deepEqual(
    controlled.rows.map((row) => [row.cohort_id, row.policy_version, row.provider_accepted]),
    [["cohort-real-10", "controlled-email.v2", 1]],
    "telemetry from another policy revision must not reach the current cohort view",
  );
});

test("controlled-email aggregation fails closed without a proven policy version", () => {
  const normalized = collectFromWarmblyPayload({
    confenge_status: {
      readiness: {
        latest_bounded_cohort: {
          cohort_id: "cohort-ambiguous",
          sent: 0,
        },
      },
    },
    confenge_intel_report: {
      schema_version: "confenge.inbound_learning_report.v1",
      include_synthetic: false,
      real_empty: false,
      controlled_email: [
        {
          cohort_id: "cohort-ambiguous",
          policy_version: "controlled-email.v1",
          route_class: "DIRECT_PERSON",
          provider_accepted: 9,
        },
        {
          cohort_id: "cohort-ambiguous",
          policy_version: "controlled-email.v2",
          route_class: "DIRECT_PERSON",
          provider_accepted: 1,
        },
      ],
    },
  }, { now: new Date(now) });
  const projected = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: now,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0.9,
    payload: normalized,
  });
  const commercial = projected.find((row) => row.snapshot_kind === "commercial");
  assert.ok(commercial);
  const controlled = (commercial.payload.operations as Record<string, unknown>).controlled_outbound as {
    current: { policy_version: string | null; outcomes: Record<string, number | null> };
    rows: unknown[];
  };
  assert.equal(controlled.current.policy_version, null);
  assert.equal(controlled.current.outcomes.provider_accepted, null);
  assert.deepEqual(controlled.rows, []);
});

test("synthetic or unproven reports never publish real controlled-email outcomes", () => {
  for (const includeSynthetic of [true, undefined]) {
    const normalized = collectFromWarmblyPayload({
      confenge_status: {
        readiness: {
          latest_bounded_cohort: {
            cohort_id: "cohort-real-10",
            policy_version: "controlled-email.v2",
            sent: 0,
          },
        },
      },
      confenge_intel_report: {
        schema_version: "confenge.inbound_learning_report.v1",
        include_synthetic: includeSynthetic,
        real_empty: false,
        controlled_email: [{
          cohort_id: "cohort-real-10",
          policy_version: "controlled-email.v2",
          route_class: "DIRECT_PERSON",
          provider_accepted: 99,
        }],
      },
    }, { now: new Date(now) });
    const projected = projectCollector({
      collector: "warmbly",
      freshness_status: "FRESH",
      observed_at: now,
      source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
      confidence: 0.9,
      payload: normalized,
    });
    const commercial = projected.find((row) => row.snapshot_kind === "commercial");
    assert.ok(commercial);
    const controlled = (commercial.payload.operations as Record<string, unknown>).controlled_outbound as {
      availability: string;
      current: { outcomes: Record<string, number | null> };
      rows: unknown[];
    };
    assert.equal(controlled.availability, "UNKNOWN");
    assert.equal(controlled.current.outcomes.provider_accepted, null);
    assert.deepEqual(controlled.rows, []);
  }
});

test("controlled-email grant integrity flags expose unsafe observed states without inventing recovery", () => {
  const normalized = collectFromWarmblyPayload({
    confenge_status: {
      readiness: {
        latest_bounded_cohort: {
          cohort_id: "cohort-integrity",
          policy_version: "controlled-email.v1",
          authorized_quantity: 10,
          sent: 8,
          reserved: 3,
          max_daily_volume: 11,
          state: "revoked",
          expires_at: "2026-08-20T00:00:00.000Z",
        },
      },
    },
    confenge_intel_report: {
      schema_version: "confenge.inbound_learning_report.v1",
      include_synthetic: false,
      real_empty: true,
      controlled_email: [],
    },
  }, { now: new Date(now) });
  const projected = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: now,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0.9,
    payload: normalized,
  });
  const commercial = projected.find((row) => row.snapshot_kind === "commercial");
  assert.ok(commercial);
  const controlled = (commercial.payload.operations as Record<string, unknown>).controlled_outbound as {
    current: { integrity_flags: string[] };
  };
  assert.deepEqual(controlled.current.integrity_flags, [
    "grant_revoked",
    "grant_expired",
    "authorized_quantity_exceeded",
    "daily_cap_unexpected",
  ]);
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

test("equivalent exceptions group without losing occurrence evidence or workflow state", () => {
  const projected = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: now,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0.9,
    payload: {
      counts: { deals_open: 0, inbound_now: 0 },
      attention: [
        { id: "att-duplicate", group_key: "owner-gap:acme", kind: "missing_owner", why: "sem owner", status: "acknowledged", resolution_url: "https://attacker.example/phish" },
      ],
      operations: {
        intel_exceptions: [
          { id: "intel-original", group_key: "owner-gap:acme", code: "missing_owner", reason: "sem owner", status: "acknowledged" },
        ],
      },
    },
  });
  const commercial = projected.find((row) => row.snapshot_kind === "commercial");
  assert.ok(commercial);
  const ops = commercial.payload.operations as {
    exceptions: Array<Record<string, unknown>>;
  };
  assert.equal(ops.exceptions.length, 1);
  assert.equal(ops.exceptions[0]?.occurrence_count, 2);
  assert.deepEqual(ops.exceptions[0]?.occurrence_ids, ["intel-original", "att-duplicate"]);
  assert.equal(ops.exceptions[0]?.workflow_state, "acknowledged");
  assert.equal(ops.exceptions[0]?.resolution_kind, "unsupported");
  assert.equal(ops.exceptions[0]?.resolution_href, undefined);
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

test("deals without a usable identity never become client:unknown", () => {
  const projected = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: now,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0.8,
    payload: {
      counts: { deals_open: 4, inbound_now: 0 },
      operations: {
        deals: [
          // the only identifiable record: it is linked to an account
          { id: "deal-1", name: "Diagnóstico — Acme", account_id: "acct-77", company: "Acme Indústria", status: "open", created_at: now, updated_at: now },
          // no id and no account at all
          { status: "open", created_at: now, updated_at: now },
          // an account key that sanitizes to nothing
          { id: "deal-2", account_id: "###", company: "Acme Indústria", status: "open", created_at: now, updated_at: now },
          // an account key that is literally the placeholder token
          { id: "deal-3", account_id: "unknown", company: "unknown", status: "open", created_at: now, updated_at: now },
        ],
      },
    },
  });
  const clients = projected.find((row) => row.snapshot_kind === "clients");
  assert.ok(clients);
  const rows = clients.payload.clients as Array<Record<string, unknown>>;
  assert.deepEqual(
    rows.map((row) => row.scope),
    ["client:acct-77"],
  );
  assert.equal(
    rows.some((row) => String(row.scope).includes("unknown")),
    false,
  );
  assert.equal(clients.payload.client_count, 1);
});

test("identity-less records land in the data-quality queue with origin, reason and action", () => {
  const projected = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: now,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0.8,
    payload: {
      counts: { deals_open: 2, inbound_now: 0 },
      operations: {
        deals: [
          { status: "open", created_at: now, updated_at: now },
          { id: "deal-9", account_id: "unknown", company: "unknown", status: "open", created_at: now, updated_at: now },
        ],
      },
    },
  });
  const clients = projected.find((row) => row.snapshot_kind === "clients");
  assert.ok(clients);
  const dq = clients.payload.data_quality as {
    queue: string;
    origin: string;
    unidentified_record_count: number;
    required_action: string;
    counts_as_client: boolean;
    raises_client_risk: boolean;
    entries: Array<Record<string, unknown>>;
  };
  assert.equal(dq.queue, "client_identity");
  assert.equal(dq.unidentified_record_count, 2);
  assert.equal(dq.counts_as_client, false);
  assert.equal(dq.raises_client_risk, false);
  assert.ok(dq.required_action.length > 0);
  assert.equal(dq.entries.length, 2);
  for (const entry of dq.entries) {
    assert.equal(entry.kind, "client_identity_missing");
    assert.equal(entry.status, "open");
    assert.equal(entry.source, "warmbly.commercial.pipeline");
    assert.ok(String(entry.why).length > 0);
    assert.ok(Array.isArray(entry.reason_codes) && entry.reason_codes.length > 0);
    // Per reason code, not one sentence repeated: the operator fixes a missing
    // account link differently from a placeholder name.
    assert.ok(String(entry.recommended_next_action).length > 0);
    assert.notEqual(entry.recommended_next_action, "");
    const origin = entry.origin as { system: string; locator: string };
    assert.equal(origin.system, "warmbly");
    assert.ok(origin.locator.length > 0);
  }
  assert.deepEqual((dq.entries[0]?.reason_codes as string[]) ?? [], ["missing_client_key", "missing_display_name"]);
  assert.deepEqual(
    (dq.entries[1]?.reason_codes as string[]) ?? [],
    ["reserved_placeholder_slug", "placeholder_display_name"],
  );
  // Different reasons get different corrections.
  assert.notEqual(dq.entries[0]?.recommended_next_action, dq.entries[1]?.recommended_next_action);
});

test("the identity queue is kept out of the client counts the risk engine reads", () => {
  const projected = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: now,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0.8,
    payload: {
      counts: { deals_open: 3, inbound_now: 0 },
      operations: {
        deals: [
          { id: "d1", name: "Diagnóstico — Beta", account_id: null, status: "open", updated_at: now },
          { id: "###", name: "Diagnóstico — Gama", status: "open", updated_at: now },
          { id: "unknown", name: "unknown", status: "open", updated_at: now },
        ],
        intel_exceptions: [{ id: "x1", why: "a" }, { id: "x2", why: "b" }],
      },
    },
  });
  const clients = projected.find((row) => row.snapshot_kind === "clients");
  assert.ok(clients);
  assert.deepEqual(clients.payload.clients, []);
  assert.equal(clients.payload.client_count, 0);
  assert.equal(clients.payload.at_risk_client_count, 0);
  assert.equal(clients.payload.unidentified_record_count, 3);
  // The commercial exception count stays what it is and is NOT folded into any
  // client count. Whether it may raise a client alert is the risk engine's
  // decision and is asserted end-to-end in tests/convergence/domain-gates.test.ts.
  assert.equal(clients.payload.open_blocker_count, 2);
});

test("two different deals for one company are one client, keyed on the account", () => {
  const projected = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: now,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0.8,
    payload: {
      counts: { deals_open: 2, inbound_now: 0 },
      operations: {
        deals: [
          { id: "deal-1", name: "Diagnóstico — Acme", account_id: "acct-77", company: "Acme Indústria", status: "open", updated_at: now },
          { id: "deal-2", name: "Expansão — Acme", account_id: "acct-77", company: "Acme Indústria", status: "won", updated_at: now },
        ],
      },
    },
  });
  const clients = projected.find((row) => row.snapshot_kind === "clients");
  assert.ok(clients);
  const rows = clients.payload.clients as Array<Record<string, unknown>>;
  assert.equal(rows.length, 1, "two deals for one company are one client");
  assert.equal(rows[0]?.client_slug, "acct-77");
  assert.equal(rows[0]?.scope, "client:acct-77");
  assert.equal(rows[0]?.display_name, "Acme Indústria");
  // A won deal makes the company an active client even though a sibling deal is open.
  assert.equal(rows[0]?.lifecycle, "active");
  // v1 ClientStatus is frozen (additionalProperties:false), so the published row
  // carries no new field; how the identity was resolved is recorded on the
  // snapshot's data_quality block instead.
  assert.equal("identity_basis" in (rows[0] ?? {}), false);
  assert.equal("derived_from_deal_count" in (rows[0] ?? {}), false);
  const dq = clients.payload.data_quality as {
    identity_bases: string[];
    resolved_identities: Array<{ client_slug: string; identity_basis: string; derived_from_deal_count: number }>;
  };
  assert.deepEqual(dq.resolved_identities, [
    { client_slug: "acct-77", identity_basis: "account_key", derived_from_deal_count: 2 },
  ]);
  assert.ok(dq.identity_bases.includes("account_key"));
  assert.equal(dq.identity_bases.some((basis) => /deal/i.test(basis)), false);
});

test("a deal id is never published as a client identity", () => {
  const projected = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: now,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0.8,
    payload: {
      counts: { deals_open: 2, inbound_now: 0 },
      operations: {
        // The shape Warmbly actually ships today: a deal id, a deal name, and
        // account_id still null. There is no client here, only a deal.
        deals: [
          { id: "deal-healthy-1", name: "Diagnóstico — Construtora Beta", account_id: null, status: "open", updated_at: now },
          { id: "deal-stalled-1", name: "Diagnóstico — Escritório Gama", account_id: null, status: "open", updated_at: now },
        ],
      },
    },
  });
  const clients = projected.find((row) => row.snapshot_kind === "clients");
  assert.ok(clients);
  const rows = clients.payload.clients as Array<Record<string, unknown>>;
  assert.deepEqual(rows, [], "a deal key is not a client key");
  const dq = clients.payload.data_quality as { entries: Array<Record<string, unknown>> };
  assert.equal(dq.entries.length, 2);
  assert.deepEqual(dq.entries[0]?.reason_codes, ["missing_client_key", "missing_display_name"]);
  // The queue points at the deal that needs linking, by its real source id.
  assert.equal(dq.entries[0]?.source_id, "deal-healthy-1");
  assert.match(String(dq.entries[0]?.recommended_next_action), /conta\/empresa/);
});

test("commercial pipeline reports a null identity instead of the string unknown", () => {
  const [commercial] = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: now,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0.8,
    payload: {
      counts: { deals_open: 2, inbound_now: 0 },
      operations: {
        deals: [
          { id: "deal-1", name: "Acme", status: "open", created_at: now, updated_at: now },
          { status: "open", created_at: now, updated_at: now },
        ],
      },
    },
  });
  assert.ok(commercial);
  const ops = commercial.payload.operations as { pipeline: Array<Record<string, unknown>> };
  const [identified, unidentified] = ops.pipeline;
  assert.equal(identified?.source_id, "deal-1");
  assert.equal(identified?.canonical_id, "cc:commercial-deal:deal-1");
  assert.equal(identified?.identity_status, "identified");
  assert.equal(unidentified?.id, null);
  assert.equal(unidentified?.source_id, null);
  assert.equal(unidentified?.canonical_id, null);
  assert.equal(unidentified?.display_name, null);
  assert.equal(unidentified?.identity_status, "unidentified");
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
  assert.deepEqual(
    split.map((m) => [m.currency, m.amount_cents]),
    [
      ["BRL", 10_000],
      ["USD", 5_000],
    ],
  );
  assert.equal(body.pipeline_nominal, undefined);
});

test("commercial projector denominates each deal by its own currency, not by BRL", () => {
  // Warmbly sends `value` as a bare major-unit number with `currency` beside
  // it. Reading only the number stamped every card BRL, so a USD deal and a
  // deal the total had refused to denominate both rendered "BRL 100,00".
  const snapshot = collectFromWarmblyPayload(
    {
      health: { status: "ok" },
      api_version: "v1",
      deals: [
        { id: "brl", name: "BRL", status: "open", value: 100, currency: "BRL", created_at: now, updated_at: now },
        { id: "usd", name: "USD", status: "open", value: 50, currency: "USD", created_at: now, updated_at: now },
        { id: "bad", name: "Bad", status: "open", value: 100, currency: "R$", created_at: now, updated_at: now },
        { id: "none", name: "None", status: "open", value: 25, created_at: now, updated_at: now },
      ],
    } as never,
    { now: new Date(now) },
  );
  const projected = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: now,
    source: CURRENCY_SOURCE,
    confidence: 0.8,
    payload: snapshot as unknown as Record<string, unknown>,
  });
  const commercial = projected.find((row) => row.snapshot_kind === "commercial");
  assert.ok(commercial);
  const ops = commercial.payload.operations as {
    pipeline: Array<{ id: string; value?: { amount_cents: number; currency: string } }>;
  };
  const byId = new Map(ops.pipeline.map((row) => [row.id, row]));
  assert.deepEqual(byId.get("brl")?.value, { amount_cents: 10_000, currency: "BRL" });
  assert.deepEqual(byId.get("usd")?.value, { amount_cents: 5_000, currency: "USD" });
  // Unreadable code: withheld rather than stamped with the catalog currency.
  assert.equal(byId.get("bad")?.value, undefined);
  // No code stated at all: the contractual catalog currency.
  assert.deepEqual(byId.get("none")?.value, { amount_cents: 2_500, currency: "BRL" });
});

test("a readable total is not destroyed by an unreadable sibling currency", () => {
  // The split filters down to one entry; that entry is a real denominated
  // total and must be promoted, not discarded as "not a split".
  const body = commercialPayload({
    deal_value_open_by_currency: [
      { amount_cents: 10_000, currency: "BRL" },
      { amount_cents: 5_000, currency: "reais" },
    ],
  });
  assert.deepEqual(body.pipeline_nominal, {
    amount_cents: 10_000,
    currency: "BRL",
    source: CURRENCY_SOURCE,
    observed_at: now,
    freshness_status: "FRESH",
    confidence: 0.8,
  });
  assert.equal(body.pipeline_nominal_by_currency, undefined);
});

test("a zero bucket keeps its siblings: the currency had a denominated contributor", () => {
  const body = commercialPayload({
    deal_value_open_by_currency: [
      { amount_cents: 10_000, currency: "BRL" },
      { amount_cents: 0, currency: "USD" },
    ],
  });
  const zeroSplit = body.pipeline_nominal_by_currency as Array<{ amount_cents: number; currency: string }>;
  assert.deepEqual(
    zeroSplit.map((m) => [m.currency, m.amount_cents]),
    [
      ["BRL", 10_000],
      ["USD", 0],
    ],
  );
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

function infraEnvelope(payload: unknown, overrides: Partial<{
  freshness_status: "FRESH" | "STALE" | "UNKNOWN" | "ERROR";
  confidence: number;
  error: { code: string; message: string };
}> = {}) {
  return {
    collector: "infra",
    freshness_status: overrides.freshness_status ?? ("FRESH" as const),
    observed_at: now,
    source: { system: "infra", kind: "collector-runner", locator: "infra" },
    confidence: overrides.confidence ?? 0.9,
    ...(overrides.error ? { error: overrides.error } : {}),
    payload,
  };
}

function infraServices(snapshot: { payload: Record<string, unknown> }): Record<string, unknown>[] {
  const services = snapshot.payload.services;
  assert.ok(Array.isArray(services));
  return services as Record<string, unknown>[];
}

test("infrastructure services keep the collector's identity, function and endpoint", () => {
  const [infra] = projectCollector(
    infraEnvelope({
      service_health: [
        {
          service_id: "netcup-vps-tcp",
          display_name: "Netcup VPS TCP",
          role: "Host Netcup: alcance TCP da porta 443",
          endpoint: "159.195.18.88:443",
          source: "infrastructure",
          observed_at: now,
          freshness_status: "FRESH",
          status: "healthy",
          confidence: 0.9,
          latency_ms: 11,
          checks: [{ check: "reachability", status: "healthy", summary: "host reachable" }],
        },
        {
          service_id: "confenge-api-http",
          display_name: "Confenge API inbound health",
          role: "Endpoint de health do inbound",
          endpoint: "https://api.confenge.com.br/health",
          source: "infrastructure",
          observed_at: now,
          freshness_status: "FRESH",
          status: "unhealthy",
          confidence: 0.9,
          latency_ms: 30,
          last_error: "http: HTTP 503",
          runbook_url: "/runbooks/confenge-api-http",
          checks: [{ check: "http", status: "unhealthy", summary: "HTTP 503" }],
        },
      ],
    }),
  );
  assert.ok(infra);
  const services = infraServices(infra);
  assert.equal(services.length, 2);
  const names = services.map((row) => row.service_name);
  assert.deepEqual(names, ["Netcup VPS TCP", "Confenge API inbound health"]);
  assert.equal(new Set(services.map((row) => row.id)).size, 2);
  for (const row of services) {
    assert.notEqual(String(row.role), "");
    assert.notEqual(String(row.endpoint), "");
    assert.equal(row.catalog_error, undefined);
    const provenance = row.provenance as { freshness_status: string; confidence: number };
    assert.equal(provenance.freshness_status, "FRESH");
    assert.equal(provenance.confidence, 0.9);
  }
  const [, broken] = services;
  assert.ok(broken);
  // The collector says "unhealthy"; the contract and the cockpit say "down".
  assert.equal(broken.status, "down");
  assert.equal(broken.last_error, "http: HTTP 503");
  assert.equal(broken.runbook_url, "/runbooks/confenge-api-http");
  assert.deepEqual(broken.http, { status: "down", detail: "HTTP 503" });
  assert.equal(infra.payload.catalog_error_count, 0);
  assert.equal(infra.payload.monitored_service_count, 2);
});

test("infrastructure summary keeps the worst state regardless of service order", () => {
  const service = (id: string, status: string) => ({
    service_id: id,
    display_name: id,
    source: "infrastructure",
    observed_at: now,
    freshness_status: "FRESH",
    status,
    confidence: 0.9,
    checks: [],
  });
  const [infra] = projectCollector(
    infraEnvelope({
      service_health: [service("first-degraded", "degraded"), service("later-down", "unhealthy")],
    }),
  );
  assert.ok(infra);
  assert.equal(infra.payload.status, "down");
});

test("identical catalog entries collapse into one card and keep the worst state", () => {
  const row = {
    service_id: "cfg-health",
    display_name: "cfg-health HTTP",
    role: "Painel de configuração",
    endpoint: "http://127.0.0.1:18081/health",
    source: "infrastructure",
    observed_at: now,
    freshness_status: "FRESH",
    confidence: 0.9,
    checks: [],
  };
  const [infra] = projectCollector(
    infraEnvelope({
      service_health: [
        { ...row, status: "healthy" },
        { ...row, status: "degraded" },
      ],
    }),
  );
  assert.ok(infra);
  const services = infraServices(infra);
  assert.equal(services.length, 1);
  assert.equal(services[0]?.duplicate_count, 2);
  assert.equal(services[0]?.status, "degraded");
  assert.equal(infra.payload.duplicate_group_count, 1);
  assert.equal(infra.payload.partial_outage, false);
  assert.equal(infra.payload.status, "degraded");
});

test("duplicate services retain independent checks and the worst freshness timestamp", () => {
  const newer = "2026-02-23T12:10:00.000Z";
  const older = "2026-02-23T11:00:00.000Z";
  const common = {
    service_id: "cfg-health",
    display_name: "cfg-health",
    source: "infrastructure",
    confidence: 0.9,
  };
  const [infra] = projectCollector(
    infraEnvelope({
      service_health: [
        {
          ...common,
          observed_at: newer,
          freshness_status: "FRESH",
          status: "healthy",
          checks: [{ check: "http", status: "healthy", summary: "HTTP 200" }],
        },
        {
          ...common,
          observed_at: older,
          freshness_status: "STALE",
          status: "degraded",
          checks: [{ check: "tls", status: "degraded", summary: "certificate aging" }],
        },
      ],
    }),
  );
  assert.ok(infra);
  const [service] = infraServices(infra);
  assert.ok(service);
  assert.deepEqual(service.checks, [
    { name: "http", status: "healthy", detail: "HTTP 200" },
    { name: "tls", status: "degraded", detail: "certificate aging" },
  ]);
  assert.deepEqual(service.http, { status: "healthy", detail: "HTTP 200" });
  assert.deepEqual(service.tls, { status: "degraded", detail: "certificate aging" });
  assert.equal(service.freshness_status, "STALE");
  assert.equal(service.observed_at, older);
  assert.equal(service.checked_at, older);
  assert.equal((service.provenance as Record<string, unknown>).observed_at, older);
});

test("an unknown service beside a healthy one is inconclusive, not a partial outage", () => {
  const service = (id: string, status: string) => ({
    service_id: id,
    display_name: id,
    source: "infrastructure",
    observed_at: now,
    freshness_status: status === "unknown" ? "UNKNOWN" : "FRESH",
    status,
    confidence: status === "unknown" ? 0 : 0.9,
    checks: [],
  });
  const [infra] = projectCollector(
    infraEnvelope({ service_health: [service("healthy", "healthy"), service("unknown", "unknown")] }),
  );
  assert.ok(infra);
  assert.equal(infra.payload.partial_outage, false);
  assert.equal(infra.payload.status, "unknown");
});

test("a service with no identity is flagged as a catalog error, not named 'service'", () => {
  const [infra] = projectCollector(
    infraEnvelope({
      service_health: [{ status: "healthy", freshness_status: "FRESH", checks: [] }],
    }),
  );
  assert.ok(infra);
  const services = infraServices(infra);
  assert.equal(services.length, 1);
  assert.equal(services[0]?.catalog_error, "missing_service_identity");
  assert.notEqual(services[0]?.service_name, "service");
  assert.equal(services[0]?.service_id, null);
  assert.equal(infra.payload.catalog_error_count, 1);
});

test("an unconfigured infra collector names the reason instead of scoring like a failure", () => {
  const [infra] = projectCollector(
    infraEnvelope(
      { ok: false, availability: "NOT_CONFIGURED" },
      {
        freshness_status: "UNKNOWN",
        confidence: 0,
        error: { code: "NOT_CONFIGURED", message: "CC_INFRA_ALLOWLIST is not configured" },
      },
    ),
  );
  assert.ok(infra);
  assert.equal(infra.availability, "NOT_CONFIGURED");
  assert.equal(infra.payload.unavailability_reason, "NOT_CONFIGURED");
  assert.notEqual(infra.payload.status, "healthy");
  assert.deepEqual(infra.payload.services, []);
});

test("a runbook link that is not same-origin or credential-free is dropped", () => {
  const base = {
    service_id: "x",
    display_name: "X",
    source: "infrastructure",
    observed_at: now,
    freshness_status: "FRESH",
    status: "degraded",
    confidence: 0.9,
    checks: [],
  };
  for (const unsafe of [
    "javascript:alert(1)",
    "//evil.invalid/runbook",
    "https://user:pass@example.invalid/runbook",
    "/run book",
  ]) {
    const [infra] = projectCollector(
      infraEnvelope({ service_health: [{ ...base, runbook_url: unsafe }] }),
    );
    assert.ok(infra);
    assert.equal(infraServices(infra)[0]?.runbook_url, undefined, unsafe);
  }
});

test("two catalog ids that slug alike stay two services and are flagged, never merged", () => {
  // cfg-health and cfg.health are both legal target ids (allowlist TARGET_ID
  // permits "." and "_"). Keying the group on a slug merged them and deleted a
  // monitored dependency from the cockpit and from the count.
  const row = (id: string, status: string, endpoint: string) => ({
    service_id: id,
    display_name: id,
    role: "Painel de configuração",
    endpoint,
    source: "infrastructure",
    observed_at: now,
    freshness_status: "FRESH",
    status,
    confidence: 0.9,
    checks: [],
  });
  const [infra] = projectCollector(
    infraEnvelope({
      service_health: [
        row("cfg-health", "healthy", "http://127.0.0.1:18081/health"),
        row("cfg.health", "unhealthy", "https://other.example/h"),
      ],
    }),
  );
  assert.ok(infra);
  const services = infraServices(infra);
  assert.equal(services.length, 2);
  assert.equal(infra.payload.monitored_service_count, 2);
  assert.equal(infra.payload.duplicate_group_count, 0);
  assert.equal(new Set(services.map((r) => r.id)).size, 2, "ambiguous ids must still be distinct");
  assert.deepEqual(
    services.map((r) => r.service_id),
    ["cfg-health", "cfg.health"],
  );
  assert.deepEqual(
    services.map((r) => r.endpoint),
    ["http://127.0.0.1:18081/health", "https://other.example/h"],
  );
  for (const service of services) {
    assert.equal(service.catalog_error, "ambiguous_service_id");
    assert.equal(service.duplicate_count, undefined);
  }
  assert.equal(infra.payload.catalog_error_count, 2);
});

test("merging duplicates rolls up each dimension and keeps the evidence of both", () => {
  const base = {
    service_id: "cfg-health",
    display_name: "cfg-health HTTP",
    source: "infrastructure",
    observed_at: now,
    confidence: 0.9,
  };
  const [infra] = projectCollector(
    infraEnvelope({
      service_health: [
        {
          ...base,
          status: "unhealthy",
          freshness_status: "FRESH",
          last_error: "http: HTTP 503",
          latency_ms: 30,
          checks: [{ check: "http", status: "unhealthy", summary: "HTTP 503" }],
        },
        { ...base, status: "healthy", freshness_status: "STALE", confidence: 0.4, checks: [] },
      ],
    }),
  );
  assert.ok(infra);
  const services = infraServices(infra);
  assert.equal(services.length, 1);
  const merged = services[0];
  assert.ok(merged);
  assert.equal(merged.duplicate_count, 2);
  // Worst per dimension, independently: the down state and the STALE recency
  // both survive, and so does the 503 that a whole-row swap used to discard.
  assert.equal(merged.status, "down");
  assert.equal(merged.freshness_status, "STALE");
  assert.equal(merged.confidence, 0.4);
  assert.equal(merged.latency_ms, 30);
  assert.equal(merged.last_error, "http: HTTP 503");
  assert.deepEqual(merged.http, { status: "down", detail: "HTTP 503" });
});

test("two nameless rows are two catalog defects, not one card with a shared id", () => {
  const [infra] = projectCollector(
    infraEnvelope({
      service_health: [
        { status: "healthy", freshness_status: "FRESH", checks: [] },
        { status: "unhealthy", freshness_status: "FRESH", checks: [] },
      ],
    }),
  );
  assert.ok(infra);
  const services = infraServices(infra);
  assert.equal(services.length, 2);
  assert.equal(new Set(services.map((r) => r.id)).size, 2);
  for (const service of services) {
    assert.equal(service.catalog_error, "missing_service_identity");
  }
  assert.equal(infra.payload.catalog_error_count, 2);
});

test("a failed probe names its reason even though the collector itself ran fine", () => {
  // The common case: collect() returned, no throw, but the first-sorted
  // observation is ERROR. Without a reason the operator sees confidence 0 and
  // cannot tell this from a collector that was never configured.
  const [infra] = projectCollector(
    infraEnvelope(
      {
        service_health: [
          {
            service_id: "confenge-api-http",
            display_name: "Confenge API inbound health",
            source: "infrastructure",
            observed_at: now,
            freshness_status: "ERROR",
            status: "unhealthy",
            confidence: 0,
            checks: [],
          },
        ],
      },
      { freshness_status: "ERROR", confidence: 0 },
    ),
  );
  assert.ok(infra);
  assert.equal(infra.availability, "UPSTREAM_ERROR");
  assert.equal(infra.payload.unavailability_reason, "UPSTREAM_ERROR");
});

test("a runbook URL with a secret-looking query key is refused by the projector too", () => {
  const base = {
    service_id: "x",
    display_name: "X",
    source: "infrastructure",
    observed_at: now,
    freshness_status: "FRESH",
    status: "degraded",
    confidence: 0.9,
    checks: [],
  };
  for (const unsafe of [
    "https://runbooks.example/infra?api_key=abc",
    "https://runbooks.example/infra?x=1&token=abc",
    "/runbooks/infra?password=hunter2",
  ]) {
    const [infra] = projectCollector(
      infraEnvelope({ service_health: [{ ...base, runbook_url: unsafe }] }),
    );
    assert.ok(infra);
    assert.equal(infraServices(infra)[0]?.runbook_url, undefined, unsafe);
  }
  const [ok] = projectCollector(
    infraEnvelope({
      service_health: [{ ...base, runbook_url: "https://runbooks.example/infra?service=api" }],
    }),
  );
  assert.ok(ok);
  assert.equal(infraServices(ok)[0]?.runbook_url, "https://runbooks.example/infra?service=api");
});

test("a malformed percent-escape in a runbook URL drops the link instead of crashing the projector", () => {
  // parseAllowlist's path branch does no decoding, so this value reaches the
  // projector through shipped config. A bare decodeURIComponent here threw
  // URIError past projectCollector and past runSource's try/finally, and the
  // whole infra snapshot went unpersisted for that run.
  const base = {
    service_id: "confenge-api-http",
    display_name: "Confenge API inbound health",
    source: "infrastructure",
    observed_at: now,
    freshness_status: "FRESH",
    status: "degraded",
    confidence: 0.9,
    checks: [],
  };
  for (const malformed of ["/runbooks/infra?%ZZ=1", "/runbooks/infra?a=1&%E0%A4%A=2", "%ZZ"]) {
    let projected: ReturnType<typeof projectCollector> | undefined;
    assert.doesNotThrow(() => {
      projected = projectCollector(infraEnvelope({ service_health: [{ ...base, runbook_url: malformed }] }));
    }, malformed);
    const infra = projected?.[0];
    assert.ok(infra, malformed);
    assert.equal(infraServices(infra)[0]?.runbook_url, undefined, malformed);
    // The card itself still ships: a bad link must not cost the snapshot.
    assert.equal(infraServices(infra)[0]?.service_name, "Confenge API inbound health");
  }
});

test("a query key wearing brackets or encoding is still a secret", () => {
  const base = {
    service_id: "x",
    display_name: "X",
    source: "infrastructure",
    observed_at: now,
    freshness_status: "FRESH",
    status: "degraded",
    confidence: 0.9,
    checks: [],
  };
  for (const unsafe of [
    "/runbooks/infra?token[]=abc",
    "/runbooks/infra?token%5B%5D=abc",
    "https://runbooks.example/i?token[]=abc",
    "https://runbooks.example/i?identity=abc",
    "https://runbooks.example/i?x-api-key=abc",
  ]) {
    const [infra] = projectCollector(infraEnvelope({ service_health: [{ ...base, runbook_url: unsafe }] }));
    assert.ok(infra);
    assert.equal(infraServices(infra)[0]?.runbook_url, undefined, unsafe);
  }
});

test("two byte-identical nameless rows stay two catalog defects", () => {
  // The discriminating case for keying anonymous rows on their index: under the
  // old JSON.stringify key these two collapse into one card and a monitored
  // entry disappears behind duplicate_count.
  const row = { status: "healthy", freshness_status: "FRESH", confidence: 0.9, checks: [] };
  const [infra] = projectCollector(infraEnvelope({ service_health: [{ ...row }, { ...row }] }));
  assert.ok(infra);
  const services = infraServices(infra);
  assert.equal(services.length, 2);
  assert.equal(infra.payload.monitored_service_count, 2);
  assert.equal(infra.payload.duplicate_group_count, 0);
  assert.equal(new Set(services.map((r) => r.id)).size, 2);
  for (const service of services) {
    assert.equal(service.duplicate_count, undefined);
    assert.equal(service.catalog_error, "missing_service_identity");
  }
  assert.equal(infra.payload.catalog_error_count, 2);
});

test("the surviving latency carries the check that measured it", () => {
  const base = {
    service_id: "netcup-vps-1",
    display_name: "Netcup VPS",
    source: "infrastructure",
    observed_at: now,
    freshness_status: "FRESH",
    status: "healthy",
    confidence: 0.9,
    checks: [],
  };
  const [infra] = projectCollector(
    infraEnvelope({
      service_health: [
        { ...base, latency_ms: 9, latency_check: "http" },
        { ...base, latency_ms: 120, latency_check: "reachability" },
      ],
    }),
  );
  assert.ok(infra);
  const merged = infraServices(infra)[0];
  assert.ok(merged);
  assert.equal(merged.duplicate_count, 2);
  assert.equal(merged.latency_ms, 120);
  // Not "http" — that was the base row's check, for a number it did not measure.
  assert.equal(merged.latency_check, "reachability");
});
