import type { MockScenario } from "./adapters/mock";
import type {
  AdapterWriteResult,
  ControlCenterReadAdapter,
  DestinationPage,
} from "./adapters/contract";
import { WARMBLY_DISPATCH_PATHS, type WriteShortcutKind } from "./adapters/paths";
import { parseHash } from "./destinations";
import {
  armPendingResumeConfirmation,
  clearPendingResumeConfirmation as clearPendingResume,
  pendingResumeConfirmation as readPendingResume,
  resumeObservationFingerprint,
} from "./warmbly-confirmation";
import { pageIsEmpty, pageIsStale } from "./page";
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
    querySelector(selector: string): { value: string } | null;
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
  root.innerHTML = renderShell({
    destination: parsed.destination,
    viewKind: view.kind,
    view,
    mockScenario: adapter.getScenario?.() ?? adapter.mode,
    adapterMode: adapter.mode,
    surface: parsed.surface,
    resource: parsed.resource,
    ...(adapter.lastOperatorResult ? { operatorResult: adapter.lastOperatorResult } : {}),
  });
  bindWriteShortcuts(root, adapter, () => {
    paintShell(root, adapter, `#/${parsed.destination}`);
  });
  bindOperatorActions(root, adapter, () => {
    paintShell(root, adapter, `#/${parsed.destination}${parsed.surface ? `/${parsed.surface}` : ""}`);
  });
  bindWarmblyDispatch(
    root,
    adapter,
    () => {
      paintShell(root, adapter, `#/${parsed.destination}${parsed.surface ? `/${parsed.surface}` : ""}`);
    },
    resumeObservationFingerprint(
      result.ok && !result.loading ? result.page?.commercial : undefined,
    ),
  );
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
): void {
  const parsed = parseHash(hash || "#/hoje");
  const override = parseViewKind(parsed.view);
  adapter.setScenario?.(scenarioFromView(override));
  const result = adapter.readDestination(parsed.destination);
  if (isPromise(result)) {
    applyPaint(root, adapter, parsed, override, { ok: true, loading: true, page: null });
    void result.then((resolved) => {
      if (!isCurrent(generation)) return;
      applyPaint(root, adapter, parsed, override, resolved);
    });
    return;
  }
  applyPaint(root, adapter, parsed, override, result);
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
    paintShell(root, adapter, runtime.getHash(), current, (g) => g === generation);
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
