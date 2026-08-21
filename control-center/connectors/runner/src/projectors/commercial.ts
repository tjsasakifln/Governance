import { availabilityFromEnvelope, freshnessForAvailability } from "./availability.ts";
import {
  COHORT_WINDOWS,
  LIST_CAP,
  PROJECTOR_VERSION,
  TINY_DENOMINATOR,
  asArray,
  asRecord,
  capList,
  finiteNumber,
  integerOrUndefined,
  isoOr,
  type Availability,
  type CollectorEnvelope,
  type CohortWindow,
  type ProjectedSnapshot,
} from "./types.ts";

const WINDOW_MS: Record<Exclude<CohortWindow, "open">, number> = {
  "7d": 7 * 24 * 60 * 60 * 1000,
  "28d": 28 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
};

function centsOf(value: unknown, currencyFallback = "BRL"): { amount_cents: number; currency: string } | undefined {
  const rec = asRecord(value);
  if (rec && typeof rec.amount_cents === "number" && Number.isInteger(rec.amount_cents)) {
    const currency = typeof rec.currency === "string" ? rec.currency : currencyFallback;
    return { amount_cents: rec.amount_cents, currency };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { amount_cents: Math.round(value * 100), currency: currencyFallback };
  }
  return undefined;
}

function parseTime(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

function rate(numerator: number, denominator: number): Record<string, unknown> {
  const tiny = denominator < TINY_DENOMINATOR;
  const out: Record<string, unknown> = {
    numerator,
    denominator,
    tiny_denominator: tiny,
  };
  if (denominator > 0) {
    out.ratio = numerator / denominator;
  } else {
    out.ratio = null;
    out.omitted_reason = "denominator_zero";
  }
  if (tiny) {
    out.evidence_note = "tiny_denominator_not_statistical_evidence";
  }
  return out;
}

function stripIdentity(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(row)) {
    if (/(email|phone|telefone|cpf|cnpj|secret|token|password|authorization)/i.test(key)) {
      continue;
    }
    if (child && typeof child === "object" && !Array.isArray(child)) {
      out[key] = stripIdentity(child as Record<string, unknown>);
    } else {
      out[key] = child;
    }
  }
  return out;
}

function displayName(row: Record<string, unknown>): string {
  if (typeof row.company === "string" && row.company.trim()) return row.company.trim();
  if (typeof row.company_name === "string" && row.company_name.trim()) return row.company_name.trim();
  if (typeof row.name === "string" && row.name.trim()) return row.name.trim();
  const first = typeof row.first_name === "string" ? row.first_name.trim() : "";
  const last = typeof row.last_name === "string" ? row.last_name.trim() : "";
  const joined = `${first} ${last}`.trim();
  if (joined) return joined;
  if (typeof row.display_name === "string" && row.display_name.trim()) return row.display_name.trim();
  if (typeof row.id === "string") return row.id;
  return "unknown";
}

function operationsFromWarmbly(payload: Record<string, unknown>, observedAt: string): Record<string, unknown> {
  const nested = asRecord(payload.operations) ?? {};
  const deals = asArray(nested.deals).length > 0 ? asArray(nested.deals) : asArray(payload.deals);
  const tasks = asArray(nested.tasks).length > 0 ? asArray(nested.tasks) : asArray(payload.tasks);
  const contacts = asArray(nested.contacts).length > 0 ? asArray(nested.contacts) : asArray(payload.contacts);
  const inbound = asArray(nested.inbound).length > 0 ? asArray(nested.inbound) : asArray(payload.confenge_inbound);
  const attention = asArray(payload.attention);
  const now = Date.parse(observedAt);

  const pipeline = capList(
    deals
      .map((item) => asRecord(item))
      .filter((row): row is Record<string, unknown> => row !== null)
      .map((row) => {
        const money = centsOf(row.value ?? row.amount_cents ?? row.deal_value);
        const updated = isoOr(row.updated_at, observedAt);
        const ageMs = now - (parseTime(updated) ?? now);
        const status = typeof row.status === "string" ? row.status.toLowerCase() : "unknown";
        return {
          id: typeof row.id === "string" ? row.id : "unknown",
          canonical_id: `cc:commercial-deal:${typeof row.id === "string" ? row.id : "unknown"}`,
          source_id: typeof row.id === "string" ? row.id : "unknown",
          display_name: displayName(row),
          stage: typeof row.stage_name === "string" ? row.stage_name : asRecord(row.stage)?.name ?? status,
          status,
          next_action: typeof row.next_action === "string" ? row.next_action : null,
          age_seconds: Math.max(0, Math.floor(ageMs / 1000)),
          stale: ageMs >= 14 * 24 * 60 * 60 * 1000 && status === "open",
          ...(money ? { value: money } : {}),
        };
      }),
  );

  const activity = capList(
    [...deals, ...tasks, ...inbound, ...attention]
      .map((item) => asRecord(item))
      .filter((row): row is Record<string, unknown> => row !== null)
      .map((row) => {
        const at = isoOr(row.updated_at ?? row.observed_at ?? row.created_at ?? row.detected_at, observedAt);
        return {
          at,
          lead_or_account: displayName(row),
          source_id: typeof row.id === "string" ? row.id : typeof row.lead_id === "string" ? row.lead_id : "unknown",
          event: typeof row.kind === "string" ? row.kind : typeof row.status === "string" ? row.status : "activity",
          state: typeof row.status === "string" ? row.status : typeof row.commercial_state === "string" ? row.commercial_state : null,
          evidence: typeof row.why === "string" ? row.why : typeof row.why_now === "string" ? row.why_now : typeof row.title === "string" ? row.title : null,
        };
      })
      .sort((a, b) => b.at.localeCompare(a.at)),
  );

  const exceptions = capList(
    attention
      .map((item) => asRecord(item))
      .filter((row): row is Record<string, unknown> => row !== null)
      .map((row) => ({
        id: typeof row.id === "string" ? row.id : "unknown",
        canonical_id: `cc:attention-item:${typeof row.id === "string" ? row.id.replace(/[^A-Za-z0-9._~-]+/g, "-") : "unknown"}`,
        source_id: typeof row.id === "string" ? row.id : "unknown",
        why: typeof row.why === "string" ? row.why : typeof row.title === "string" ? row.title : "exception",
        kind: typeof row.kind === "string" ? row.kind : "exception_state",
        recommended_next_action: typeof row.recommended_action === "string" ? row.recommended_action : null,
        status: "open",
        evidence: stripIdentity(row),
      })),
  );

  const status = asRecord(payload.confenge_status) ?? asRecord(asRecord(payload.health)?.confenge_status) ?? {};
  const autoSend =
    status.auto_send_enabled === true
      ? { enabled: true, source: "warmbly.confenge.status", note: "observed enabled; Control Center must not enable sending" }
      : { enabled: false, source: "warmbly.confenge.status", observed: status.auto_send_enabled === false };

  const scoreboard = nested.intel_scoreboard ?? payload.intel_scoreboard ?? payload.confenge_intel_scoreboard;
  const executive = nested.intel_executive ?? payload.intel_executive ?? payload.confenge_intel_executive;
  const cohorts = buildCohorts({
    contacts: contacts.map((item) => asRecord(item)).filter((row): row is Record<string, unknown> => row !== null),
    deals: deals.map((item) => asRecord(item)).filter((row): row is Record<string, unknown> => row !== null),
    inbound: inbound.map((item) => asRecord(item)).filter((row): row is Record<string, unknown> => row !== null),
    observedAt,
    now,
    scoreboard,
    executive,
  });

  return {
    schema_version: "control-center.commercial-operations.v1",
    projector_version: PROJECTOR_VERSION,
    authority: {
      catalog_authority: "governance",
      commercial_runtime: "warmbly",
      this_document: "read_model",
    },
    auto_send: autoSend,
    overview: {
      exceptions: exceptions.length,
      overdue_work: integerOrUndefined(asRecord(payload.counts)?.tasks_overdue),
      inbound_requiring_attention: integerOrUndefined(asRecord(payload.counts)?.inbound_now),
      opportunities_requiring_action: pipeline.filter((row) => row.status === "open").length,
    },
    cohorts,
    activity,
    pipeline,
    exceptions,
    growth: growthFromScoreboard(scoreboard, executive, observedAt),
  };
}

function inWindow(created: number | undefined, now: number, window: CohortWindow): boolean {
  if (created === undefined) return window === "open";
  if (window === "open") return true;
  return now - created <= WINDOW_MS[window];
}

function buildCohorts(input: {
  contacts: Record<string, unknown>[];
  deals: Record<string, unknown>[];
  inbound: Record<string, unknown>[];
  observedAt: string;
  now: number;
  scoreboard: unknown;
  executive: unknown;
}): Record<string, unknown> {
  const derived = COHORT_WINDOWS.map((window) => {
    const population = input.contacts.filter((row) => inWindow(parseTime(row.created_at), input.now, window));
    const contacted = population.filter((row) => {
      const lead = asRecord(row.campaign_lead);
      return Boolean(lead) || typeof row.last_activity_at === "string";
    });
    const replies = population.filter((row) => {
      const status = String(asRecord(row.campaign_lead)?.status ?? row.status ?? "").toLowerCase();
      return status.includes("reply") || status.includes("replied");
    });
    const qualified = population.filter((row) => {
      const status = String(asRecord(row.campaign_lead)?.status ?? row.status ?? "").toLowerCase();
      return status.includes("qualified");
    });
    const opportunities = input.deals.filter((row) => inWindow(parseTime(row.created_at), input.now, window));
    const won = opportunities.filter((row) => String(row.status ?? "").toLowerCase() === "won");
    const pop = population.length;
    return {
      window,
      kind: "acquisition_cohort",
      anchor_event: "contact.created_at",
      anchor_label: "Acquisition cohort: contact created_at. Not an event-period metric.",
      source: "control-center.derived_from_warmbly_crm_reads",
      population: pop,
      contacted: contacted.length,
      reply: replies.length,
      qualified_reply: qualified.length,
      opportunity_created: opportunities.length,
      won: won.length,
      reply_rate: rate(replies.length, contacted.length || pop),
      qualified_reply_rate: rate(qualified.length, contacted.length || pop),
      opportunity_conversion: rate(opportunities.length, pop),
      win_conversion: rate(won.length, opportunities.length),
    };
  });

  const scoreboardCohorts = scoreboardToCohorts(input.scoreboard, input.executive, input.observedAt);
  return {
    mixing_rule: "acquisition_cohorts_and_event_period_metrics_are_labeled_separately",
    acquisition: derived,
    inbound_truth: scoreboardCohorts,
  };
}

function scoreboardToCohorts(scoreboard: unknown, executive: unknown, observedAt: string): Record<string, unknown> {
  const rec = asRecord(scoreboard);
  if (!rec) {
    return {
      configured: false,
      schema: "confenge.inbound_truth_scoreboard.v1",
      availability: "NO_DATA",
      observed_at: observedAt,
      note: "Warmbly scoreboard was not present on this observation. Not derived from CRM counts.",
    };
  }
  const stages = asArray(rec.stages).length > 0 ? asArray(rec.stages) : asArray(rec.items);
  return {
    configured: true,
    schema: typeof rec.schema === "string" ? rec.schema : typeof rec.schema_version === "string" ? rec.schema_version : "confenge.inbound_truth_scoreboard.v1",
    kind: "event_period_funnel",
    anchor_event: "warmbly_inbound_truth_scoreboard",
    anchor_label: "Warmbly inbound-truth scoreboard. Not an acquisition cohort.",
    source: "warmbly",
    include_synthetic: rec.include_synthetic === true,
    stages: stages.map((item) => {
      const row = asRecord(item) ?? {};
      return {
        id: row.id ?? row.stage ?? row.label,
        label: row.label ?? row.id,
        status: row.status,
        numerator: integerOrUndefined(row.numerator),
        denominator: integerOrUndefined(row.denominator),
        freshness: row.freshness,
        next_action: row.next_action,
        observation: row.observation,
      };
    }),
    executive: asRecord(executive) ? stripIdentity(asRecord(executive) as Record<string, unknown>) : null,
  };
}

function growthFromScoreboard(scoreboard: unknown, executive: unknown, observedAt: string): Record<string, unknown> {
  const mapped = scoreboardToCohorts(scoreboard, executive, observedAt);
  return {
    schema_version: "control-center.growth-readmodel.v1",
    funnel_contract: [
      "search_visibility",
      "click_session",
      "cta",
      "inbound_event",
      "lead",
      "qualified_lead",
      "opportunity",
      "commercial_proposal",
      "client_revenue",
    ],
    attribution: {
      cross_system_join: "not_invented",
      note: "Hops without a durable ID stay UNKNOWN/BLOCKED. Scoreboard stages 1-2 stay BLOCKED without GSC/URL-index ingest.",
    },
    scoreboard: mapped,
  };
}

export function projectCommercial(envelope: CollectorEnvelope): ProjectedSnapshot {
  const availability = availabilityFromEnvelope(envelope);
  const freshness = freshnessForAvailability(availability, envelope.freshness_status);
  const payload = asRecord(envelope.payload) ?? {};
  const inner = asRecord(payload.snapshot) ?? payload;
  const counts = asRecord(inner.counts) ?? {};
  const operations = operationsFromWarmbly(inner, envelope.observed_at);

  const funnel: Record<string, unknown> = {};
  const inboundNow = integerOrUndefined(counts.inbound_now);
  const dealsOpen = integerOrUndefined(counts.deals_open);
  if (inboundNow !== undefined) funnel.new_leads = inboundNow;
  if (dealsOpen !== undefined) funnel.opportunities = dealsOpen;

  const body: Record<string, unknown> = {
    schema_version: "control-center.commercial-snapshot.v1",
    projector_version: PROJECTOR_VERSION,
    availability,
    configured: availability !== "NOT_CONFIGURED" && availability !== "BLOCKED_BY_SECRET",
    empty: availability === "FRESH" && dealsOpen === 0 && inboundNow === 0,
    authority: {
      catalog_authority: "governance",
      commercial_runtime: "warmbly",
      this_document: "read_model",
    },
    offer_pin: {
      catalog_authority: "governance",
      catalog_id: "CFG-OFFER-CATALOG-v1",
    },
    operations,
  };
  if (Object.keys(funnel).length > 0) {
    body.funnel = funnel;
  }
  const nominal = centsOf(inner.deal_value_open ?? inner.pipeline_nominal);
  if (nominal) {
    body.pipeline_nominal = {
      ...nominal,
      source: envelope.source,
      observed_at: envelope.observed_at,
      freshness_status: freshness,
      confidence: envelope.confidence,
    };
  }
  if (integerOrUndefined(counts.deals_stalled) !== undefined) {
    body.stalled_count = counts.deals_stalled;
    body.aging_count = counts.deals_stalled;
  }
  if (integerOrUndefined(counts.tasks_overdue) !== undefined) {
    body.missing_next_action_count = counts.tasks_overdue;
  }
  if (dealsOpen !== undefined) body.pipeline_open_count = dealsOpen;
  if (integerOrUndefined(counts.inbox_unread) !== undefined) {
    body.inbound_unread_count = counts.inbox_unread;
  }

  let finalAvailability: Availability = availability;
  if (availability === "FRESH" && Object.keys(funnel).length === 0 && dealsOpen === undefined) {
    finalAvailability = "NO_DATA";
    body.availability = "NO_DATA";
    body.empty = true;
  }

  return {
    projector_version: PROJECTOR_VERSION,
    snapshot_kind: "commercial",
    scope: "commercial",
    payload: body,
    freshness_status: freshness,
    availability: finalAvailability,
    confidence: envelope.confidence,
    observed_at: envelope.observed_at,
    source: envelope.source,
  };
}

export { LIST_CAP };
