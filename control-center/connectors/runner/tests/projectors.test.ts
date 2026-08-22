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
  assert.equal(rows[0]?.identity_basis, "account_key");
  assert.equal(rows[0]?.derived_from_deal_count, 2);
  // A won deal makes the company an active client even though a sibling deal is open.
  assert.equal(rows[0]?.lifecycle, "active");
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
