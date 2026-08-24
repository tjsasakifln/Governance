import type { MockScenario } from "./adapters/mock";
import type {
  AdapterWriteResult,
  ControlCenterReadAdapter,
  DestinationPage,
  GateReadback,
  WarmblyGateAction,
} from "./adapters/contract";
import { APPROVAL_DEFAULT_REASON, isWarmblyGateAction } from "./adapters/contract";
import { WARMBLY_DISPATCH_PATHS, type WriteShortcutKind } from "./adapters/paths";
import { parseHash } from "./destinations";
import { LIST_FORM_FIELDS, defaultParamValues, listHref, listSpecById } from "./filter";
import {
  beginGateFlight,
  clearAdjustDraft,
  endGateFlight,
  markAdjustRouteMissing,
  setAdjustDraft,
} from "./human-gate-flight";
import {
  humanGateIdempotencyKey,
  settleHumanGateIntent,
  type HumanGateIntent,
} from "./human-gate-idempotency";
import {
  armPendingResumeConfirmation,
  clearPendingResumeConfirmation as clearPendingResume,
  pendingResumeConfirmation as readPendingResume,
  resumeObservationFingerprint,
} from "./warmbly-confirmation";
import { pageIsEmpty, pageIsStale } from "./page";
import { markReviewDecided, rollbackReviewDecided } from "./review-queue";
import {
  QUEUE_FOCUS_PARAM,
  QUEUE_FOCUS_TOKEN_PATTERN,
  queueFocusDomId,
} from "./ui/lead-detail";
import { renderShell } from "./ui/render";
import {
  parseViewKind,
  resolveViewState,
  type ResolveViewInput,
  type ViewKind,
} from "./view-state";

export function scenarioFromView(view: ViewKind | null): MockScenario {
  if (view === "loading" || view === "error" || view === "stale" || view === "empty") {
    return view;
  }
  return "default";
}

export interface ShellRuntime {
  getHash(): string;
  setHash(hash: string): void;
  /** Replace URL state without firing a navigation/repaint. */
  replaceHash(hash: string): void;
  onHashChange(handler: () => void): () => void;
}

export function browserRuntime(): ShellRuntime {
  return {
    getHash(): string {
      return window.location.hash;
    },
    setHash(hash: string): void {
      window.location.hash = hash;
    },
    replaceHash(hash: string): void {
      window.history.replaceState(window.history.state, "", hash);
    },
    onHashChange(handler: () => void): () => void {
      window.addEventListener("hashchange", handler);
      return () => {
        window.removeEventListener("hashchange", handler);
      };
    },
  };
}

export function createMemoryRuntime(initialHash = "#/hoje"): ShellRuntime {
  let hash = initialHash;
  const listeners: Array<() => void> = [];
  return {
    getHash(): string {
      return hash;
    },
    setHash(next: string): void {
      hash = next;
      for (const listener of listeners) listener();
    },
    replaceHash(next: string): void {
      hash = next;
    },
    onHashChange(handler: () => void): () => void {
      listeners.push(handler);
      return () => {
        const index = listeners.indexOf(handler);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
  };
}

export interface MountableRoot {
  innerHTML: string;
  querySelectorAll?(selector: string): ArrayLike<{
    addEventListener(type: string, listener: (event: Event) => void): void;
    getAttribute(name: string): string | null;
    querySelector(selector: string): { value: string; checked?: boolean } | null;
    focus?(options?: { preventScroll?: boolean }): void;
    scrollIntoView?(options?: { block?: "center"; inline?: "nearest" }): void;
  }>;
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T>).then === "function";
}

function applyPaint(
  root: MountableRoot,
  adapter: ControlCenterReadAdapter & {
    setScenario?(s: MockScenario): void;
    getScenario?(): MockScenario;
  },
  parsed: ReturnType<typeof parseHash>,
  override: ReturnType<typeof parseViewKind>,
  result: import("./adapters/contract").AdapterReadResult,
  hash: string,
  navigate: Navigate,
  replaceLocation: ReplaceLocation,
): void {
  const input: ResolveViewInput<DestinationPage> = {
    loading: result.ok && result.loading,
    data: result.ok && !result.loading ? result.page : null,
    isEmpty: pageIsEmpty,
    isStale: pageIsStale,
    override,
  };
  if (!result.ok) {
    input.error = result.error;
  }
  const view = resolveViewState(input);
  // `focus` is an ephemeral return marker, never durable list state. Render
  // and bind against a cleaned location so pagination, filters and repaint
  // closures cannot resurrect it after it has been consumed.
  const renderHash = stripQueueFocus(hash);
  root.innerHTML = renderShell({
    destination: parsed.destination,
    viewKind: view.kind,
    view,
    mockScenario: adapter.getScenario?.() ?? adapter.mode,
    adapterMode: adapter.mode,
    surface: parsed.surface,
    resource: parsed.resource,
    query: queryOf(renderHash),
    hash: renderHash,
    ...(adapter.lastOperatorResult ? { operatorResult: adapter.lastOperatorResult } : {}),
  });
  const repaint = (): void => {
    paintShell(root, adapter, renderHash, 0, () => true, navigate, replaceLocation);
  };
  bindWriteShortcuts(root, adapter, repaint);
  bindOperatorActions(root, adapter, repaint);
  bindWarmblyDispatch(
    root,
    adapter,
    repaint,
    resumeObservationFingerprint(
      result.ok && !result.loading ? result.page?.commercial : undefined,
    ),
  );
  bindWarmblyHumanGate(root, adapter, repaint, navigate);
  bindReviewActions(root, adapter, repaint);
  bindWarmblyGateFilters(root, renderHash, navigate);
  bindMessageToggle(root, renderHash, navigate);
  bindCopyControls(root);
  bindListFilters(root, renderHash, navigate);
  bindReviewQueueShortcut();
  consumeQueueFocus(
    root,
    hash,
    view.kind === "ready" || view.kind === "stale",
    replaceLocation,
  );
  advanceReviewQueue(root, view.kind === "ready" || view.kind === "stale");
}

/**
 * Query string of a hash route, without the leading `?`.
 *
 * The shell repaints wholesale, so the only durable place for queue state —
 * filters, sort, page, position — is the hash itself. Surfaces that offer a
 * back link read it from here rather than from a closure that dies with the
 * markup that created it.
 */
export function queryOf(hash: string): string {
  const stripped = hash.startsWith("#") ? hash.slice(1) : hash;
  const index = stripped.indexOf("?");
  return index >= 0 ? stripped.slice(index + 1) : "";
}

export function stripQueueFocus(hash: string): string {
  const query = queryOf(hash);
  if (!query) return hash;
  const params = new URLSearchParams(query);
  if (!params.has(QUEUE_FOCUS_PARAM)) return hash;
  params.delete(QUEUE_FOCUS_PARAM);
  const rendered = params.toString();
  const path = hash.split("?", 1)[0] || "#/comercial/atividade";
  return rendered ? `${path}?${rendered}` : path;
}

/**
 * Copy buttons for technical-detail blocks.
 *
 * Joins the repaint pass like every other binding, because a handler attached
 * once would die on the first navigation. The block is a readonly textarea, so
 * a browser with no clipboard permission still lets the operator select and
 * copy by hand; this only removes the two keystrokes.
 */
function bindCopyControls(root: MountableRoot): void {
  if (typeof root.querySelectorAll !== "function") return;
  const forms = root.querySelectorAll("[data-copy-form]");
  for (let i = 0; i < forms.length; i += 1) {
    const form = forms[i];
    if (!form) continue;
    // Bind only what is really a copy form. A repaint re-runs every binder over
    // the same tree, so a binder that attaches to whatever the query hands back
    // would fight the operator-action binders for the same nodes.
    if (!form.getAttribute("data-copy-form")) continue;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const payload = form.querySelector('[name="copy_payload"]')?.value ?? "";
      if (!payload) return;
      const clipboard = globalThis.navigator?.clipboard;
      if (clipboard && typeof clipboard.writeText === "function") {
        void clipboard.writeText(payload).catch(() => undefined);
      }
    });
  }
}

export type Navigate = (hash: string) => void;
export type ReplaceLocation = (hash: string) => void;

function defaultNavigate(hash: string): void {
  if (typeof window !== "undefined") {
    window.location.hash = hash;
  }
}

function defaultReplaceLocation(hash: string): void {
  if (typeof window !== "undefined") {
    window.history.replaceState(window.history.state, "", hash);
  }
}

const consumedQueueFocus = new WeakMap<object, string>();

/** Focus a returned queue row once the ready/stale paint contains it. */
export function consumeQueueFocus(
  root: MountableRoot,
  hash: string,
  painted: boolean,
  replaceLocation: ReplaceLocation = defaultReplaceLocation,
): boolean {
  if (!painted || typeof root.querySelectorAll !== "function") return false;
  const params = new URLSearchParams(queryOf(hash));
  const token = params.get(QUEUE_FOCUS_PARAM);
  if (!token) {
    consumedQueueFocus.delete(root);
    return false;
  }
  if (consumedQueueFocus.get(root) === hash) return false;
  consumedQueueFocus.set(root, hash);
  replaceLocation(stripQueueFocus(hash));

  const focusFallback = (): void => {
    const fallback = root.querySelectorAll?.("[data-list-count]")[0];
    fallback?.focus?.({ preventScroll: true });
    fallback?.scrollIntoView?.({ block: "center", inline: "nearest" });
  };
  if (!QUEUE_FOCUS_TOKEN_PATTERN.test(token)) {
    focusFallback();
    return false;
  }

  const expectedId = queueFocusDomId(token);
  const candidates = root.querySelectorAll("[data-queue-focus]");
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (
      !candidate ||
      candidate.getAttribute("id") !== expectedId ||
      candidate.getAttribute("data-queue-focus") !== token
    ) continue;
    candidate.focus?.({ preventScroll: true });
    candidate.scrollIntoView?.({ block: "center", inline: "nearest" });
    return true;
  }
  focusFallback();
  return false;
}

/**
 * Id of the control that submitted the last filter change, so focus and caret
 * survive the repaint the change causes.
 *
 * Module scope for the same reason `pendingResumeToken` is: the repaint replaces
 * `root.innerHTML` wholesale, so anything parked in the closure of the form that
 * set it dies before the next paint can read it.
 */
let restoreFocusId: string | null = null;

/**
 * Binds the search/filter/sort/page-size controls of a long list.
 *
 * Filters are URL state, so a change navigates rather than mutating anything in
 * place: the hash change repaints the shell and the new location renders the new
 * recorte. Pagination needs no binding at all — it is plain links, which is why
 * it keeps working after a repaint drops every handler on the page.
 */
function bindListFilters(root: MountableRoot, hash: string, navigate: Navigate): void {
  if (typeof root.querySelectorAll !== "function") return;
  const forms = root.querySelectorAll("[data-list-filters]");
  let bound = 0;
  for (let i = 0; i < forms.length; i += 1) {
    const form = forms[i];
    if (!form) continue;
    // Guard before binding: a root that answers every selector with the same
    // elements must not have its other handlers overwritten by this one.
    const listId = form.getAttribute("data-list-filters");
    if (!listId) continue;
    const defaults = defaultParamValues(listSpecById(listId));
    const apply = (event: Event): void => {
      event.preventDefault();
      if (typeof document !== "undefined") {
        const active = document.activeElement;
        restoreFocusId = active instanceof HTMLElement && active.id ? active.id : null;
      }
      const patch: Record<string, string | null> = {};
      for (const name of LIST_FORM_FIELDS) {
        const field = form.querySelector(`[name="${name}"]`);
        if (!field) continue;
        const value = field.value ?? "";
        const isDefault = value === "" || value === "all" || value === defaults[name];
        patch[name] = isDefault ? null : value;
      }
      navigate(listHref(hash, patch));
    };
    form.addEventListener("submit", apply);
    form.addEventListener("change", apply);
    bound += 1;
  }
  restoreListFocus(bound > 0);
}

/**
 * A navigation repaints twice when the read is async — a loading shell first,
 * then the data. Only the paint that actually rendered a filter form may consume
 * the pending focus, or the loading frame swallows it and the caret is lost.
 */
function restoreListFocus(painted: boolean): void {
  if (!painted) return;
  const id = restoreFocusId;
  restoreFocusId = null;
  if (!id || typeof document === "undefined") return;
  const element = document.getElementById(id);
  if (element instanceof HTMLInputElement) {
    element.focus();
    const end = element.value.length;
    try {
      element.setSelectionRange(end, end);
    } catch {
      // Some input types refuse selection APIs; focus alone is enough.
    }
    return;
  }
  if (element instanceof HTMLSelectElement) element.focus();
}

function bindReviewActions(
  root: MountableRoot,
  adapter: ControlCenterReadAdapter,
  onDone: () => void,
): void {
  if (!adapter.reviewDraftAction || typeof root.querySelectorAll !== "function") return;
  const forms = root.querySelectorAll("[data-review-form]");
  for (let i = 0; i < forms.length; i += 1) {
    const form = forms[i];
    if (!form) continue;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const id = form.getAttribute("data-review-form") ?? "";
      const action = form.querySelector('[name="action"]')?.value as "SAVE_ADJUSTMENT" | "APPROVE" | "REJECT" | undefined;
      const expected = form.querySelector('[name="expected_content_hash"]')?.value ?? "";
      if (!id || !action || !expected) return;
      void Promise.resolve(adapter.reviewDraftAction?.({
        id,
        action,
        expected_content_hash: expected,
        subject: form.querySelector('[name="subject"]')?.value ?? "",
        body_text: form.querySelector('[name="body_text"]')?.value ?? "",
        reason: form.querySelector('[name="reason"]')?.value ?? "",
        generic_recipient_acknowledged: form.querySelector('[name="generic_ack"]')?.value === "true",
      })).then((result) => {
        if (result) adapter.lastOperatorResult = result;
        onDone();
      });
    });
  }
}

function bindOperatorActions(
  root: MountableRoot,
  adapter: ControlCenterReadAdapter,
  onDone: () => void,
): void {
  if (!adapter.operatorAction || typeof root.querySelectorAll !== "function") return;
  const forms = root.querySelectorAll("[data-operator-form]");
  for (let i = 0; i < forms.length; i += 1) {
    const form = forms[i];
    if (!form) continue;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const actionType = form.getAttribute("data-operator-form");
      if (!actionType) return;
      const targetCanonical = form.querySelector('[name="target_canonical_id"]')?.value ?? "";
      const targetSource = form.querySelector('[name="target_source_id"]')?.value ?? "";
      const note = form.querySelector('[name="note"]')?.value ?? "";
      void Promise.resolve(
        adapter.operatorAction?.({
          action_type: actionType,
          target_canonical_id: targetCanonical,
          target_source_id: targetSource,
          note,
        }),
      ).then((result) => {
        if (result) adapter.lastOperatorResult = result;
        onDone();
      });
    });
  }
}

/**
 * The pending `resume_dispatch` confirmation lives in its own module so the
 * renderer can read the same cell this binder writes. Re-exported here because
 * it has always been part of this module's public surface.
 */
export { clearPendingResumeConfirmation, pendingResumeConfirmation } from "./warmbly-confirmation";

/**
 * Binds the Warmbly dispatch control.
 *
 * Pause is one click. Resume is two by contract: the first call mints a
 * single-use token, the second replays it. Any outcome other than a fresh
 * challenge drops the token, so a failed or spent confirmation always costs a
 * new deliberate act.
 */
function bindWarmblyDispatch(
  root: MountableRoot,
  adapter: ControlCenterReadAdapter,
  onDone: () => void,
  observationFingerprint: string,
): void {
  if (!adapter.warmblyDispatch || typeof root.querySelectorAll !== "function") return;
  const forms = root.querySelectorAll("[data-warmbly-dispatch]");
  for (let i = 0; i < forms.length; i += 1) {
    const form = forms[i];
    if (!form) continue;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void (async () => {
        const requested = form.getAttribute("data-warmbly-dispatch");
        if (requested !== "pause" && requested !== "resume" && requested !== "acknowledge") return;
        const reason = form.querySelector('[name="reason"]')?.value ?? "";
        const normalizedReason = reason.trim();
        const targetId = form.querySelector('[name="target_id"]')?.value ?? "";

        let action: "pause" | "resume_confirm" | "resume" | "acknowledge" = requested;
        let confirmationToken: string | undefined;
        const pending = readPendingResume();

        if (requested === "resume") {
          const matchesPending =
            pending !== undefined &&
            pending.reason === normalizedReason &&
            pending.observation_fingerprint === observationFingerprint;
          if (matchesPending) {
            // Take the token before the asynchronous freshness check. It is
            // single-use in this client even if the read or the write fails.
            confirmationToken = pending.token;
            clearPendingResume();
            const latestObservation = await latestResumeObservation(adapter);
            if (latestObservation !== observationFingerprint) {
              adapter.lastOperatorResult = staleResumeConfirmation();
              onDone();
              return;
            }
            action = "resume";
          } else {
            // A changed reason or changed rendered observation cannot inherit
            // the old challenge. This submit starts a fresh first step.
            clearPendingResume();
            action = "resume_confirm";
          }
        } else {
          // Pause and acknowledge are interventions. Even a refused attempt
          // invalidates a prior resume decision before it can be reused.
          clearPendingResume();
        }

        const result = await Promise.resolve(
          adapter.warmblyDispatch?.({
            action,
            reason,
            ...(action === "resume" && confirmationToken
              ? { confirmation_token: confirmationToken }
              : {}),
            ...(requested === "acknowledge" ? { target_id: targetId } : {}),
          }),
        );
        if (result) {
          adapter.lastOperatorResult = result;
          // Arm the following resume only when this call actually minted a
          // challenge. A refusal arms nothing, and the challenge is bound to
          // the same reason and observation the operator just reviewed.
          if (action === "resume_confirm" && result.ok && result.confirmationToken) {
            armPendingResumeConfirmation({
              token: result.confirmationToken,
              reason: normalizedReason,
              observation_fingerprint: observationFingerprint,
            });
          }
        }
        onDone();
      })();
    });
  }
}

/**
 * Binds every human-gate control.
 *
 * Four things this binder owes the operator, none of which the previous one
 * gave them:
 *
 * 1. **One click is one write.** A gate POST is not idempotent by accident —
 *    a second `create` mints a second cohort — so a form already waiting on the
 *    channel refuses the next submit outright.
 * 2. **A pending state.** The paint before the await is what makes the wait
 *    visible; a control that looks idle while a write is in flight is a control
 *    that invites the second click.
 * 3. **A readback before claiming an effect.** A 2xx says the channel accepted
 *    the call, not that the resource changed.
 * 4. **Navigation to the resource the server named.** After create, reproduce or
 *    adjust the operator is taken to the version the response carried — never to
 *    a version this screen guessed.
 */
function bindWarmblyHumanGate(
  root: MountableRoot,
  adapter: ControlCenterReadAdapter,
  onDone: () => void,
  navigate: Navigate,
): void {
  if (!adapter.warmblyGate || typeof root.querySelectorAll !== "function") return;
  const forms = root.querySelectorAll("[data-human-gate]");
  for (let i = 0; i < forms.length; i += 1) {
    const form = forms[i];
    if (!form) continue;
    const raw = form.getAttribute("data-human-gate");
    if (!isWarmblyGateAction(raw)) continue;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const versionId = form.getAttribute("data-version") ?? "";
      const candidateId = form.getAttribute("data-candidate") ?? "";
      const key = form.getAttribute("data-gate-key") ?? `${raw}:${versionId}:${candidateId}:`;
      // The APPROVE form carries its decision on the element, because APPROVE
      // and HOLD/REJECT are different forms with different requirements: one
      // may resolve the recipient verification on the way and needs no typed
      // motive, the other always demands one and never verifies anything.
      const fixedDecision = form.getAttribute("data-decision");
      const decision = fixedDecision ?? form.querySelector('[name="decision"]')?.value;
      const limit = Number(form.querySelector('[name="limit"]')?.value ?? 0);
      const confirmation = form.querySelector('[name="confirmation"]')?.value?.trim() ?? "";
      const reason = form.querySelector('[name="reason"]')?.value ?? "";

      if (raw === "adjust") {
        const subject = form.querySelector('[name="subject"]')?.value ?? "";
        const bodyText = form.querySelector('[name="body_text"]')?.value ?? "";
        if (form.getAttribute("data-adjust-step") !== "confirm") {
          // Step one is local and writes nothing: it parks the draft so the
          // next paint can show the operator the diff they are about to commit.
          setAdjustDraft({
            cohort_id: versionId,
            candidate_id: candidateId,
            subject,
            body_text: bodyText,
            reason,
            // The frozen originals ride on the form, not on the inputs: the
            // moment the operator types, the input no longer knows what was
            // frozen, and a diff against the edited text is no diff at all.
            before_subject: form.getAttribute("data-before-subject") ?? "",
            before_body_text: form.getAttribute("data-before-body") ?? "",
            version: form.getAttribute("data-cohort-version") ?? "",
            frozen_hash: form.getAttribute("data-frozen-hash") ?? "",
          });
          onDone();
          return;
        }
      }

      if (!beginGateFlight(key)) return;
      const isApprove = raw === "review" && decision === "APPROVE";
      const intent: HumanGateIntent = {
        action: raw,
        ...(versionId ? { version_id: versionId } : {}),
        ...(candidateId ? { candidate_id: candidateId } : {}),
        ...(limit > 0 ? { limit } : {}),
        ...(decision === "APPROVE" || decision === "REJECT" || decision === "HOLD" || decision === "GO" || decision === "NO_GO" ? { decision } : {}),
        // An ordinary approval types nothing, and the trail must still say what
        // happened. The default is folded in here, not only at the wire, so the
        // idempotency identity and the recorded motive are the same string.
        ...(isApprove
          ? { reason: reason.trim() || APPROVAL_DEFAULT_REASON }
          : reason
            ? { reason }
            : {}),
        // Pressing Aprovar *is* the acknowledgement. The form carries no
        // checkbox because a second click declaring the first one adds nothing
        // to the trail: actor, instant, version, frozen hash and recipient are
        // all recorded already.
        ...(isApprove ? { acknowledged: true } : {}),
        ...((raw === "decide" || raw === "adjust") && confirmation ? { confirmation } : {}),
        ...(raw === "adjust"
          ? {
              subject: form.querySelector('[name="subject"]')?.value ?? "",
              body_text: form.querySelector('[name="body_text"]')?.value ?? "",
              expected_frozen_hash: form.getAttribute("data-frozen-hash") ?? "",
            }
          : {}),
      };
      // Optimistic, and only for the two decisions that take a candidate out of
      // the pending queue. The mark goes up before the write so the next
      // message is on screen immediately; every outcome short of a confirmed
      // application rolls it back.
      const optimistic =
        raw === "review" && versionId && candidateId
          ? decision === "APPROVE"
            ? "aprovado"
            : decision === "HOLD" || decision === "REJECT"
              ? "ajuste"
              : null
          : null;
      if (optimistic) markReviewDecided(versionId, candidateId, optimistic);
      // Paint the pending state before the await. The key is computed first so
      // this paint already renders the form as busy.
      onDone();
      void (async () => {
        let result: AdapterWriteResult;
        try {
          result = isApprove
            ? await approveCandidate(adapter, intent, {
                versionId,
                candidateId,
                autoValidate: form.getAttribute("data-auto-validate") === "true",
                releaseFlight: () => endGateFlight(key),
              })
            : await (async () => {
                const written = await writeGateIntent(adapter, intent, raw, versionId, candidateId);
                endGateFlight(key);
                return settleGateIntent(adapter, intent, written);
              })();
        } catch {
          // Belt and braces over the guards each step already has. A chain that
          // threw leaves this client unable to say what reached the gate, so
          // the verdict is `unknown` and the optimistic mark comes back down.
          result = browserTransportResult(raw, versionId, candidateId);
          adapter.lastOperatorResult = result;
        } finally {
          // A form left claimed by a chain that died is a control the operator
          // can never press again without reloading.
          endGateFlight(key);
        }
        if (optimistic && !confirmedApplication(result)) {
          rollbackReviewDecided(versionId, candidateId);
        }
        if (raw === "adjust" && result.ok) clearAdjustDraft(candidateId);
        // The reviewer's hands stay where they were: the next pending card
        // takes the focus so the following approval needs no scroll and no
        // pointer hunt.
        if (raw === "review" && confirmedApplication(result)) requestQueueAdvance();
        const next = gateNavigation(raw, result);
        if (next) {
          navigate(next);
          return;
        }
        onDone();
      })();
    });
  }
}

/** The verdict this client falls back to when the adapter never answered at all. */
function browserTransportResult(
  action: WarmblyGateAction,
  versionId: string,
  candidateId: string,
): AdapterWriteResult {
  return {
    ok: false,
    path: "",
    kind: "nota",
    message: "O canal falhou sem responder.",
    outcome: "unknown",
    code: "browser_transport",
    gateAction: action,
    ...(versionId || candidateId
      ? {
          gateTarget: {
            ...(versionId ? { cohort_id: versionId } : {}),
            ...(candidateId ? { candidate_id: candidateId } : {}),
          },
        }
      : {}),
  };
}

/**
 * One gate write, and nothing else.
 *
 * An adapter that throws instead of answering leaves this client unable to say
 * whether the POST reached the gate, so `unknown` is the only honest verdict —
 * and it is the one that keeps the idempotency key for the retry.
 */
async function writeGateIntent(
  adapter: ControlCenterReadAdapter,
  intent: HumanGateIntent,
  action: WarmblyGateAction,
  versionId: string,
  candidateId: string,
): Promise<AdapterWriteResult> {
  try {
    const result = await Promise.resolve(
      adapter.warmblyGate?.({ ...intent, idempotency_key: humanGateIdempotencyKey(intent) }),
    );
    if (result) return result;
  } catch {
    // Falls through to the same unknown verdict as an absent channel.
  }
  return browserTransportResult(action, versionId, candidateId);
}

/**
 * Everything a write owes after the channel answered: settle the idempotency
 * generation, re-read the resource, and publish the outcome the next paint
 * renders.
 */
async function settleGateIntent(
  adapter: ControlCenterReadAdapter,
  intent: HumanGateIntent,
  result: AdapterWriteResult,
): Promise<AdapterWriteResult> {
  // Only a definitive outcome advances the key. An `unknown` keeps it, so the
  // retry of an uncertain intent is the same intent to the server.
  settleHumanGateIntent(intent, result.outcome);
  if (result.code === "adjust_route_unavailable") markAdjustRouteMissing();
  const readback = await gateReadback(adapter, intent, result);
  const settled: AdapterWriteResult = { ...result, readback };
  adapter.lastOperatorResult = settled;
  return settled;
}

/**
 * Whether a write may be treated as applied.
 *
 * Accepted-by-the-channel is not applied, and a readback that says the server
 * does not record the change is the clearest possible "no". Only these two
 * together let an optimistic mark stand.
 */
function confirmedApplication(result: AdapterWriteResult): boolean {
  if (!result.ok || result.outcome !== "executed") return false;
  return result.readback?.status !== "not_confirmed";
}

/**
 * Approving a candidate, as one reviewer action.
 *
 * The server refuses APPROVE outside a current VALID validation and will go on
 * refusing it — that invariant is Warmbly's and it is not weakened here. What
 * this removes is the human step in front of it: obtaining the validation is a
 * deterministic call with no judgement in it, so the approve action makes it,
 * reads the resulting status back from the server, and only then registers the
 * decision. A verification that does not come back VALID stops the chain with
 * the reason written out; APPROVE is not attempted, and nothing is guessed
 * about a status the server did not state.
 */
async function approveCandidate(
  adapter: ControlCenterReadAdapter,
  intent: HumanGateIntent,
  args: {
    versionId: string;
    candidateId: string;
    autoValidate: boolean;
    releaseFlight: () => void;
  },
): Promise<AdapterWriteResult> {
  const { versionId, candidateId, autoValidate, releaseFlight } = args;
  const target = { cohort_id: versionId, candidate_id: candidateId };
  if (autoValidate) {
    const validateIntent: HumanGateIntent = {
      action: "validate",
      version_id: versionId,
      candidate_id: candidateId,
    };
    const validated = await settleGateIntent(
      adapter,
      validateIntent,
      await writeGateIntent(adapter, validateIntent, "validate", versionId, candidateId),
    );
    if (!confirmedApplication(validated)) {
      releaseFlight();
      const refusal: AdapterWriteResult = {
        ...validated,
        ok: false,
        code: "approval_validation_unavailable",
        message: `A verificação do destinatário não completou (${validated.code ?? validated.status ?? "sem código"}): ${validated.message}`,
        gateAction: "validate",
        gateTarget: target,
      };
      adapter.lastOperatorResult = refusal;
      return refusal;
    }
    const status = await readValidationStatus(adapter, versionId, candidateId);
    if (status !== "VALID") {
      releaseFlight();
      // "O servidor disse RISKY" and "não deu para ler o que o servidor diz"
      // are different answers, and only the first one is about the recipient.
      // Collapsing them would tell the reviewer a mailbox is bad when what
      // actually failed was a GET.
      const refusal: AdapterWriteResult = {
        ok: false,
        path: validated.path,
        kind: "nota",
        outcome: "refused",
        ...(status === null
          ? {
              code: "approval_validation_unavailable",
              message:
                "A verificação foi pedida, mas a releitura não devolveu o estado dela, então esta tela não sabe se o destinatário está VALID. O APPROVE não foi enviado e nada foi decidido.",
            }
          : {
              code: "approval_validation_not_valid",
              message: `A verificação foi feita agora e o servidor reporta ${status}, não VALID. O APPROVE não foi enviado.`,
            }),
        gateAction: "validate",
        gateTarget: target,
        ...(validated.receiptId ? { receiptId: validated.receiptId } : {}),
        ...(validated.correlationId ? { correlationId: validated.correlationId } : {}),
      };
      adapter.lastOperatorResult = refusal;
      return refusal;
    }
  }
  const written = await writeGateIntent(adapter, intent, "review", versionId, candidateId);
  releaseFlight();
  return settleGateIntent(adapter, intent, written);
}

/** The validation status the server reports for one candidate, right now. */
async function readValidationStatus(
  adapter: ControlCenterReadAdapter,
  cohortId: string,
  candidateId: string,
): Promise<string | null> {
  const candidate = await readGateCandidate(adapter, cohortId, candidateId);
  if (!candidate) return null;
  const status = gateRecord(candidate.validation).status;
  return typeof status === "string" && status !== "" ? status.toUpperCase() : null;
}

/* ------------------------------------------------------------------ *
 * Queue advance.
 * ------------------------------------------------------------------ */

/**
 * Whether the next paint owes the reviewer the focus of the next pending card.
 *
 * Module scope for the same reason `restoreFocusId` is: the repaint replaces
 * `root.innerHTML` wholesale, so the handler that asked for the advance is gone
 * long before the markup that can satisfy it exists.
 */
let queueAdvancePending = false;

export function requestQueueAdvance(): void {
  queueAdvancePending = true;
}

/**
 * Puts the reviewer on the next pending approval.
 *
 * Only a paint that actually rendered the queue may consume the request — a
 * loading frame would swallow it and leave the reviewer's focus on nothing.
 * `preventScroll` plus an explicit `scrollIntoView` keeps the page from
 * jumping: the card is centred deliberately rather than yanked to the top by
 * the browser's own focus scroll.
 */
export function advanceReviewQueue(root: MountableRoot, painted: boolean): boolean {
  if (!queueAdvancePending) return false;
  if (typeof root.querySelectorAll !== "function") return false;
  const buttons = root.querySelectorAll("[data-approve-submit]");
  let next: (typeof buttons)[number] | undefined;
  for (let index = 0; index < buttons.length; index += 1) {
    const button = buttons[index];
    // A disabled control is not somewhere to leave a reviewer: it is a
    // candidate the server blocked, and landing on it would look like the queue
    // had stalled.
    if (button && button.getAttribute("disabled") === null) {
      next = button;
      break;
    }
  }
  if (!next) {
    // Nothing left to approve. The request is spent either way: the queue-empty
    // card is the thing the reviewer should be reading now.
    if (painted) queueAdvancePending = false;
    return false;
  }
  queueAdvancePending = false;
  next.focus?.({ preventScroll: true });
  next.scrollIntoView?.({ block: "center", inline: "nearest" });
  return true;
}

/** Test seam. Production never needs to forget a pending advance. */
export function resetQueueAdvance(): void {
  queueAdvancePending = false;
}

/* ------------------------------------------------------------------ *
 * Keyboard.
 * ------------------------------------------------------------------ */

/**
 * Whether the caret is somewhere a keystroke means text, not a decision.
 *
 * The adjust editor is a real editor on the same page as the approve controls,
 * so a shortcut that fires while someone is writing a subject line would
 * approve an outbound message as a side effect of typing. Every field is out of
 * bounds; a focused button is not, because that is where the queue advance
 * leaves the reviewer.
 */
export function isEditingTarget(
  element: { tagName?: string; isContentEditable?: boolean } | null | undefined,
): boolean {
  if (!element) return false;
  if (element.isContentEditable === true) return true;
  const tag = typeof element.tagName === "string" ? element.tagName.toUpperCase() : "";
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * What a keystroke is allowed to reach.
 *
 * `focused-card` may only approve the message the reviewer is already on;
 * `first-pending` may fall back to the top of the queue.
 */
export type ApprovalShortcutScope = "focused-card" | "first-pending" | null;

/**
 * The two keystrokes that approve, and how far each one reaches.
 *
 * Bare `A` is the throughput shortcut and is deliberately the narrower of the
 * two: it approves only the card that already has the focus, which after an
 * approval is the next pending one. A stray `a` typed while reading anything
 * else authorises no outbound message. Ctrl/Cmd+Enter is explicit enough to
 * address the queue.
 *
 * Modifiers are refused rather than ignored — `Ctrl+A` is select-all and must
 * stay select-all — and nothing at all fires while a field has the caret.
 */
export function approvalShortcutScope(
  event: {
    key?: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
  },
  editing: boolean,
): ApprovalShortcutScope {
  if (editing || event.altKey === true) return null;
  const key = typeof event.key === "string" ? event.key : "";
  if (key === "Enter") {
    return event.ctrlKey === true || event.metaKey === true ? "first-pending" : null;
  }
  if (key.toLowerCase() !== "a") return null;
  return event.ctrlKey !== true && event.metaKey !== true && event.shiftKey !== true
    ? "focused-card"
    : null;
}

/** Bound once for the life of the page: a repaint drops markup, not documents. */
let queueShortcutBound = false;

function bindReviewQueueShortcut(): void {
  if (queueShortcutBound || typeof document === "undefined") return;
  queueShortcutBound = true;
  document.addEventListener("keydown", (event) => {
    const active = document.activeElement as HTMLElement | null;
    const scope = approvalShortcutScope(event, isEditingTarget(active));
    if (!scope) return;
    // The card under the caret first, so a reviewer who tabbed into a specific
    // message approves that one and not whatever happens to be at the top.
    const scoped = active?.closest?.("[data-candidate-id]") ?? null;
    const button =
      scoped?.querySelector("[data-approve-submit]:not([disabled])")
      ?? (scope === "first-pending"
        ? document.querySelector("[data-approve-submit]:not([disabled])")
        : null);
    if (!(button instanceof HTMLElement)) return;
    event.preventDefault();
    button.click();
  });
}

/** Where the operator is taken after a write, according to the server's answer. */
function gateNavigation(
  action: WarmblyGateAction,
  result: AdapterWriteResult | undefined,
): string | null {
  if (!result?.ok) return null;
  if (action !== "create" && action !== "reproduce" && action !== "adjust") return null;
  const cohortId = result.gateResource?.cohort_id;
  // No id in the response is not a reason to guess one: a version this screen
  // invented is a version that may not exist.
  return cohortId ? `#/warmbly/revisao?resource=${encodeURIComponent(cohortId)}` : null;
}

function gateRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * One candidate, as the server reports it right now.
 *
 * Shared by the readback and by the approve chain so both ask the same question
 * of the same route: a second way of reading the gate is a second way of being
 * wrong about it.
 */
async function readGateCandidate(
  adapter: ControlCenterReadAdapter,
  cohortId: string,
  candidateId: string,
): Promise<Record<string, unknown> | null> {
  let read: import("./adapters/contract").AdapterReadResult;
  try {
    read = await Promise.resolve(
      adapter.readDestination("warmbly", `#/warmbly/revisao?resource=${encodeURIComponent(cohortId)}`),
    );
  } catch {
    return null;
  }
  if (!read.ok || read.loading || !read.page) return null;
  const cohort = gateRecord(gateRecord(gateRecord(read.page.warmbly_gate).selected).data);
  if (!cohort.id) return null;
  const candidates = Array.isArray(cohort.candidates) ? cohort.candidates.map(gateRecord) : [];
  // The intent carries the id as the markup stamped it — a string, always. A
  // strict comparison against a payload that typed it differently finds nothing
  // and reports the write as unconfirmed, which rolls back a decision the
  // server actually recorded.
  return candidates.find((row) => gateCandidateId(row) === candidateId) ?? null;
}

/** The candidate id as a string, however the payload chose to type it. */
function gateCandidateId(candidate: Record<string, unknown>): string {
  const raw = candidate.candidate_id;
  return raw === undefined || raw === null || raw === "" ? "" : String(raw);
}

/**
 * Re-reads the resource a definitive write claimed to change.
 *
 * "O canal aceitou" and "o recurso mudou" are different statements and only the
 * second one is what an operator needs. Everything reported here is what the
 * fresh GET returned; nothing is inferred from the write's own status.
 */
async function gateReadback(
  adapter: ControlCenterReadAdapter,
  intent: HumanGateIntent,
  result: AdapterWriteResult,
): Promise<GateReadback> {
  if (result.outcome !== "executed" || !result.ok) {
    return {
      status: "skipped",
      detail: "Nenhuma releitura é devida: o canal não relatou uma escrita aplicada.",
    };
  }
  const cohortId = result.gateResource?.cohort_id ?? intent.version_id;
  if (!cohortId) {
    return { status: "unavailable", detail: "A resposta não nomeou nenhum recurso para reler." };
  }
  let read: import("./adapters/contract").AdapterReadResult;
  try {
    read = await Promise.resolve(
      adapter.readDestination("warmbly", `#/warmbly/revisao?resource=${encodeURIComponent(cohortId)}`),
    );
  } catch {
    return { status: "unavailable", detail: "A releitura não completou." };
  }
  if (!read.ok || read.loading || !read.page) {
    return { status: "unavailable", detail: "A releitura não completou." };
  }
  const gate = gateRecord(read.page.warmbly_gate);
  const cohort = gateRecord(gateRecord(gate.selected).data);
  if (!cohort.id) {
    return { status: "unavailable", detail: "O servidor não devolveu esta versão na releitura." };
  }
  const candidates = Array.isArray(cohort.candidates) ? cohort.candidates.map(gateRecord) : [];
  const candidate = intent.candidate_id
    ? candidates.find((row) => gateCandidateId(row) === intent.candidate_id)
    : undefined;
  switch (intent.action) {
    case "create":
    case "reproduce":
    case "adjust": {
      const version = cohort.version;
      const expected = result.gateResource?.version;
      const matches = expected === undefined || version === expected;
      return matches
        ? { status: "confirmed", detail: `O servidor devolve a versão v${String(version)}.` }
        : {
            status: "not_confirmed",
            detail: `O servidor devolve a versão v${String(version)}, não a v${String(expected)} anunciada na resposta.`,
          };
    }
    case "review": {
      if (!candidate) {
        return { status: "not_confirmed", detail: "O candidato não aparece nesta versão na releitura." };
      }
      const recorded = gateRecord(candidate.review).decision;
      return recorded === intent.decision
        ? { status: "confirmed", detail: `O servidor registra ${String(recorded)} neste candidato.` }
        : {
            status: "not_confirmed",
            detail: `O servidor ainda registra "${String(recorded ?? "nada")}" neste candidato.`,
          };
    }
    case "decide": {
      const recorded = gateRecord(cohort.decision).decision;
      return recorded === intent.decision
        ? { status: "confirmed", detail: `O servidor registra a decisão final ${String(recorded)}.` }
        : {
            status: "not_confirmed",
            detail: `O servidor ainda registra "${String(recorded ?? "nada")}" como decisão final.`,
          };
    }
    case "validate": {
      if (!candidate) {
        return { status: "not_confirmed", detail: "O candidato não aparece nesta versão na releitura." };
      }
      // Validation is asynchronous at Warmbly, so the honest readback is the
      // state the server reports now — not a verdict about whether it "worked".
      return {
        status: "confirmed",
        detail: `O servidor reporta validação "${String(gateRecord(candidate.validation).status ?? "sem estado")}" agora.`,
      };
    }
  }
}

/**
 * The "expand/collapse all messages" control.
 *
 * It is URL state like every other recorte on this shell, so it survives the
 * repaint that reading a candidate causes.
 */
function bindMessageToggle(root: MountableRoot, hash: string, navigate: Navigate): void {
  if (typeof root.querySelectorAll !== "function") return;
  const buttons = root.querySelectorAll("[data-toggle-messages]");
  for (let i = 0; i < buttons.length; i += 1) {
    const button = buttons[i];
    if (!button || !button.getAttribute("data-toggle-messages")) continue;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const [path = "#/warmbly/revisao", query = ""] = hash.split("?");
      const params = new URLSearchParams(query);
      if (params.get("mensagens") === "recolhidas") params.delete("mensagens");
      else params.set("mensagens", "recolhidas");
      const rendered = params.toString();
      navigate(`${path}${rendered ? `?${rendered}` : ""}`);
    });
  }
}

function bindWarmblyGateFilters(root: MountableRoot, hash: string, navigate: Navigate): void {
  if (typeof root.querySelectorAll !== "function") return;
  const forms = root.querySelectorAll("[data-human-gate-filters]");
  for (let i = 0; i < forms.length; i += 1) {
    const form = forms[i];
    if (!form || !form.getAttribute("data-human-gate-filters")) continue;
    form.addEventListener("change", (event) => {
      event.preventDefault();
      const [path, query = ""] = hash.split("?");
      const params = new URLSearchParams(query);
      for (const name of ["freshness", "decision"]) {
        const value = form.querySelector(`[name="${name}"]`)?.value ?? "all";
        if (value === "all") params.delete(name);
        else params.set(name, value);
      }
      const rendered = params.toString();
      navigate(`${path}${rendered ? `?${rendered}` : ""}`);
    });
  }
}

async function latestResumeObservation(
  adapter: ControlCenterReadAdapter,
): Promise<string | null> {
  try {
    const result = await Promise.resolve(adapter.readDestination("warmbly"));
    if (!result.ok || result.loading) return null;
    return resumeObservationFingerprint(result.page?.commercial);
  } catch {
    return null;
  }
}

function staleResumeConfirmation(): AdapterWriteResult {
  return {
    ok: false,
    path: WARMBLY_DISPATCH_PATHS.resume,
    kind: "nota",
    message:
      "A leitura do outbound mudou ou não pôde ser confirmada desde o primeiro passo. A retomada não foi executada; releia o estado e peça uma nova confirmação.",
    outcome: "refused",
    code: "confirmation_stale",
  };
}

function bindWriteShortcuts(
  root: MountableRoot,
  adapter: ControlCenterReadAdapter,
  onDone: () => void,
): void {
  if (!adapter.writeShortcut || typeof root.querySelectorAll !== "function") return;
  const forms = root.querySelectorAll("[data-shortcut-form]");
  for (let i = 0; i < forms.length; i += 1) {
    const form = forms[i];
    if (!form) continue;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const kind = form.getAttribute("data-shortcut-form") as WriteShortcutKind | null;
      if (!kind) return;
      const title = form.querySelector('[name="title"]')?.value ?? "";
      const body = form.querySelector('[name="body"]')?.value ?? "";
      void Promise.resolve(adapter.writeShortcut?.(kind, { title, body })).then(onDone);
    });
  }
}

export function paintShell(
  root: MountableRoot,
  adapter: ControlCenterReadAdapter & {
    setScenario?(s: MockScenario): void;
    getScenario?(): MockScenario;
  },
  hash: string,
  generation = 0,
  isCurrent: (generation: number) => boolean = () => true,
  navigate: Navigate = defaultNavigate,
  replaceLocation: ReplaceLocation = defaultReplaceLocation,
): void {
  const location = hash || "#/hoje";
  const parsed = parseHash(location);
  const override = parseViewKind(parsed.view);
  adapter.setScenario?.(scenarioFromView(override));
  const result = adapter.readDestination(parsed.destination, location);
  if (isPromise(result)) {
    applyPaint(root, adapter, parsed, override, { ok: true, loading: true, page: null }, location, navigate, replaceLocation);
    void result.then((resolved) => {
      if (!isCurrent(generation)) return;
      applyPaint(root, adapter, parsed, override, resolved, location, navigate, replaceLocation);
    });
    return;
  }
  applyPaint(root, adapter, parsed, override, result, location, navigate, replaceLocation);
}

export function mount(
  root: MountableRoot,
  adapter: ControlCenterReadAdapter & {
    setScenario?(s: MockScenario): void;
    getScenario?(): MockScenario;
  },
  runtime: ShellRuntime = browserRuntime(),
): { unmount: () => void } {
  let generation = 0;
  const paint = (): void => {
    generation += 1;
    const current = generation;
    paintShell(
      root,
      adapter,
      runtime.getHash(),
      current,
      (g) => g === generation,
      (next) => runtime.setHash(next),
      (next) => runtime.replaceHash(next),
    );
  };
  const stop = runtime.onHashChange(paint);
  if (!runtime.getHash()) {
    runtime.setHash("#/hoje");
  }
  paint();
  return {
    unmount(): void {
      stop();
      root.innerHTML = "";
    },
  };
}
