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
 * It lives in its own module so the renderer can ask whether a confirmation is
 * armed without importing the app shell that binds the forms. The renderer must
 * read the same cell the binder writes: deriving "a confirmation is pending"
 * from the last result instead would go stale the moment the operator's last
 * act was some *other* action, and the surface would claim there is nothing to
 * confirm while the next resume submit executes immediately.
 */

let pendingResumeToken: string | undefined;

/** Exposed for tests and for an explicit abandon. */
export function clearPendingResumeConfirmation(): void {
  pendingResumeToken = undefined;
}

export function pendingResumeConfirmation(): string | undefined {
  return pendingResumeToken;
}

export function armPendingResumeConfirmation(token: string): void {
  pendingResumeToken = token;
}

/** True when a resume submit would execute rather than mint a fresh challenge. */
export function resumeConfirmationIsArmed(): boolean {
  return pendingResumeToken !== undefined;
}
