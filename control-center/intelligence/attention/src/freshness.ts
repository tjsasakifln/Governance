import type { MergedSignal } from "./merge.js";
import type { EvidenceRef, Provenance } from "./types.js";

function slugFromId(id: string): string {
  const parts = id.split(":");
  const last = parts[parts.length - 1];
  return (last ?? id).replace(/[^A-Za-z0-9._~-]/g, "-").slice(0, 80);
}

function staleTitle(original: MergedSignal): string {
  return `Dados stale: ${original.title}`.slice(0, 200);
}

/**
 * Low freshness demotes the original via the freshness multiplier in scoring.
 * High-value (or any non-FRESH) observations also emit an explicit "dados stale"
 * work item so the founder sees a data-refresh action instead of silent decay.
 */
export function synthesizeDadosStale(
  original: MergedSignal,
  generated_at: string,
): MergedSignal | null {
  if (original.provenance.freshness_status === "FRESH") {
    return null;
  }
  const evidence: EvidenceRef[] = [
    {
      source: original.provenance.source,
      note: `freshness_status=${original.provenance.freshness_status} observed_at=${original.provenance.observed_at}`,
    },
    ...original.evidence_refs,
  ];
  const provenance: Provenance = {
    source: {
      system: "governance",
      kind: "attention-engine",
      locator: `dados-stale/${slugFromId(original.id)}`,
      label: "dados-stale",
    },
    observed_at: generated_at,
    freshness_status: "FRESH",
    confidence: 1,
  };
  const stale: MergedSignal = {
    id: `cc:attention-item:dados-stale-${slugFromId(original.id)}`,
    title: staleTitle(original),
    summary: `A observação de "${original.title}" está ${original.provenance.freshness_status} (observed_at ${original.provenance.observed_at}). O item original foi despromovido; atualize a fonte antes de decidir.`,
    category: "risco_operacional",
    domain: original.domain,
    scope: original.scope,
    impact: Math.max(40, Math.min(100, original.impact)),
    urgency: Math.max(50, original.urgency),
    severity: original.severity === "low" ? "medium" : original.severity,
    status: "open",
    correlation_key: `stale:${original.correlation_key}`,
    evidence_refs: evidence,
    provenance,
    related_ids: [original.id, ...original.source_ids],
    source_ids: [original.id, ...original.source_ids],
    merge_count: 1,
    item_kind: "dados_stale",
    source_freshness_status: original.provenance.freshness_status,
    recommended_action: `Atualizar dados da fonte ${original.provenance.source.system}:${original.provenance.source.kind} (${original.provenance.source.locator}).`,
  };
  return stale;
}

export function appendDadosStale(
  merged: MergedSignal[],
  generated_at: string,
): MergedSignal[] {
  const extra: MergedSignal[] = [];
  for (const item of merged) {
    const stale = synthesizeDadosStale(item, generated_at);
    if (stale) {
      extra.push(stale);
    }
  }
  return [...merged, ...extra];
}

export function isDadosStaleId(id: string): boolean {
  return id.startsWith("cc:attention-item:dados-stale-");
}

export function isDadosStaleTitle(title: string): boolean {
  return title.startsWith("Dados stale:");
}
