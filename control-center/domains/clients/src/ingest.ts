import {
  SOURCE_DERIVED_DUE_DATES,
  SOURCE_DERIVED_NEXT_ACTION,
  clientScope,
  clientStatusId,
  type Blocker,
  type ClientStatus,
  type Commitment,
  type Deliverable,
  type DueDate,
  type NextAction,
  type Risk,
} from "./contract.js";
import { toUtcIso } from "./clock.js";
import {
  classifyCommitment,
  isMaterialRisk,
  isOpenBlocker,
  lifecycleFromHealth,
  scoreAccountHealth,
} from "./health.js";
import type { ClientStatusRepository } from "./store.js";
import { parseIngestInput, type IngestDraft } from "./validate.js";

export interface IngestOptions {
  now: Date;
  store: ClientStatusRepository;
}

/**
 * Validate + build + upsert. Older envelope `observed_at` does not overwrite
 * a newer stored snapshot (collector idempotency).
 */
export function ingestClientStatus(raw: unknown, options: IngestOptions): ClientStatus {
  const draft = parseIngestInput(raw);
  const built = buildClientStatus(draft, options.now);
  const existing = options.store.getBySlug(built.client_slug);
  if (
    existing !== undefined &&
    Date.parse(draft.provenance.observed_at) < Date.parse(existing.provenance.observed_at)
  ) {
    return existing;
  }
  options.store.upsert(built);
  return built;
}

export function buildClientStatus(draft: IngestDraft, now: Date): ClientStatus {
  const commitments = sortById(draft.commitments);
  const blockers = sortById(draft.blockers);
  const deliverables = sortById(draft.deliverables);
  const risk = sortBySeverityThenId(draft.risk);

  const health = scoreAccountHealth({ commitments, blockers, risk, deliverables }, now);
  const nextAction = draft.next_action ?? deriveNextAction({ commitments, blockers, risk }, now);
  const dueDates = buildDueDates(commitments, deliverables);

  return {
    schema_version: "control-center.client-status.v1",
    id: clientStatusId(draft.client_slug),
    scope: clientScope(draft.client_slug),
    client_slug: draft.client_slug,
    display_name: draft.display_name,
    lifecycle: lifecycleFromHealth(health, risk),
    health,
    commitments,
    next_action: nextAction,
    due_dates: dueDates,
    blockers,
    deliverables,
    risk,
    provenance: draft.provenance,
  };
}

export function deriveNextAction(
  input: {
    commitments: readonly Commitment[];
    blockers: readonly Blocker[];
    risk: readonly Risk[];
  },
  now: Date,
): NextAction | null {
  const observedAt = toUtcIso(now);
  const derived = {
    source: SOURCE_DERIVED_NEXT_ACTION,
    observed_at: observedAt,
    freshness_status: "fresh" as const,
  };

  const openBlocker = [...input.blockers].filter(isOpenBlocker).sort((a, b) => a.id.localeCompare(b.id))[0];
  if (openBlocker) {
    return {
      summary: `Destravar bloqueio: ${openBlocker.title}`,
      due_at: null,
      owner: openBlocker.owner,
      provenance: derived,
    };
  }

  const overdue = [...input.commitments]
    .filter((item) => classifyCommitment(item, now) === "overdue")
    .sort((a, b) => a.due_at.localeCompare(b.due_at) || a.id.localeCompare(b.id))[0];
  if (overdue) {
    return {
      summary: `Cumprir compromisso vencido: ${overdue.title}`,
      due_at: overdue.due_at,
      owner: overdue.owner,
      provenance: derived,
    };
  }

  const dueSoon = [...input.commitments]
    .filter((item) => classifyCommitment(item, now) === "due_soon")
    .sort((a, b) => a.due_at.localeCompare(b.due_at) || a.id.localeCompare(b.id))[0];
  if (dueSoon) {
    return {
      summary: `Antecipar compromisso: ${dueSoon.title}`,
      due_at: dueSoon.due_at,
      owner: dueSoon.owner,
      provenance: derived,
    };
  }

  const material = [...input.risk]
    .filter(isMaterialRisk)
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  if (material) {
    return {
      summary: `Mitigar risco: ${material.title}`,
      due_at: null,
      owner: null,
      provenance: derived,
    };
  }

  return null;
}

function buildDueDates(commitments: Commitment[], deliverables: Deliverable[]): DueDate[] {
  const rows: DueDate[] = [];
  for (const commitment of commitments) {
    rows.push({
      kind: "commitment",
      ref: commitment.id,
      label: commitment.title,
      at: commitment.due_at,
      provenance: {
        source: SOURCE_DERIVED_DUE_DATES,
        observed_at: commitment.provenance.observed_at,
        freshness_status: commitment.provenance.freshness_status,
        ...(commitment.provenance.confidence !== undefined
          ? { confidence: commitment.provenance.confidence }
          : {}),
      },
    });
  }
  for (const deliverable of deliverables) {
    if (deliverable.due_at === null) {
      continue;
    }
    rows.push({
      kind: "deliverable",
      ref: deliverable.id,
      label: deliverable.title,
      at: deliverable.due_at,
      provenance: {
        source: SOURCE_DERIVED_DUE_DATES,
        observed_at: deliverable.provenance.observed_at,
        freshness_status: deliverable.provenance.freshness_status,
        ...(deliverable.provenance.confidence !== undefined
          ? { confidence: deliverable.provenance.confidence }
          : {}),
      },
    });
  }
  rows.sort((a, b) => a.at.localeCompare(b.at) || a.ref.localeCompare(b.ref));
  return rows;
}

function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

function sortBySeverityThenId(items: Risk[]): Risk[] {
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...items].sort((a, b) => rank[a.severity] - rank[b.severity] || a.id.localeCompare(b.id));
}
