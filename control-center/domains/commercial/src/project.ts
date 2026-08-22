import { toUtcIso } from "./clock.ts";
import {
  AGING_MS,
  ATTENTION_NOW_LIMIT,
  CONVERSION_WINDOW_MS,
  DEFAULT_CURRENCY,
  FRESHNESS_WINDOW_SECONDS,
  FUNNEL_KEYS,
  STALL_MS,
  SUMMARY_SCHEMA_VERSION,
  type AggregatedFigure,
  type AttentionItem,
  type AttentionKind,
  type AttentionSeverity,
  type CommercialObservationSet,
  type CommercialSummary,
  type ExceptionRow,
  type FreshnessStatus,
  type FunnelKey,
  type PipelineMoney,
  type ProjectOptions,
  type Provenance,
  type SourceRef,
} from "./contracts.ts";
import {
  classifyFreshness,
  rollupFreshness,
} from "./freshness.ts";
import { weightedCentsExact } from "./money.ts";
import {
  isOpenPipeline,
  normalizeInput,
  type NormalizedInput,
  type NormalizedRecord,
} from "./normalize.ts";

const KIND_RANK: Record<AttentionKind, number> = {
  extra_historical_as_offer: 0,
  unknown_offer_id: 1,
  offer_version_drift: 2,
  missing_next_action: 3,
  stalled_stage: 4,
  conversion_window_gap: 5,
  aging: 6,
};

const SEVERITY_RANK: Record<AttentionSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function attentionId(kind: AttentionKind, recordId: string): string {
  const slug = `${kind}-${recordId}`.replace(/[^A-Za-z0-9._~-]+/g, "-");
  return `cc:attention-item:${slug}`;
}

function provenanceFor(
  source: SourceRef,
  observedAtIso: string,
  freshness: FreshnessStatus,
  confidence: number | undefined,
): Provenance {
  const p: Provenance = {
    source,
    observed_at: observedAtIso,
    freshness_status: freshness,
  };
  if (confidence !== undefined) {
    p.confidence = confidence;
  }
  p.freshness_window_seconds = FRESHNESS_WINDOW_SECONDS;
  return p;
}

function figure(
  key: string,
  value: number,
  source: SourceRef,
  observedAtIso: string,
  freshness: FreshnessStatus,
  confidence: number | undefined,
): AggregatedFigure {
  const f: AggregatedFigure = {
    key,
    value,
    source,
    observed_at: observedAtIso,
    freshness_status: freshness,
  };
  if (confidence !== undefined) {
    f.confidence = confidence;
  }
  return f;
}

function buildFunnel(
  records: NormalizedRecord[],
  source: SourceRef,
  observedAtIso: string,
  freshness: FreshnessStatus,
  confidence: number | undefined,
): { funnel: Record<FunnelKey, AggregatedFigure>; unclassified: AggregatedFigure } {
  const counts: Record<FunnelKey, number> = {
    novos_leads: 0,
    qualificados: 0,
    oportunidades: 0,
    propostas: 0,
    clientes: 0,
  };
  let unclassified = 0;
  for (const rec of records) {
    if (rec.funnel === "lost") {
      continue;
    }
    if (rec.funnel === "unclassified") {
      unclassified += 1;
      continue;
    }
    counts[rec.funnel] += 1;
  }
  const funnel = {} as Record<FunnelKey, AggregatedFigure>;
  for (const key of FUNNEL_KEYS) {
    funnel[key] = figure(
      key,
      counts[key],
      source,
      observedAtIso,
      freshness,
      confidence,
    );
  }
  return {
    funnel,
    unclassified: figure(
      "unclassified",
      unclassified,
      source,
      observedAtIso,
      freshness,
      confidence,
    ),
  };
}

function buildPipeline(
  records: NormalizedRecord[],
  source: SourceRef,
  observedAtIso: string,
  freshness: FreshnessStatus,
  confidence: number | undefined,
): { nominal: PipelineMoney; weighted: PipelineMoney } {
  const open = records.filter(isOpenPipeline);
  const baseProv = provenanceFor(source, observedAtIso, freshness, confidence);

  if (open.length === 0) {
    return {
      // No open record contributed a denominated amount, so there is nothing to
      // state a currency in. A zero stamped with the catalog currency would read
      // as a measured "BRL 0,00"; the honest answer is that there is no data.
      nominal: {
        treatment: "insufficient_data",
        reason: "no_open_pipeline",
        provenance: baseProv,
      },
      weighted: {
        treatment: "insufficient_data",
        reason: "no_open_pipeline_probabilities",
        provenance: baseProv,
      },
    };
  }

  const known = open.filter((r) => r.amount_cents !== null);
  // An amount whose stated currency could not be read is undenominated. It is
  // not folded into the catalog currency: that would hide a bad code inside a
  // total that then looks like one clean BRL figure.
  const undenominated = known.filter((r) => r.currency === null);
  const currencies = new Set(
    known.filter((r) => r.currency !== null).map((r) => r.currency as string),
  );

  let nominal: PipelineMoney;
  if (known.length === 0 || undenominated.length > 0 || currencies.size !== 1) {
    nominal = {
      treatment: "insufficient_data",
      reason:
        known.length === 0
          ? "no_known_amounts"
          : undenominated.length > 0
            ? "unreadable_currency"
            : "mixed_currency",
      provenance: baseProv,
    };
  } else {
    const currency = [...currencies][0] ?? DEFAULT_CURRENCY;
    let cents = 0;
    for (const r of known) {
      cents += r.amount_cents as number;
    }
    const conf =
      known.length === open.length
        ? confidence
        : Math.min(confidence ?? 1, 0.5);
    nominal = {
      treatment: "present",
      amount_cents: cents,
      currency,
      provenance: provenanceFor(source, observedAtIso, freshness, conf),
    };
  }

  const allReliable =
    open.length > 0 &&
    open.every(
      (r) =>
        r.amount_cents !== null &&
        r.probability_reliable &&
        r.probability !== null,
    );

  let weighted: PipelineMoney;
  if (!allReliable) {
    weighted = {
      treatment: "insufficient_data",
      reason: "probabilities_missing_or_unreliable",
      provenance: baseProv,
    };
  } else if (currencies.size !== 1) {
    weighted = {
      treatment: "insufficient_data",
      reason: "mixed_currency",
      provenance: baseProv,
    };
  } else {
    const currency = [...currencies][0] ?? DEFAULT_CURRENCY;
    let cents = 0;
    let exact = true;
    for (const r of open) {
      const w = weightedCentsExact(r.amount_cents as number, r.probability as number);
      if (w === null) {
        exact = false;
        break;
      }
      cents += w;
    }
    if (!exact) {
      weighted = {
        treatment: "insufficient_data",
        reason: "weighted_cents_not_integer",
        provenance: baseProv,
      };
    } else {
      weighted = {
        treatment: "present",
        amount_cents: cents,
        currency,
        provenance: baseProv,
      };
    }
  }

  return { nominal, weighted };
}

function offerExceptions(
  rec: NormalizedRecord,
  input: NormalizedInput,
  nowIso: string,
  freshness: FreshnessStatus,
): ExceptionRow[] {
  const rows: ExceptionRow[] = [];
  const pin = input.offer_pin;
  const extra = input.extra_historical;
  const source: SourceRef = {
    system: "warmbly",
    kind: "offer-discrepancy",
    locator: rec.id,
  };
  const prov = provenanceFor(source, rec.observed_at ? toUtcIso(rec.observed_at) : nowIso, freshness, rec.confidence);

  const offerId = rec.offer_id;
  const known = offerId
    ? pin.known_offers.find((o) => o.offer_id === offerId)
    : undefined;
  const extraAsOfferId =
    offerId === extra.exception_id ||
    offerId === String(extra.amount_cents) ||
    offerId === "1000000";

  if (rec.extra_historical_cents && (rec.treated_as_catalog_offer || extraAsOfferId || Boolean(known))) {
    rows.push({
      id: attentionId("extra_historical_as_offer", rec.id),
      kind: "extra_historical_as_offer",
      record_id: rec.id,
      severity: "critical",
      title: "Extra historical amount treated as catalog offer",
      summary:
        "Amount 1000000 cents is the private Extra historical contract, not a Governance catalog offer.",
      recommended_action:
        "Remove catalog offer_id from this record; keep Extra as a private exception.",
      provenance: prov,
    });
  } else if (extraAsOfferId) {
    rows.push({
      id: attentionId("extra_historical_as_offer", rec.id),
      kind: "extra_historical_as_offer",
      record_id: rec.id,
      severity: "critical",
      title: "Extra historical identifier used as offer_id",
      summary:
        "CFG-EXC-EXTRA-HISTORICAL-v1 / 1000000 is not an offer. Governance pin lists it under not_an_offer.",
      recommended_action: "Stop treating Extra historical as a catalog SKU.",
      provenance: prov,
    });
  }

  if (offerId && !extraAsOfferId && !known && rec.treated_as_catalog_offer) {
    rows.push({
      id: attentionId("unknown_offer_id", rec.id),
      kind: "unknown_offer_id",
      record_id: rec.id,
      severity: "high",
      title: `Unknown offer_id ${offerId}`,
      summary:
        "Warmbly record references an offer_id that is not on the Governance pin.",
      recommended_action: "Align Warmbly offer_id with the Governance pin or clear it.",
      provenance: prov,
    });
  } else if (offerId && !extraAsOfferId && !known && offerId.startsWith("CFG-")) {
    rows.push({
      id: attentionId("unknown_offer_id", rec.id),
      kind: "unknown_offer_id",
      record_id: rec.id,
      severity: "high",
      title: `Unknown offer_id ${offerId}`,
      summary:
        "Warmbly record references an offer_id that is not on the Governance pin.",
      recommended_action: "Align Warmbly offer_id with the Governance pin or clear it.",
      provenance: prov,
    });
  }

  if (known) {
    if (!rec.offer_version || rec.offer_version !== known.offer_version) {
      rows.push({
        id: attentionId("offer_version_drift", rec.id),
        kind: "offer_version_drift",
        record_id: rec.id,
        severity: "high",
        title: `Offer version drift on ${offerId}`,
        summary: `Pin version ${known.offer_version}; Warmbly has ${rec.offer_version ?? "UNKNOWN"}.`,
        recommended_action: "Re-pin Warmbly to the Governance offer_version.",
        provenance: prov,
      });
    }
  }

  return rows;
}

function operationalExceptions(
  rec: NormalizedRecord,
  now: Date,
  nowIso: string,
  freshness: FreshnessStatus,
): ExceptionRow[] {
  if (!isOpenPipeline(rec)) {
    return [];
  }
  const rows: ExceptionRow[] = [];
  const source: SourceRef = {
    system: "warmbly",
    kind: "commercial-record",
    locator: rec.id,
  };
  const prov = provenanceFor(
    source,
    rec.observed_at ? toUtcIso(rec.observed_at) : nowIso,
    freshness,
    rec.confidence,
  );

  if (!rec.next_action && !rec.next_action_at) {
    rows.push({
      id: attentionId("missing_next_action", rec.id),
      kind: "missing_next_action",
      record_id: rec.id,
      severity: "high",
      title: `Missing next action on ${rec.id}`,
      summary: "Open commercial record has no next_action and no next_action_at.",
      recommended_action: "Set a next action before the record ages further.",
      provenance: prov,
    });
  }

  const stageAnchor = rec.stage_entered_at ?? rec.updated_at ?? rec.last_activity_at;
  if (stageAnchor && now.getTime() - stageAnchor.getTime() >= STALL_MS) {
    rows.push({
      id: attentionId("stalled_stage", rec.id),
      kind: "stalled_stage",
      record_id: rec.id,
      severity: "high",
      title: `Stalled stage on ${rec.id}`,
      summary: "Open record has not changed stage within the stall window (14 days).",
      recommended_action: "Move the stage or close the record.",
      provenance: prov,
    });
  }

  const conversionAnchor = rec.expected_close_at;
  const ageAnchor = rec.stage_entered_at ?? rec.created_at;
  const pastClose = Boolean(conversionAnchor && conversionAnchor.getTime() < now.getTime());
  const overWindow =
    Boolean(ageAnchor && now.getTime() - ageAnchor.getTime() >= CONVERSION_WINDOW_MS) &&
    (rec.funnel === "propostas" || rec.funnel === "oportunidades");
  if (pastClose || overWindow) {
    rows.push({
      id: attentionId("conversion_window_gap", rec.id),
      kind: "conversion_window_gap",
      record_id: rec.id,
      severity: "medium",
      title: `Conversion window gap on ${rec.id}`,
      summary: pastClose
        ? "expected_close_at is in the past while the record is still open."
        : "Open opportunity/proposal exceeded the 30-day conversion window.",
      recommended_action: "Re-forecast the close date or close the record.",
      provenance: prov,
    });
  }

  const activity = rec.last_activity_at ?? rec.updated_at;
  if (activity && now.getTime() - activity.getTime() >= AGING_MS) {
    rows.push({
      id: attentionId("aging", rec.id),
      kind: "aging",
      record_id: rec.id,
      severity: "medium",
      title: `Aging record ${rec.id}`,
      summary: "No commercial activity within 14 days.",
      recommended_action: "Touch the record or park it.",
      provenance: prov,
    });
  }

  return rows;
}

function collectExceptions(
  input: NormalizedInput,
  now: Date,
  nowIso: string,
  freshness: FreshnessStatus,
): ExceptionRow[] {
  const rows: ExceptionRow[] = [];
  for (const rec of input.records) {
    rows.push(...offerExceptions(rec, input, nowIso, freshness));
    rows.push(...operationalExceptions(rec, now, nowIso, freshness));
  }
  rows.sort((a, b) => {
    const k = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (k !== 0) {
      return k;
    }
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (s !== 0) {
      return s;
    }
    return a.id.localeCompare(b.id);
  });
  return rows;
}

function selectAttention(exceptions: ExceptionRow[]): AttentionItem[] {
  const byRecord = new Map<string, ExceptionRow>();
  for (const row of exceptions) {
    const existing = byRecord.get(row.record_id);
    if (!existing) {
      byRecord.set(row.record_id, row);
      continue;
    }
    const better =
      KIND_RANK[row.kind] < KIND_RANK[existing.kind] ||
      (KIND_RANK[row.kind] === KIND_RANK[existing.kind] &&
        SEVERITY_RANK[row.severity] < SEVERITY_RANK[existing.severity]);
    if (better) {
      byRecord.set(row.record_id, row);
    }
  }
  const ranked = [...byRecord.values()].sort((a, b) => {
    const k = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (k !== 0) {
      return k;
    }
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (s !== 0) {
      return s;
    }
    return a.id.localeCompare(b.id);
  });
  return ranked.slice(0, ATTENTION_NOW_LIMIT).map((row) => ({
    id: row.id,
    kind: row.kind,
    record_id: row.record_id,
    severity: row.severity,
    horizon: "now",
    title: row.title,
    summary: row.summary,
    recommended_action: row.recommended_action,
    provenance: row.provenance,
  }));
}

function aggregateConfidence(
  input: NormalizedInput,
  unclassifiedCount: number,
): number | undefined {
  if (input.records.length === 0) {
    return 0;
  }
  if (input.confidence !== undefined) {
    return unclassifiedCount > 0
      ? Math.min(input.confidence, 0.5)
      : input.confidence;
  }
  const classified = input.records.length - unclassifiedCount;
  return classified / input.records.length;
}

/**
 * Shipped projection: Warmbly-shaped observations + Governance offer pin
 * → one-screen commercial summary. Pure. Never mutates Warmbly or Asaas.
 */
export function projectCommercialSummary(
  raw: CommercialObservationSet | unknown,
  opts: ProjectOptions = {},
): CommercialSummary {
  const input = normalizeInput(raw, "fixture");
  const now =
    opts.now ??
    input.observed_at ??
    new Date("1970-01-01T00:00:00Z");
  const generated_at = toUtcIso(now);
  const observedIso = input.observed_at
    ? toUtcIso(input.observed_at)
    : input.observed_at_iso;

  const recordFreshness = input.records.map((r) =>
    classifyFreshness(r.observed_at, now, r.freshness_status),
  );
  recordFreshness.push(
    classifyFreshness(input.observed_at, now, input.freshness_status),
  );
  const freshness = rollupFreshness(recordFreshness);

  const { funnel, unclassified } = buildFunnel(
    input.records,
    input.source,
    observedIso,
    freshness,
    undefined,
  );
  const confidence = aggregateConfidence(input, unclassified.value);
  for (const key of FUNNEL_KEYS) {
    const current = funnel[key];
    funnel[key] = {
      ...current,
      ...(confidence !== undefined ? { confidence } : {}),
    };
  }
  if (confidence !== undefined) {
    unclassified.confidence = confidence;
  }

  const pipeline = buildPipeline(
    input.records,
    input.source,
    observedIso,
    freshness,
    confidence,
  );
  const exceptions = collectExceptions(input, now, observedIso, freshness);
  const attentionItems = selectAttention(exceptions);

  const pinObserved =
    input.offer_pin.observed_at ?? observedIso;

  return {
    schema_version: SUMMARY_SCHEMA_VERSION,
    scope: "commercial",
    generated_at,
    authority: {
      catalog_authority: "governance",
      commercial_runtime: "warmbly",
      this_document: "read_model",
      offer_pin: {
        authority_id: input.offer_pin.authority_id,
        catalog_id: input.offer_pin.catalog_id,
        pin_observed_at: pinObserved,
      },
    },
    provenance: provenanceFor(input.source, observedIso, freshness, confidence),
    funnel,
    pipeline,
    exceptions,
    attention: {
      horizon: "now",
      items: attentionItems,
    },
    unclassified,
  };
}

export function attentionSlice(summary: CommercialSummary): Array<{
  id: string;
  kind: AttentionKind;
  record_id: string;
}> {
  return summary.attention.items.map((item) => ({
    id: item.id,
    kind: item.kind,
    record_id: item.record_id,
  }));
}
