import type { MockScenario } from "./adapters/mock";
import type { ControlCenterReadAdapter, DestinationPage } from "./adapters/contract";
import type { WriteShortcutKind } from "./adapters/paths";
import { parseHash } from "./destinations";
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
  hash = "",
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
    query: queryOf(hash),
    ...(adapter.lastOperatorResult ? { operatorResult: adapter.lastOperatorResult } : {}),
  });
  bindWriteShortcuts(root, adapter, () => {
    paintShell(root, adapter, `#/${parsed.destination}`);
  });
  // Repaint back onto the hash we were painted from, not a rebuilt prefix: a
  // detail opened at `?resource=...` with queue filters must survive an action
  // instead of bouncing the operator back to an unfiltered list.
  const currentHash =
    hash || `#/${parsed.destination}${parsed.surface ? `/${parsed.surface}` : ""}`;
  bindOperatorActions(root, adapter, () => {
    paintShell(root, adapter, currentHash);
  });
  bindWarmblyDispatch(root, adapter, () => {
    paintShell(root, adapter, currentHash);
  });
  bindCopyControls(root);
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
 */
let pendingResumeToken: string | undefined;

/** Exposed for tests and for an explicit abandon. */
export function clearPendingResumeConfirmation(): void {
  pendingResumeToken = undefined;
}

export function pendingResumeConfirmation(): string | undefined {
  return pendingResumeToken;
}

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
): void {
  if (!adapter.warmblyDispatch || typeof root.querySelectorAll !== "function") return;
  const forms = root.querySelectorAll("[data-warmbly-dispatch]");
  for (let i = 0; i < forms.length; i += 1) {
    const form = forms[i];
    if (!form) continue;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const requested = form.getAttribute("data-warmbly-dispatch");
      if (requested !== "pause" && requested !== "resume" && requested !== "acknowledge") return;
      const reason = form.querySelector('[name="reason"]')?.value ?? "";
      const targetId = form.querySelector('[name="target_id"]')?.value ?? "";
      // A resume with no token yet is the confirmation step, not the resume.
      const carried = pendingResumeToken;
      const action = requested === "resume" && !carried ? "resume_confirm" : requested;
      // Spend it at most once: whatever happens next, this token is not reused.
      if (requested === "resume") {
        pendingResumeToken = undefined;
      }
      void Promise.resolve(
        adapter.warmblyDispatch?.({
          action,
          reason,
          ...(action === "resume" && carried ? { confirmation_token: carried } : {}),
          ...(requested === "acknowledge" ? { target_id: targetId } : {}),
        }),
      ).then((result) => {
        if (result) {
          adapter.lastOperatorResult = result;
          // Arm the following resume only when this call actually minted a
          // challenge. A refusal arms nothing.
          if (action === "resume_confirm" && result.ok && result.confirmationToken) {
            pendingResumeToken = result.confirmationToken;
          }
        }
        onDone();
      });
    });
  }
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
    applyPaint(root, adapter, parsed, override, { ok: true, loading: true, page: null }, hash);
    void result.then((resolved) => {
      if (!isCurrent(generation)) return;
      applyPaint(root, adapter, parsed, override, resolved, hash);
    });
    return;
  }
  applyPaint(root, adapter, parsed, override, result, hash);
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
