/**
 * Pending `resume_dispatch` confirmation, held across repaints.
 *
 * Deliberately module scope, not a per-binding closure. Every successful action
 * repaints the shell, and a repaint replaces `root.innerHTML` wholesale — so a
 * token parked in the closure of the form that minted it dies with that form,
 * and the following submit would mint a second challenge instead of spending
 * the first. That is not a stricter two-step; it is a resume that can never
 * complete.
 *
 * It is still memory only and never persisted, so a reload loses it and forces
 * a fresh confirmation. A repaint is not a reload.
 *
 * The pending cell carries more than the opaque token. A confirmation is only
 * valid for the exact audit reason and dispatch observation shown when it was
 * requested. The binder also re-reads that observation before releasing the
 * kill switch, so a pause, another intervention, or an upstream state change
 * cannot reuse an obsolete challenge.
 */

import type { CommercialSnapshot } from "./types";

export interface PendingResumeConfirmation {
  token: string;
  reason: string;
  observation_fingerprint: string;
}

let pendingResume: PendingResumeConfirmation | undefined;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function observed(value: unknown): string | number | boolean | null {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? value
    : null;
}

/**
 * Stable fingerprint of every dispatch reading used by the resume impact box.
 * Provenance is included: the same values from a newer collection are a new
 * observation and therefore require a new deliberate confirmation.
 */
export function resumeObservationFingerprint(snapshot: CommercialSnapshot | undefined): string {
  const dispatch = record(record(snapshot?.operations).dispatch);
  return JSON.stringify({
    observed_at: snapshot?.provenance.observed_at ?? null,
    freshness_status: snapshot?.provenance.freshness_status ?? null,
    state: observed(dispatch.state),
    observed: dispatch.observed === true,
    pause_reason: observed(dispatch.pause_reason),
    window_start: observed(dispatch.window_start),
    window_end: observed(dispatch.window_end),
    timezone: observed(dispatch.timezone),
    in_send_window: observed(dispatch.in_send_window),
    next_slot_at: observed(dispatch.next_slot_at),
    queued_approved: observed(dispatch.queued_approved),
    sent_last_hour: observed(dispatch.sent_last_hour),
    cap: observed(dispatch.cap),
  });
}

/** Exposed for tests and for an explicit abandon. */
export function clearPendingResumeConfirmation(): void {
  pendingResume = undefined;
}

export function pendingResumeConfirmation(): PendingResumeConfirmation | undefined {
  return pendingResume ? { ...pendingResume } : undefined;
}

export function armPendingResumeConfirmation(input: PendingResumeConfirmation): void {
  pendingResume = { ...input, reason: input.reason.trim() };
}

/** True when a resume submit would execute rather than mint a fresh challenge. */
export function resumeConfirmationIsArmed(observationFingerprint?: string): boolean {
  return (
    pendingResume !== undefined &&
    (observationFingerprint === undefined ||
      pendingResume.observation_fingerprint === observationFingerprint)
  );
}
