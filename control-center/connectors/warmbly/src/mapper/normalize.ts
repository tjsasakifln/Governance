import {
  COMMERCIAL_SNAPSHOT_SCHEMA,
  SNAPSHOT_SOURCE,
  type CommercialSnapshot,
  type FreshnessStatus,
  type RequiredUpstreamContract,
  type SourceObservation,
} from "../contracts/snapshot.ts";
import {
  contractForUnavailable,
  LEADS_LIST_CONTRACT,
} from "../contracts/required-upstream.ts";
import {
  unwrapData,
  unwrapList,
  type EndpointFailure,
  type WarmblyDispatchStatus,
  type WarmblyPayload,
  type WarmblyTask,
} from "../contracts/warmbly-payload.ts";
import { COLLECT_ROUTES } from "../collector/routes.ts";
import {
  attentionFromCampaigns,
  attentionFromConfenge,
  attentionFromDeals,
  attentionFromInbound,
  attentionFromTasks,
  attentionFromToday,
  attentionFromUnibox,
  dedupeAttention,
  sortAttention,
  type AttentionContext,
} from "./attention.ts";
import { provenance, rollupFreshness } from "./freshness.ts";
import { majorUnitsToCents, sumOpenDealValue } from "./money.ts";

const OPERATIONS_CAP = 50;

function isRequiredPath(method: string, path: string): boolean {
  const clean = path.split("?")[0] ?? path;
  return COLLECT_ROUTES.some(
    (route) =>
      route.required &&
      route.method === method &&
      (route.path.split("?")[0] ?? route.path) === clean,
  );
}

function unknownList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === "object" && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: unknown[] }).data;
  }
  return [];
}

export type NormalizeOptions = {
  now?: Date;
};

function observation(
  surface: string,
  now: Date,
  freshness: FreshnessStatus,
  extra?: Partial<SourceObservation>,
): SourceObservation {
  return {
    id: `warmbly:obs:${surface}`,
    surface,
    kind: extra?.kind ?? "fetch",
    provenance: provenance(now, freshness, extra?.provenance?.confidence),
    http_method: extra?.http_method,
    http_path: extra?.http_path,
    http_status: extra?.http_status,
    note: extra?.note,
  };
}

function mergeTasks(payload: WarmblyPayload): WarmblyTask[] {
  const byId = new Map<string, WarmblyTask>();
  for (const t of unwrapList(payload.tasks)) {
    byId.set(t.id, t);
  }
  for (const t of unwrapList(payload.tasks_search)) {
    byId.set(t.id, t);
  }
  return [...byId.values()];
}

export function collectFromWarmblyPayload(
  payload: WarmblyPayload,
  opts: NormalizeOptions = {},
): CommercialSnapshot {
  const now = opts.now ?? new Date();
  const observations: SourceObservation[] = [];
  const contracts: RequiredUpstreamContract[] = [];
  const freshnessBySurface: FreshnessStatus[] = [];

  const mark = (
    surface: string,
    present: boolean,
    failure: EndpointFailure | undefined,
    httpPath: string,
    httpMethod: string,
  ): FreshnessStatus => {
    if (failure) {
      const required = isRequiredPath(httpMethod, httpPath);
      const status: FreshnessStatus =
        failure.status === 404 || !required ? "UNKNOWN" : "ERROR";
      freshnessBySurface.push(status);
      observations.push(
        observation(surface, now, status, {
          kind: "gap",
          http_method: failure.method,
          http_path: failure.path,
          http_status: failure.status,
          note: failure.reason,
        }),
      );
      contracts.push(contractForUnavailable(failure.path, failure.method));
      return status;
    }
    if (!present) {
      freshnessBySurface.push("UNKNOWN");
      observations.push(
        observation(surface, now, "UNKNOWN", {
          kind: "gap",
          http_method: httpMethod,
          http_path: httpPath,
          note: `${surface} was not present on this payload`,
        }),
      );
      return "UNKNOWN";
    }
    freshnessBySurface.push("FRESH");
    observations.push(
      observation(surface, now, "FRESH", {
        kind: surface === "health" ? "health" : "fetch",
        http_method: httpMethod,
        http_path: httpPath,
        http_status: 200,
      }),
    );
    return "FRESH";
  };

  const unavailable = new Map(
    (payload.unavailable ?? []).map((u) => [`${u.method.toUpperCase()} ${u.path.split("?")[0]}`, u]),
  );
  const fail = (method: string, path: string): EndpointFailure | undefined =>
    unavailable.get(`${method} ${path}`) ??
    (payload.unavailable ?? []).find((u) => u.path.split("?")[0] === path);

  const healthFresh = mark("health", Boolean(payload.health), fail("GET", "/health"), "/health", "GET");
  mark(
    "pipelines",
    payload.pipelines !== undefined,
    fail("GET", "/v1/crm/pipelines"),
    "/v1/crm/pipelines",
    "GET",
  );
  mark("deals", payload.deals !== undefined, fail("GET", "/v1/crm/deals"), "/v1/crm/deals", "GET");
  mark(
    "deals_summary",
    payload.deals_summary !== undefined,
    fail("POST", "/v1/crm/deals/summary"),
    "/v1/crm/deals/summary",
    "POST",
  );
  mark("tasks", payload.tasks !== undefined, fail("GET", "/v1/crm/tasks"), "/v1/crm/tasks", "GET");
  mark(
    "tasks_search",
    payload.tasks_search !== undefined,
    fail("POST", "/v1/crm/tasks/search"),
    "/v1/crm/tasks/search",
    "POST",
  );
  mark(
    "contacts",
    payload.contacts !== undefined,
    fail("POST", "/v1/contacts/search"),
    "/v1/contacts/search",
    "POST",
  );
  mark(
    "campaigns",
    payload.campaigns !== undefined,
    fail("GET", "/v1/campaigns"),
    "/v1/campaigns",
    "GET",
  );
  mark(
    "campaigns_overview",
    payload.campaigns_overview !== undefined,
    fail("GET", "/v1/campaigns-overview"),
    "/v1/campaigns-overview",
    "GET",
  );
  mark(
    "unibox_overview",
    payload.unibox_overview !== undefined,
    fail("GET", "/v1/unibox/overview"),
    "/v1/unibox/overview",
    "GET",
  );
  mark(
    "confenge_status",
    payload.confenge_status !== undefined,
    fail("GET", "/v1/confenge/status"),
    "/v1/confenge/status",
    "GET",
  );
  const opsFail = fail("GET", "/v1/confenge/ops/health");
  mark("confenge_ops_health", payload.confenge_ops_health !== undefined, opsFail, "/v1/confenge/ops/health", "GET");
  mark(
    "confenge_attention",
    payload.confenge_attention !== undefined,
    fail("GET", "/v1/confenge/attention"),
    "/v1/confenge/attention",
    "GET",
  );
  mark(
    "confenge_today",
    payload.confenge_today !== undefined,
    fail("GET", "/v1/confenge/today"),
    "/v1/confenge/today",
    "GET",
  );
  mark(
    "confenge_inbound",
    payload.confenge_inbound !== undefined,
    fail("GET", "/v1/confenge/inbound"),
    "/v1/confenge/inbound",
    "GET",
  );
  mark(
    "confenge_dispatch_status",
    payload.confenge_dispatch_status !== undefined,
    fail("GET", "/v1/confenge/dispatch/status"),
    "/v1/confenge/dispatch/status",
    "GET",
  );
  mark(
    "confenge_intel_scoreboard",
    payload.confenge_intel_scoreboard !== undefined,
    fail("GET", "/v1/confenge/intel/scoreboard"),
    "/v1/confenge/intel/scoreboard",
    "GET",
  );
  mark(
    "confenge_intel_executive",
    payload.confenge_intel_executive !== undefined,
    fail("GET", "/v1/confenge/intel/executive"),
    "/v1/confenge/intel/executive",
    "GET",
  );
  mark(
    "confenge_intel_exceptions",
    payload.confenge_intel_exceptions !== undefined,
    fail("GET", "/v1/confenge/intel/exceptions"),
    "/v1/confenge/intel/exceptions",
    "GET",
  );
  mark(
    "confenge_intel_organic_scoreboard",
    payload.confenge_intel_organic_scoreboard !== undefined,
    fail("GET", "/v1/confenge/intel/organic-scoreboard"),
    "/v1/confenge/intel/organic-scoreboard",
    "GET",
  );

  // Always record the known GET /leads gap (Warmbly does not expose it).
  observations.push(
    observation("leads", now, "UNKNOWN", {
      kind: "gap",
      http_method: "GET",
      http_path: "/v1/leads",
      note: LEADS_LIST_CONTRACT.reason,
    }),
  );
  contracts.push(LEADS_LIST_CONTRACT);

  const deals = unwrapList(payload.deals);
  const tasks = mergeTasks(payload);
  const contacts = unwrapList(payload.contacts);
  const campaigns = unwrapList(payload.campaigns);
  const pipelines = unwrapList(payload.pipelines);
  const confengeAttention = unwrapList(payload.confenge_attention);
  const inbound = unwrapList(payload.confenge_inbound);
  const today = unwrapData(payload.confenge_today);
  const unibox = payload.unibox_overview;

  const ctx: AttentionContext = { now, freshness: "FRESH" };
  const attention = sortAttention(
    dedupeAttention([
      ...attentionFromTasks(tasks, ctx),
      ...attentionFromDeals(deals, ctx),
      ...attentionFromCampaigns(campaigns, ctx),
      ...attentionFromUnibox(unibox, ctx),
      ...attentionFromConfenge(confengeAttention, ctx),
      ...attentionFromToday(today?.actions ?? [], ctx),
      ...attentionFromInbound(inbound, ctx),
    ]),
  );

  const openDeals = deals.filter((d) => (d.status ?? "").toLowerCase() === "open");
  const stalled = attention.filter((a) => a.kind === "stalled_deal").length;
  const overdue = attention.filter((a) => a.kind === "overdue_task").length;
  const openTasks = tasks.filter((t) => {
    const s = (t.status ?? "").toLowerCase();
    return s !== "completed" && s !== "cancelled";
  }).length;

  let dealValue = sumOpenDealValue(deals);
  if (!dealValue && payload.deals_summary && payload.deals_summary.mixed_currency !== true) {
    const currency = payload.deals_summary.currency || "BRL";
    if (typeof payload.deals_summary.open_value === "number") {
      dealValue = majorUnitsToCents(payload.deals_summary.open_value, currency);
    }
  }

  const snapshotFreshness = rollupFreshness(
    freshnessBySurface.length > 0 ? freshnessBySurface : [healthFresh],
  );

  const uniqueContracts = new Map<string, RequiredUpstreamContract>();
  for (const c of contracts) {
    uniqueContracts.set(c.id, c);
  }

  const intelExceptions = unknownList(payload.confenge_intel_exceptions);

  const snapshot: CommercialSnapshot = {
    schema: COMMERCIAL_SNAPSHOT_SCHEMA,
    source: SNAPSHOT_SOURCE,
    observed_at: now.toISOString(),
    freshness_status: snapshotFreshness,
    health: {
      status: payload.health?.status ?? (healthFresh === "FRESH" ? "ok" : "unknown"),
      api_version: payload.api_version ?? "v1",
      version: payload.health?.version,
      confenge_enabled: payload.confenge_status?.enabled,
    },
    counts: {
      contacts: contacts.length,
      deals_open: openDeals.length,
      deals_stalled: stalled,
      tasks_open: openTasks,
      tasks_overdue: overdue,
      campaigns_active:
        payload.campaigns_overview?.active ??
        campaigns.filter((c) => (c.status ?? "").toLowerCase() === "active").length,
      inbox_unread: unibox?.unread ?? 0,
      inbox_awaiting_reply: unibox?.awaiting_reply ?? 0,
      inbound_now: inbound.filter((l) => {
        const s = (l.status ?? "new").toLowerCase();
        return s !== "done" && s !== "handled" && s !== "closed";
      }).length,
      confenge_attention: confengeAttention.length,
      attention: attention.length,
    },
    attention,
    observations,
    required_upstream_contract: [...uniqueContracts.values()],
  };
  if (dealValue) {
    snapshot.deal_value_open = dealValue;
  }

  snapshot.operations = {
    authority: "warmbly",
    this_document: "read_model",
    dispatch: dispatchOf(payload),
    cap: OPERATIONS_CAP,
    deals: deals.slice(0, OPERATIONS_CAP).map((d) => ({
      id: d.id,
      name: d.name,
      status: d.status,
      value: d.value,
      currency: d.currency,
      stage_id: d.stage_id,
      stage_name: d.stage?.name,
      contact_id: d.contact_id ?? null,
      account_id: d.account_id ?? null,
      lead_id: d.lead_id ?? null,
      created_at: d.created_at,
      updated_at: d.updated_at,
      won_at: d.won_at,
      lost_at: d.lost_at,
      expected_close_date: d.expected_close_date,
      campaign_id: d.campaign_id,
    })),
    tasks: tasks.slice(0, OPERATIONS_CAP).map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      due_date: t.due_date,
      priority: t.priority,
      deal_id: t.deal_id,
      created_at: t.created_at,
      updated_at: t.updated_at,
    })),
    contacts: contacts.slice(0, OPERATIONS_CAP).map((c) => ({
      id: c.id,
      company: c.company,
      first_name: c.first_name,
      last_name: c.last_name,
      created_at: c.created_at,
      updated_at: c.updated_at,
      last_activity_at: c.campaign_lead?.last_activity_at,
      status: c.campaign_lead?.status,
      account_id: c.account_id ?? null,
      lead_id: c.lead_id ?? null,
    })),
    inbound: inbound.slice(0, OPERATIONS_CAP).map((row) => ({
      lead_id: row.lead_id,
      company: row.company,
      person: row.person,
      status: row.status,
      why_now: row.why_now,
      recommended_action: row.recommended_action,
    })),
    intel_scoreboard: payload.confenge_intel_scoreboard ?? null,
    intel_executive: payload.confenge_intel_executive ?? null,
    intel_exceptions: intelExceptions.slice(0, OPERATIONS_CAP),
    intel_exceptions_total: intelExceptions.length,
    intel_organic_scoreboard: payload.confenge_intel_organic_scoreboard ?? null,
    confenge_status: payload.confenge_status ?? null,
  };

  // Pipelines are read for stage names on stalled deals only — never copied
  // onto the snapshot as a replica board.
  void pipelines;

  return snapshot;
}

/**
 * Projects GET /v1/confenge/dispatch/status for the operator cockpit.
 *
 * `state` is the only field the surface reads to decide what it tells the
 * founder, and it is a tri-state on purpose. Warmbly reports `paused` as a
 * plain boolean, so an endpoint that is absent, 404, or malformed leaves us
 * with no reading at all — and rendering that as ACTIVE would tell the founder
 * outbound is running when nobody knows. Absent is UNKNOWN.
 */
function dispatchOf(payload: WarmblyPayload): Record<string, unknown> {
  const raw = unwrapData(payload.confenge_dispatch_status);
  if (!raw || typeof raw !== "object") {
    return {
      state: "UNKNOWN",
      observed: false,
      why: "GET /v1/confenge/dispatch/status did not answer; the kill-switch state is not known",
    };
  }
  const st = raw as WarmblyDispatchStatus;
  const state = st.paused === true ? "PAUSED" : st.paused === false ? "ACTIVE" : "UNKNOWN";
  const out: Record<string, unknown> = { state, observed: true };
  if (state === "UNKNOWN") {
    out.why = "Warmbly answered without a `paused` field; absence is not evidence that dispatch is running";
  }
  // Every field below is omitted rather than defaulted: the cockpit renders
  // "—" for what was not observed instead of inventing a window or a cap.
  if (typeof st.pause_reason === "string" && st.pause_reason.trim() !== "") {
    out.pause_reason = st.pause_reason.trim();
  }
  if (typeof st.in_send_window === "boolean") out.in_send_window = st.in_send_window;
  if (typeof st.timezone === "string" && st.timezone !== "") out.timezone = st.timezone;
  if (typeof st.window_start === "string" && st.window_start !== "") out.window_start = st.window_start;
  if (typeof st.window_end === "string" && st.window_end !== "") out.window_end = st.window_end;
  if (typeof st.next_slot_at === "string" && st.next_slot_at !== "") out.next_slot_at = st.next_slot_at;
  if (typeof st.sent_last_hour === "number") out.sent_last_hour = st.sent_last_hour;
  if (typeof st.cap === "number") out.cap = st.cap;
  if (typeof st.queued_approved === "number") out.queued_approved = st.queued_approved;
  if (typeof st.active_leases === "number") out.active_leases = st.active_leases;
  return out;
}

/** Stable attention slice for idempotency comparisons (ignores observed_at). */
export function attentionSlice(snapshot: CommercialSnapshot): Array<{
  id: string;
  kind: string;
  title: string;
  why: string;
}> {
  return snapshot.attention.map((a) => ({
    id: a.id,
    kind: a.kind,
    title: a.title,
    why: a.why,
  }));
}
