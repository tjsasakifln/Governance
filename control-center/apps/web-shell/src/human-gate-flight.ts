/**
 * Ephemeral state of a human-gate submission, parked at module scope.
 *
 * The shell repaints by replacing `root.innerHTML` wholesale, so anything kept
 * in the closure of the form that started a write dies before the paint that
 * has to render its outcome. `warmbly-confirmation.ts` exists for the same
 * reason; this module is its sibling for the cohort gate.
 *
 * Nothing here is durable and nothing here reaches storage: a reload is a
 * deliberate act that clears an in-flight marker and an unconfirmed draft. The
 * idempotency key — the one thing that *must* survive a retry — lives in
 * `human-gate-idempotency.ts` instead.
 */

/** Draft of an adjust, held between the preview step and the confirmation. */
export interface AdjustDraft {
  cohort_id: string;
  candidate_id: string;
  subject: string;
  body_text: string;
  reason: string;
  /** Frozen content the operator was shown, so the diff is against what they read. */
  before_subject: string;
  before_body_text: string;
  /** Version the operator confirmed against, replayed verbatim as `v<n>`. */
  version: string;
  /** Frozen hash of the candidate as rendered. Sent as `expected_frozen_hash`. */
  frozen_hash: string;
}

const inFlight = new Set<string>();
const drafts = new Map<string, AdjustDraft>();
let adjustRouteAbsent = false;

/**
 * Claims a form for one submission.
 *
 * Returns false when that same form is already waiting on the channel. A gate
 * write is not idempotent-by-accident: a second POST of "create" mints a second
 * cohort, and a double-click on a trackpad is one operator intent, not two.
 */
export function beginGateFlight(key: string): boolean {
  if (key === "" || inFlight.has(key)) return false;
  inFlight.add(key);
  return true;
}

export function endGateFlight(key: string): void {
  inFlight.delete(key);
}

export function gateInFlight(key: string): boolean {
  return inFlight.has(key);
}

export function anyGateInFlight(): boolean {
  return inFlight.size > 0;
}

/**
 * Records that the channel answered 404 for the adjust route.
 *
 * The backend lands in a parallel workstream, so an install without it is an
 * expected state, not a defect. Remembering the refusal keeps the UI from
 * offering a control that provably cannot work in this deployment.
 */
export function markAdjustRouteMissing(): void {
  adjustRouteAbsent = true;
}

export function adjustRouteMissing(): boolean {
  return adjustRouteAbsent;
}

export function setAdjustDraft(draft: AdjustDraft): void {
  drafts.set(draft.candidate_id, draft);
}

export function adjustDraft(candidateId: string): AdjustDraft | undefined {
  return drafts.get(candidateId);
}

export function clearAdjustDraft(candidateId: string): void {
  drafts.delete(candidateId);
}

/** Test seam. Production never needs to forget all of this at once. */
export function resetGateFlight(): void {
  inFlight.clear();
  drafts.clear();
  adjustRouteAbsent = false;
}
