/**
 * The review queue: what is still work, what is already decided, and what this
 * browser decided a moment ago and has not seen confirmed yet.
 *
 * Revisão used to render every candidate of a version in payload order, decided
 * or not. At five candidates that is merely untidy; at fifty it is the reviewer
 * scrolling past their own finished work to find the next thing to do. The
 * default recorte is therefore `pendentes`, and an approval leaves that recorte
 * the moment it is registered.
 *
 * Two rules keep the optimistic layer honest:
 *
 * 1. A local mark is only ever *set* by an action this browser took, and only
 *    for the exact version and candidate it took it on.
 * 2. A local mark survives a repaint until it is rolled back, so a slow or
 *    stale server read can never resurrect an approved message as pending —
 *    which is the one failure mode that would get a message approved twice.
 *
 * Nothing here is durable: a reload drops every local mark and the surface goes
 * back to reading the server. That is deliberate. The server is the record; this
 * is only the gap between the click and the confirmation.
 */

/** Where a candidate stands as far as the human queue is concerned. */
export const REVIEW_QUEUE_STATES = ["pendente", "aprovado", "ajuste"] as const;
export type ReviewQueueState = (typeof REVIEW_QUEUE_STATES)[number];

/** The recortes a reviewer can ask for. `pendentes` is the operational default. */
export const REVIEW_QUEUE_FILTERS = ["pendentes", "aprovadas", "ajuste", "todas"] as const;
export type ReviewQueueFilter = (typeof REVIEW_QUEUE_FILTERS)[number];

export const DEFAULT_REVIEW_QUEUE_FILTER: ReviewQueueFilter = "pendentes";

/** URL parameter that carries the recorte, so it survives the wholesale repaint. */
export const REVIEW_QUEUE_PARAM = "estado";

export const REVIEW_QUEUE_FILTER_LABELS: Record<ReviewQueueFilter, string> = {
  pendentes: "Pendentes",
  aprovadas: "Aprovadas",
  ajuste: "Ajuste ou rejeitadas",
  todas: "Todas",
};

export function resolveReviewQueueFilter(raw: string | null | undefined): ReviewQueueFilter {
  return REVIEW_QUEUE_FILTERS.includes(raw as ReviewQueueFilter)
    ? (raw as ReviewQueueFilter)
    : DEFAULT_REVIEW_QUEUE_FILTER;
}

export function reviewQueueFilterMatches(
  filter: ReviewQueueFilter,
  state: ReviewQueueState,
): boolean {
  switch (filter) {
    case "pendentes":
      return state === "pendente";
    case "aprovadas":
      return state === "aprovado";
    case "ajuste":
      return state === "ajuste";
    case "todas":
      return true;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * The server's own verdict on this candidate, and nothing inferred.
 *
 * An APPROVE the server itself marks `effective: false` was invalidated by
 * drift — recipient, copy, policy or evidence moved under it — so it is work
 * again, and hiding it from the pending recorte would hide exactly the message
 * that has to be re-decided before GO. HOLD and REJECT carry no `effective`
 * flag of their own: they are decisions, not authorisations.
 */
export function serverReviewState(candidate: Record<string, unknown>): ReviewQueueState {
  const review = record(candidate.review);
  const decision = typeof review.decision === "string" ? review.decision.toUpperCase() : "";
  if (decision === "APPROVE") return review.effective === false ? "pendente" : "aprovado";
  if (decision === "HOLD" || decision === "REJECT") return "ajuste";
  return "pendente";
}

/* ------------------------------------------------------------------ *
 * Optimistic layer.
 * ------------------------------------------------------------------ */

const decided = new Map<string, ReviewQueueState>();

function markKey(cohortId: string, candidateId: string): string {
  return `${cohortId} ${candidateId}`;
}

/** Records what this browser just decided, before the server has confirmed it. */
export function markReviewDecided(
  cohortId: string,
  candidateId: string,
  state: ReviewQueueState,
): void {
  if (!cohortId || !candidateId) return;
  decided.set(markKey(cohortId, candidateId), state);
}

/**
 * Undoes a local mark.
 *
 * Called on every outcome that is not a confirmed application — a refusal, a
 * failure, and deliberately also an `unknown`. "Pode ter sido aplicada" is not
 * "foi aplicada", and the safe side of that doubt is the message staying in the
 * queue with the outcome banner on it: retrying replays the same idempotency
 * key, so the server, not this screen, decides whether it is a second write.
 */
export function rollbackReviewDecided(cohortId: string, candidateId: string): void {
  decided.delete(markKey(cohortId, candidateId));
}

export function decidedReviewState(
  cohortId: string,
  candidateId: string,
): ReviewQueueState | undefined {
  return decided.get(markKey(cohortId, candidateId));
}

/** Test seam, and the only way to forget every mark at once. */
export function resetReviewQueue(): void {
  decided.clear();
}

export interface ReviewQueueReading {
  state: ReviewQueueState;
  /** True when the state shown came from this browser, not from the payload. */
  optimistic: boolean;
}

/**
 * The state the queue renders: the local mark when there is one, the server's
 * verdict otherwise.
 *
 * The local mark wins even when the payload disagrees, and only until it is
 * rolled back. A read that has not caught up yet must not put an approved
 * message back in front of the reviewer.
 */
export function reviewQueueState(
  cohortId: string,
  candidate: Record<string, unknown>,
): ReviewQueueReading {
  const candidateId = typeof candidate.candidate_id === "string" ? candidate.candidate_id : "";
  const local = candidateId ? decidedReviewState(cohortId, candidateId) : undefined;
  const server = serverReviewState(candidate);
  if (local === undefined) return { state: server, optimistic: false };
  return { state: local, optimistic: local !== server };
}

export interface ReviewQueueCounts {
  pendentes: number;
  aprovadas: number;
  ajuste: number;
  total: number;
}

export function reviewQueueCounts(
  cohortId: string,
  candidates: readonly Record<string, unknown>[],
): ReviewQueueCounts {
  const counts: ReviewQueueCounts = {
    pendentes: 0,
    aprovadas: 0,
    ajuste: 0,
    total: candidates.length,
  };
  for (const candidate of candidates) {
    const { state } = reviewQueueState(cohortId, candidate);
    if (state === "pendente") counts.pendentes += 1;
    else if (state === "aprovado") counts.aprovadas += 1;
    else counts.ajuste += 1;
  }
  return counts;
}
