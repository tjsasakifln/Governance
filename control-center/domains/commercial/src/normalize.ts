import { parseUtc } from "./clock.ts";
import {
  DEFAULT_CURRENCY,
  EXTRA_HISTORICAL_AMOUNT_CENTS,
  EXTRA_HISTORICAL_EXCEPTION_ID,
  FUNNEL_KEYS,
  OBSERVATION_SCHEMA_VERSION,
  type CommercialObservationSet,
  type ExtraHistoricalMarker,
  type FreshnessStatus,
  type FunnelKey,
  type GovernanceOfferPin,
  type KnownOfferPin,
  type SourceRef,
  type StageMap,
  type WarmblyCommercialRecord,
} from "./contracts.ts";
import { clampConfidence, parseFreshness } from "./freshness.ts";
import {
  integerCents,
  majorUnitsToCentsExact,
  normalizeCurrency,
} from "./money.ts";

export type FunnelBucket = FunnelKey | "unclassified" | "lost";

export type NormalizedRecord = {
  id: string;
  entity: WarmblyCommercialRecord["entity"];
  funnel: FunnelBucket;
  status: string;
  amount_cents: number | null;
  currency: string | null;
  probability: number | null;
  probability_reliable: boolean;
  offer_id: string | null;
  offer_version: string | null;
  treated_as_catalog_offer: boolean;
  next_action: string | null;
  next_action_at: Date | null;
  last_activity_at: Date | null;
  stage_entered_at: Date | null;
  expected_close_at: Date | null;
  created_at: Date | null;
  updated_at: Date | null;
  observed_at: Date | null;
  freshness_status: FreshnessStatus;
  confidence: number | undefined;
  stage_name: string | null;
  extra_historical_cents: boolean;
};

export type NormalizedInput = {
  observed_at: Date | null;
  observed_at_iso: string;
  source: SourceRef;
  freshness_status: FreshnessStatus;
  confidence: number | undefined;
  records: NormalizedRecord[];
  offer_pin: GovernanceOfferPin;
  extra_historical: ExtraHistoricalMarker;
};

const DEFAULT_STAGE_MAP: Record<string, FunnelKey> = {
  new: "novos_leads",
  lead: "novos_leads",
  novos: "novos_leads",
  novo: "novos_leads",
  novos_leads: "novos_leads",
  inbound: "novos_leads",
  inbound_lead: "novos_leads",
  qualified: "qualificados",
  qualificad: "qualificados",
  qualificado: "qualificados",
  qualificados: "qualificados",
  mql: "qualificados",
  sql: "qualificados",
  opportunity: "oportunidades",
  oportunidade: "oportunidades",
  oportunidades: "oportunidades",
  deal: "oportunidades",
  proposal: "propostas",
  proposta: "propostas",
  propostas: "propostas",
  quote: "propostas",
  sent: "propostas",
  client: "clientes",
  cliente: "clientes",
  clientes: "clientes",
  won: "clientes",
  customer: "clientes",
  "closed-won": "clientes",
  closed_won: "clientes",
  closedwon: "clientes",
};

const LOST = new Set(["lost", "closed-lost", "closed_lost", "discarded", "churned"]);
const WON = new Set(["won", "client", "customer", "closed-won", "closed_won", "active_client"]);
const TERMINAL_TASK = new Set(["completed", "cancelled", "canceled", "done"]);

function isFunnelKey(value: string): value is FunnelKey {
  return (FUNNEL_KEYS as readonly string[]).includes(value);
}

function normKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function lookupStage(
  raw: string | null | undefined,
  stageMap: StageMap,
): FunnelKey | null {
  if (!raw) {
    return null;
  }
  const key = normKey(raw);
  const mapped = stageMap[key] ?? stageMap[raw] ?? DEFAULT_STAGE_MAP[key];
  return mapped ?? null;
}

function classifyFunnel(
  record: WarmblyCommercialRecord,
  stageMap: StageMap,
): FunnelBucket {
  const status = normKey(record.status ?? "");
  if (LOST.has(status)) {
    return "lost";
  }
  if (typeof record.funnel_stage === "string" && isFunnelKey(record.funnel_stage)) {
    return record.funnel_stage;
  }
  if (typeof record.funnel_stage === "string") {
    const key = normKey(record.funnel_stage);
    if (key === "unknown" || key === "") {
      // fall through to other signals
    } else if (isFunnelKey(key)) {
      return key;
    } else {
      const mapped = lookupStage(record.funnel_stage, stageMap);
      if (mapped) {
        return mapped;
      }
    }
  }
  if (WON.has(status) || record.entity === "contact" && status === "client") {
    return "clientes";
  }
  const fromStage =
    lookupStage(record.stage_name, stageMap) ??
    lookupStage(record.stage_id, stageMap);
  if (fromStage) {
    return fromStage;
  }
  if (record.entity === "inbound_lead") {
    if (status === "qualified" || status === "qualificado") {
      return "qualificados";
    }
    if (status === "proposal" || status === "proposta") {
      return "propostas";
    }
    if (status === "client" || status === "won") {
      return "clientes";
    }
    if (status === "opportunity" || status === "oportunidade") {
      return "oportunidades";
    }
    return "novos_leads";
  }
  if (record.entity === "contact") {
    if (status === "qualified") {
      return "qualificados";
    }
    if (status === "client" || status === "customer") {
      return "clientes";
    }
    if (status === "lead" || status === "new" || status === "") {
      return "novos_leads";
    }
  }
  return "unclassified";
}

function resolveAmount(record: WarmblyCommercialRecord): {
  amount_cents: number | null;
  currency: string | null;
} {
  // Absent currency is denominated in the contractual catalog currency.
  // A currency that is present but unreadable is NOT relabelled as BRL: the
  // amount loses its denomination and fails closed downstream.
  const stated = record.currency;
  const hasAmount = record.amount_cents != null || record.value != null;
  const currency =
    stated === undefined || stated === null || (typeof stated === "string" && stated.trim() === "")
      ? hasAmount
        ? DEFAULT_CURRENCY
        : null
      : normalizeCurrency(stated);
  const fromCents = integerCents(record.amount_cents ?? null);
  if (fromCents !== null) {
    if (typeof record.value === "number" && Number.isFinite(record.value)) {
      const fromMajor = majorUnitsToCentsExact(record.value);
      if (fromMajor !== null && fromMajor !== fromCents) {
        return { amount_cents: null, currency };
      }
    }
    return { amount_cents: fromCents, currency };
  }
  if (typeof record.value === "number") {
    return {
      amount_cents: majorUnitsToCentsExact(record.value),
      currency,
    };
  }
  return { amount_cents: null, currency };
}

function resolveProbability(record: WarmblyCommercialRecord): {
  probability: number | null;
  probability_reliable: boolean;
} {
  const raw = record.probability;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 1) {
    return { probability: null, probability_reliable: false };
  }
  return {
    probability: raw,
    probability_reliable: record.probability_reliable === true,
  };
}

function asRecordArray(value: unknown): WarmblyCommercialRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: WarmblyCommercialRecord[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const rec = item as Partial<WarmblyCommercialRecord>;
    if (typeof rec.id !== "string" || rec.id.length === 0) {
      continue;
    }
    const entity = rec.entity;
    if (
      entity !== "deal" &&
      entity !== "inbound_lead" &&
      entity !== "contact" &&
      entity !== "task"
    ) {
      continue;
    }
    out.push(rec as WarmblyCommercialRecord);
  }
  return out;
}

function defaultPin(): GovernanceOfferPin {
  return {
    authority_id: "UNKNOWN",
    catalog_id: "UNKNOWN",
    catalog_authority: "governance",
    known_offers: [],
    not_an_offer: [
      {
        kind: "extra_historical",
        exception_id: EXTRA_HISTORICAL_EXCEPTION_ID,
        amount_cents: EXTRA_HISTORICAL_AMOUNT_CENTS,
        currency: DEFAULT_CURRENCY,
      },
    ],
  };
}

function coercePin(raw: unknown): GovernanceOfferPin {
  const base = defaultPin();
  if (!raw || typeof raw !== "object") {
    return base;
  }
  const p = raw as Partial<GovernanceOfferPin>;
  const known: KnownOfferPin[] = [];
  if (Array.isArray(p.known_offers)) {
    for (const row of p.known_offers) {
      if (
        row &&
        typeof row.offer_id === "string" &&
        row.offer_id.length > 0 &&
        typeof row.offer_version === "string" &&
        row.offer_version.length > 0
      ) {
        known.push({
          offer_id: row.offer_id,
          offer_version: row.offer_version,
        });
      }
    }
  }
  const extras: ExtraHistoricalMarker[] = [];
  if (Array.isArray(p.not_an_offer)) {
    for (const row of p.not_an_offer) {
      if (
        row &&
        row.kind === "extra_historical" &&
        typeof row.exception_id === "string" &&
        typeof row.amount_cents === "number" &&
        Number.isInteger(row.amount_cents)
      ) {
        extras.push({
          kind: "extra_historical",
          exception_id: row.exception_id,
          amount_cents: row.amount_cents,
          currency: normalizeCurrency(row.currency) ?? DEFAULT_CURRENCY,
        });
      }
    }
  }
  return {
    authority_id:
      typeof p.authority_id === "string" && p.authority_id.length > 0
        ? p.authority_id
        : base.authority_id,
    catalog_id:
      typeof p.catalog_id === "string" && p.catalog_id.length > 0
        ? p.catalog_id
        : base.catalog_id,
    catalog_authority: "governance",
    known_offers: known,
    not_an_offer: extras.length > 0 ? extras : base.not_an_offer,
    observed_at: typeof p.observed_at === "string" ? p.observed_at : undefined,
    freshness_status: p.freshness_status
      ? parseFreshness(p.freshness_status)
      : undefined,
    confidence: clampConfidence(p.confidence),
  };
}

function coerceSource(raw: unknown, fallbackLocator: string): SourceRef {
  if (typeof raw === "string" && raw.length > 0) {
    return { system: raw, kind: "commercial-observation", locator: fallbackLocator };
  }
  if (raw && typeof raw === "object") {
    const s = raw as Partial<SourceRef>;
    return {
      system:
        typeof s.system === "string" && s.system.length > 0
          ? s.system
          : "warmbly",
      kind:
        typeof s.kind === "string" && s.kind.length > 0
          ? s.kind
          : "commercial-observation",
      locator:
        typeof s.locator === "string" && s.locator.length > 0
          ? s.locator
          : fallbackLocator,
      label: typeof s.label === "string" ? s.label : undefined,
    };
  }
  return {
    system: "warmbly",
    kind: "commercial-observation",
    locator: fallbackLocator,
  };
}

function extraMarker(pin: GovernanceOfferPin): ExtraHistoricalMarker {
  const found = pin.not_an_offer.find((row) => row.kind === "extra_historical");
  return (
    found ?? {
      kind: "extra_historical",
      exception_id: EXTRA_HISTORICAL_EXCEPTION_ID,
      amount_cents: EXTRA_HISTORICAL_AMOUNT_CENTS,
      currency: DEFAULT_CURRENCY,
    }
  );
}

function attachTaskNextActions(
  records: NormalizedRecord[],
  tasks: WarmblyCommercialRecord[],
): void {
  const byDeal = new Map<string, WarmblyCommercialRecord[]>();
  const byLead = new Map<string, WarmblyCommercialRecord[]>();
  for (const task of tasks) {
    const status = (task.status ?? "").toLowerCase();
    if (TERMINAL_TASK.has(status)) {
      continue;
    }
    if (task.deal_id) {
      const list = byDeal.get(task.deal_id) ?? [];
      list.push(task);
      byDeal.set(task.deal_id, list);
    }
    if (task.inbound_lead_id) {
      const list = byLead.get(task.inbound_lead_id) ?? [];
      list.push(task);
      byLead.set(task.inbound_lead_id, list);
    }
  }
  for (const rec of records) {
    if (rec.next_action || rec.next_action_at) {
      continue;
    }
    const linked =
      (rec.entity === "deal" ? byDeal.get(rec.id) : undefined) ??
      (rec.entity === "inbound_lead" ? byLead.get(rec.id) : undefined) ??
      [];
    const open = linked[0];
    if (!open) {
      continue;
    }
    rec.next_action = typeof open.next_action === "string" ? open.next_action : "open_task";
    rec.next_action_at = parseUtc(open.next_action_at ?? open.due_date ?? null);
  }
}

export function coerceObservationSet(raw: unknown): CommercialObservationSet {
  if (!raw || typeof raw !== "object") {
    return {
      schema_version: OBSERVATION_SCHEMA_VERSION,
      records: [],
      offer_pin: defaultPin(),
    };
  }
  const input = raw as CommercialObservationSet;
  return {
    schema_version:
      typeof input.schema_version === "string"
        ? input.schema_version
        : OBSERVATION_SCHEMA_VERSION,
    observed_at: input.observed_at,
    source: input.source,
    freshness_status: input.freshness_status,
    confidence: input.confidence,
    records: asRecordArray(input.records),
    stage_map: input.stage_map ?? undefined,
    offer_pin: coercePin(input.offer_pin),
  };
}

export function normalizeInput(
  raw: unknown,
  fallbackLocator: string,
): NormalizedInput {
  const input = coerceObservationSet(raw);
  const offer_pin = coercePin(input.offer_pin);
  const extra_historical = extraMarker(offer_pin);
  const observed_at = parseUtc(input.observed_at ?? null);
  const observed_at_iso =
    input.observed_at && observed_at
      ? input.observed_at
      : "1970-01-01T00:00:00Z";
  const source = coerceSource(input.source, fallbackLocator);
  const freshness_status = parseFreshness(input.freshness_status ?? "FRESH");
  const confidence = clampConfidence(input.confidence);
  const stageMap: StageMap = { ...DEFAULT_STAGE_MAP, ...(input.stage_map ?? {}) };
  const all = asRecordArray(input.records);
  const tasks = all.filter((r) => r.entity === "task");
  const commercial = all.filter((r) => r.entity !== "task");

  const records: NormalizedRecord[] = commercial
    .map((record) => {
      const amount = resolveAmount(record);
      const prob = resolveProbability(record);
      const extra =
        amount.amount_cents === extra_historical.amount_cents &&
        (amount.currency ?? DEFAULT_CURRENCY) === extra_historical.currency;
      return {
        id: record.id,
        entity: record.entity,
        funnel: classifyFunnel(record, stageMap),
        status: (record.status ?? "").toLowerCase(),
        amount_cents: amount.amount_cents,
        currency: amount.currency,
        probability: prob.probability,
        probability_reliable: prob.probability_reliable,
        offer_id: typeof record.offer_id === "string" ? record.offer_id : null,
        offer_version:
          typeof record.offer_version === "string" ? record.offer_version : null,
        treated_as_catalog_offer: record.treated_as_catalog_offer === true,
        next_action:
          typeof record.next_action === "string" && record.next_action.length > 0
            ? record.next_action
            : null,
        next_action_at: parseUtc(record.next_action_at ?? record.due_date ?? null),
        last_activity_at: parseUtc(record.last_activity_at ?? record.updated_at ?? null),
        stage_entered_at: parseUtc(record.stage_entered_at ?? null),
        expected_close_at: parseUtc(record.expected_close_at ?? null),
        created_at: parseUtc(record.created_at ?? null),
        updated_at: parseUtc(record.updated_at ?? null),
        observed_at: parseUtc(record.observed_at ?? input.observed_at ?? null),
        freshness_status: parseFreshness(
          record.freshness_status ?? input.freshness_status ?? "FRESH",
        ),
        confidence: clampConfidence(record.confidence ?? input.confidence),
        stage_name: record.stage_name ?? record.stage_id ?? null,
        extra_historical_cents: extra,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  attachTaskNextActions(records, tasks);

  return {
    observed_at,
    observed_at_iso,
    source,
    freshness_status,
    confidence,
    records,
    offer_pin,
    extra_historical,
  };
}

export function isOpenPipeline(record: NormalizedRecord): boolean {
  if (record.funnel === "lost" || record.funnel === "clientes") {
    return false;
  }
  if (record.funnel === "unclassified") {
    return false;
  }
  if (record.status === "won" || LOST.has(record.status)) {
    return false;
  }
  return true;
}
