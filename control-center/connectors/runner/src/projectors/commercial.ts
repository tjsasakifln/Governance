import { availabilityFromEnvelope, freshnessForAvailability } from "./availability.ts";
import {
  JOIN_UNPROVEN,
  JOIN_UNPROVEN_REASON,
  attributedDeals,
  cohortJoinAvailable,
} from "./cohort-join.ts";
import {
  COHORT_WINDOWS,
  LIST_CAP,
  PROJECTOR_VERSION,
  TINY_DENOMINATOR,
  asArray,
  asRecord,
  capList,
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

function unprovenRate(denominator: number): Record<string, unknown> {
  const tiny = denominator < TINY_DENOMINATOR;
  return {
    numerator: null,
    denominator,
    ratio: null,
    availability: JOIN_UNPROVEN,
    omitted_reason: JOIN_UNPROVEN_REASON,
    tiny_denominator: tiny,
    ...(tiny ? { evidence_note: "tiny_denominator_not_statistical_evidence" } : {}),
  };
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

/**
 * Best available name for a record, or `null` when the source carries none.
 *
 * It used to end in `return "unknown"`, which made "we have no name" and "the
 * name is literally unknown" the same string one layer down, where the clients
 * projector turned it into the `client:unknown` card. Absence is now absence.
 */
function displayName(row: Record<string, unknown>): string | null {
  if (typeof row.company === "string" && row.company.trim()) return row.company.trim();
  if (typeof row.company_name === "string" && row.company_name.trim()) return row.company_name.trim();
  if (typeof row.name === "string" && row.name.trim()) return row.name.trim();
  const first = typeof row.first_name === "string" ? row.first_name.trim() : "";
  const last = typeof row.last_name === "string" ? row.last_name.trim() : "";
  const joined = `${first} ${last}`.trim();
  if (joined) return joined;
  if (typeof row.display_name === "string" && row.display_name.trim()) return row.display_name.trim();
  if (typeof row.id === "string" && row.id.trim()) return row.id.trim();
  return null;
}

/** The record's own identifier, or `null`. Never the string "unknown". */
function sourceIdOf(row: Record<string, unknown>): string | null {
  return typeof row.id === "string" && row.id.trim() !== "" ? row.id.trim() : null;
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
        const sourceId = sourceIdOf(row);
        const name = displayName(row);
        return {
          // Fail closed: a record with no identifier gets null, not a plausible
          // looking id. Downstream must route it to the data-quality queue.
          id: sourceId,
          canonical_id: sourceId === null ? null : `cc:commercial-deal:${sourceId}`,
          source_id: sourceId,
          display_name: name,
          identity_status: sourceId !== null && name !== null ? "identified" : "unidentified",
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

  const intelExceptions = asArray(
    nested.intel_exceptions ?? payload.intel_exceptions ?? payload.confenge_intel_exceptions,
  );
  const intelExceptionsTotal = declaredIntelExceptionsTotal(nested, payload, intelExceptions.length);
  const mergedExceptions = mergeExceptions(intelExceptions, attention, observedAt);
  const exceptionsTotal = Math.max(intelExceptionsTotal, mergedExceptions.length);
  const exceptions = capList(mergedExceptions);

  const status = asRecord(payload.confenge_status) ?? asRecord(asRecord(payload.health)?.confenge_status) ?? {};
  const autoSend =
    status.auto_send_enabled === true
      ? { enabled: true, source: "warmbly.confenge.status", note: "observed enabled; Control Center must not enable sending" }
      : { enabled: false, source: "warmbly.confenge.status", observed: status.auto_send_enabled === false };

  const scoreboard = nested.intel_scoreboard ?? payload.intel_scoreboard ?? payload.confenge_intel_scoreboard;
  const executive = nested.intel_executive ?? payload.intel_executive ?? payload.confenge_intel_executive;
  const organic =
    nested.intel_organic_scoreboard ?? payload.intel_organic_scoreboard ?? payload.confenge_intel_organic_scoreboard;
  const intelExceptionsPresent = intelExceptions.length > 0 || intelExceptionsSourcePresent(nested, payload);
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
    // Passed through from the connector rather than re-derived. This projector
    // rebuilds most of `operations` from the raw payload, so a block that only
    // the connector computes has to be forwarded explicitly or it silently
    // disappears between the mapper and the surface that renders it.
    dispatch: asRecord(nested.dispatch) ?? {
      state: "UNKNOWN",
      observed: false,
      why: "the collector produced no dispatch reading; the kill-switch state is not known",
    },
    authority: {
      catalog_authority: "governance",
      commercial_runtime: "warmbly",
      this_document: "read_model",
    },
    auto_send: autoSend,
    overview: {
      exceptions: exceptionsTotal,
      exceptions_shown: exceptions.length,
      overdue_work: integerOrUndefined(asRecord(payload.counts)?.tasks_overdue),
      inbound_requiring_attention: integerOrUndefined(asRecord(payload.counts)?.inbound_now),
      opportunities_requiring_action: pipeline.filter((row) => row.status === "open").length,
    },
    cohorts,
    activity,
    pipeline,
    exceptions,
    intel: {
      scoreboard: scoreboardPresent(scoreboard) ? scoreboard : null,
      executive: asRecord(executive) ? stripIdentity(asRecord(executive) as Record<string, unknown>) : null,
      exceptions: intelExceptionsPresent ? capList(intelExceptions) : null,
      exceptions_total: intelExceptionsPresent ? intelExceptionsTotal : 0,
      exceptions_capped: intelExceptionsPresent && intelExceptionsTotal > LIST_CAP,
      organic_scoreboard: organicPresent(organic) ? organic : null,
    },
    growth: growthFromIntel(scoreboard, executive, organic, observedAt),
  };
}

function declaredIntelExceptionsTotal(
  nested: Record<string, unknown>,
  payload: Record<string, unknown>,
  listed: number,
): number {
  const declared =
    integerOrUndefined(nested.intel_exceptions_total) ?? integerOrUndefined(payload.intel_exceptions_total);
  if (declared !== undefined && declared >= 0) {
    return Math.max(declared, listed);
  }
  return listed;
}

function intelExceptionsSourcePresent(nested: Record<string, unknown>, payload: Record<string, unknown>): boolean {
  return (
    (nested.intel_exceptions !== undefined && nested.intel_exceptions !== null) ||
    (payload.intel_exceptions !== undefined && payload.intel_exceptions !== null) ||
    (payload.confenge_intel_exceptions !== undefined && payload.confenge_intel_exceptions !== null)
  );
}

function mergeExceptions(intel: unknown[], attention: unknown[], observedAt: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const push = (row: Record<string, unknown>, source: "warmbly.intel.exceptions" | "warmbly.attention") => {
    const rawId = typeof row.id === "string" && row.id.trim() ? row.id.trim() : "";
    const id = rawId || `${source}:${out.length}`;
    if (seen.has(id)) return;
    seen.add(id);
    const slug = id.replace(/[^A-Za-z0-9._~-]+/g, "-");
    out.push({
      id,
      canonical_id: `cc:attention-item:${slug}`,
      source_id: typeof row.source_id === "string" ? row.source_id : id,
      why:
        typeof row.why === "string"
          ? row.why
          : typeof row.reason === "string"
            ? row.reason
            : typeof row.title === "string"
              ? row.title
              : typeof row.code === "string"
                ? row.code
                : "exception",
      kind:
        typeof row.kind === "string"
          ? row.kind
          : typeof row.code === "string"
            ? row.code
            : source === "warmbly.intel.exceptions"
              ? "intel_exception"
              : "exception_state",
      recommended_next_action:
        typeof row.recommended_next_action === "string"
          ? row.recommended_next_action
          : typeof row.next_action === "string"
            ? row.next_action
            : typeof row.recommended_action === "string"
              ? row.recommended_action
              : null,
      status: typeof row.status === "string" ? row.status : "open",
      source,
      observed_at: isoOr(row.at ?? row.opened_at ?? row.updated_at, observedAt),
      evidence: stripIdentity(row),
    });
  };
  for (const item of intel) {
    const row = asRecord(item);
    if (row) push(row, "warmbly.intel.exceptions");
  }
  for (const item of attention) {
    const row = asRecord(item);
    if (row) push(row, "warmbly.attention");
  }
  return out;
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
    const joinOk = cohortJoinAvailable(population, input.deals);
    const linked = joinOk ? attributedDeals(population, input.deals) : [];
    const won = linked.filter((row) => String(row.status ?? "").toLowerCase() === "won");
    const pop = population.length;
    const opportunityConversion = joinOk
      ? rate(linked.length, pop)
      : unprovenRate(pop);
    const winConversion = joinOk
      ? rate(won.length, linked.length)
      : unprovenRate(linked.length);
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
      opportunity_created: joinOk ? linked.length : null,
      won: joinOk ? won.length : null,
      join: joinOk
        ? { availability: "PROVEN", rule: "durable_contact_account_or_lead_id" }
        : { availability: JOIN_UNPROVEN, reason: JOIN_UNPROVEN_REASON },
      reply_rate: rate(replies.length, contacted.length),
      qualified_reply_rate: rate(qualified.length, contacted.length),
      opportunity_conversion: opportunityConversion,
      win_conversion: winConversion,
    };
  });

  const scoreboardCohorts = scoreboardToCohorts(input.scoreboard, input.executive, input.observedAt);
  return {
    mixing_rule: "acquisition_cohorts_and_event_period_metrics_are_labeled_separately",
    acquisition: derived,
    inbound_truth: scoreboardCohorts,
  };
}

function scoreboardPresent(scoreboard: unknown): boolean {
  const rec = asRecord(scoreboard);
  if (!rec) return false;
  if (Object.prototype.hasOwnProperty.call(rec, "data") && rec.stages === undefined && rec.schema_version === undefined && rec.schema === undefined) {
    return false;
  }
  return rec.schema_version !== undefined || rec.schema !== undefined || Array.isArray(rec.stages);
}

function organicPresent(organic: unknown): boolean {
  const rec = asRecord(organic);
  if (!rec) return false;
  if (Object.prototype.hasOwnProperty.call(rec, "data") && rec.windows === undefined && rec.schema_version === undefined) {
    return false;
  }
  return rec.schema_version !== undefined || Array.isArray(rec.windows) || Array.isArray(rec.sources);
}

function scoreboardToCohorts(scoreboard: unknown, executive: unknown, observedAt: string): Record<string, unknown> {
  if (!scoreboardPresent(scoreboard)) {
    return {
      configured: false,
      schema: "confenge.inbound_truth_scoreboard.v1",
      availability: "NO_DATA",
      observed_at: observedAt,
      note: "Warmbly scoreboard was not present on this observation. Not derived from CRM counts.",
    };
  }
  const rec = asRecord(scoreboard) as Record<string, unknown>;
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

function organicToGrowth(organic: unknown, observedAt: string): Record<string, unknown> {
  if (!organicPresent(organic)) {
    return {
      configured: false,
      availability: "NO_DATA",
      observed_at: observedAt,
      source: "warmbly.intel.organic-scoreboard",
      note: "Warmbly OrganicScoreboard was not present on this observation.",
    };
  }
  const rec = asRecord(organic) as Record<string, unknown>;
  return {
    configured: true,
    availability: "FRESH",
    schema: typeof rec.schema_version === "string" ? rec.schema_version : "confenge.organic_scoreboard.v1",
    source: "warmbly.intel.organic-scoreboard",
    authority: "warmbly",
    include_synthetic: rec.include_synthetic === true,
    real_empty: rec.real_empty === true,
    windows: asArray(rec.windows),
    sources: asArray(rec.sources),
    recommendation: rec.recommendation ?? null,
    generated_at: rec.generated_at ?? observedAt,
    note: "Warmbly-owned organic/growth intelligence. Control Center does not recompute it.",
  };
}

function growthFromIntel(
  scoreboard: unknown,
  executive: unknown,
  organic: unknown,
  observedAt: string,
): Record<string, unknown> {
  const mapped = scoreboardToCohorts(scoreboard, executive, observedAt);
  const organicMapped = organicToGrowth(organic, observedAt);
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
      note: "Hops without a durable ID stay UNKNOWN/BLOCKED. Scoreboard stages 1-2 stay BLOCKED without GSC/URL-index ingest. OrganicScoreboard is Warmbly-owned.",
    },
    scoreboard: mapped,
    organic_scoreboard: organicMapped,
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
