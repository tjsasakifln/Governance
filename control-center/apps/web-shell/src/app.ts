import type { MockScenario } from "./adapters/mock";
import type { ControlCenterReadAdapter, DestinationPage } from "./adapters/contract";
import type { WriteShortcutKind } from "./adapters/paths";
import { parseHash } from "./destinations";
import { LIST_FORM_FIELDS, defaultParamValues, listHref, listSpecById } from "./filter";
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
  hash: string,
  navigate: Navigate,
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
    hash,
    ...(adapter.lastOperatorResult ? { operatorResult: adapter.lastOperatorResult } : {}),
  });
  // Repaint the location that is actually on screen. Rebuilding it from
  // `parsed` alone drops the query string, so an operator action taken inside a
  // filtered queue used to throw the operator back to the unfiltered page 1.
  const repaint = (): void => {
    paintShell(root, adapter, hash, 0, () => true, navigate);
  };
  bindWriteShortcuts(root, adapter, repaint);
  bindOperatorActions(root, adapter, repaint);
  bindWarmblyDispatch(root, adapter, repaint);
  bindListFilters(root, hash, navigate);
}

export type Navigate = (hash: string) => void;

function defaultNavigate(hash: string): void {
  if (typeof window !== "undefined") {
    window.location.hash = hash;
  }
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
  navigate: Navigate = defaultNavigate,
): void {
  const location = hash || "#/hoje";
  const parsed = parseHash(location);
  const override = parseViewKind(parsed.view);
  adapter.setScenario?.(scenarioFromView(override));
  const result = adapter.readDestination(parsed.destination);
  if (isPromise(result)) {
    applyPaint(root, adapter, parsed, override, { ok: true, loading: true, page: null }, location, navigate);
    void result.then((resolved) => {
      if (!isCurrent(generation)) return;
      applyPaint(root, adapter, parsed, override, resolved, location, navigate);
    });
    return;
  }
  applyPaint(root, adapter, parsed, override, result, location, navigate);
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
    paintShell(root, adapter, runtime.getHash(), current, (g) => g === generation, (next) => {
      runtime.setHash(next);
    });
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
