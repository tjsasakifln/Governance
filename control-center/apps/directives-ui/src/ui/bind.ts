import { dispatch, type Action, type AppSession } from "../app-state.ts";
import { isCreateStatus } from "../contract.ts";
import { renderApp } from "./render.ts";

function targetElement(event: Event): HTMLElement | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  return target instanceof HTMLElement ? target : target.parentElement;
}

function closestAction(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null;
  return el.closest("[data-action]");
}

export function mount(root: HTMLElement, session: AppSession): () => void {
  let current = session;

  const paint = (): void => {
    const hasDomConstructors = typeof HTMLElement !== "undefined";
    const active = typeof document !== "undefined" ? document.activeElement : null;
    const activeId =
      hasDomConstructors && active instanceof HTMLElement ? active.id : "";
    const selection =
      hasDomConstructors &&
      (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
        ? { start: active.selectionStart, end: active.selectionEnd }
        : null;
    root.innerHTML = renderApp(current);
    root.setAttribute("data-ready", "1");
    root.setAttribute("data-screen", current.ui.screen);
    if (activeId) {
      const restored = root.querySelector(`[id=${JSON.stringify(activeId)}]`);
      if (hasDomConstructors && restored instanceof HTMLElement) {
        restored.focus();
        if (
          selection &&
          (restored instanceof HTMLInputElement || restored instanceof HTMLTextAreaElement) &&
          selection.start !== null &&
          selection.end !== null
        ) {
          restored.setSelectionRange(selection.start, selection.end);
        }
      }
    }
  };

  const apply = (action: Action): void => {
    current = dispatch(current, action);
    paint();
  };

  const onClick = (event: Event): void => {
    const actionEl = closestAction(targetElement(event));
    if (!actionEl) return;
    const action = actionEl.getAttribute("data-action");
    const id = actionEl.getAttribute("data-id") ?? "";
    const scope = actionEl.getAttribute("data-scope") ?? undefined;
    if (action === "open-list") {
      event.preventDefault();
      apply({ type: "back-to-list" });
    } else if (action === "open-create") {
      event.preventDefault();
      apply({ type: "open-create" });
    } else if (action === "open-preview") {
      event.preventDefault();
      apply({ type: "open-preview", ...(scope ? { scope } : {}) });
    } else if (action === "open-detail" && id) {
      event.preventDefault();
      apply({ type: "open-detail", id });
    } else if (action === "open-supersede" && id) {
      event.preventDefault();
      apply({ type: "open-supersede", id });
    } else if (action === "submit-create" || action === "submit-supersede") {
      // submit handler takes this
    }
  };

  const onChange = (event: Event): void => {
    const el = targetElement(event);
    if (!el) return;
    if (el instanceof HTMLSelectElement || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const name = el.name;
      if (el.id === "filter-query" || name === "query") {
        apply({ type: "set-query", query: el.value });
        return;
      }
      if (el.id === "filter-kind" || (name === "kind" && el.id === "filter-kind")) {
        apply({ type: "set-kind-filter", kind: el.value });
        return;
      }
      if (el.id === "filter-scope") {
        apply({ type: "set-scope-filter", scope: el.value });
        return;
      }
      if (el.id === "filter-status") {
        apply({ type: "set-status-filter", status: el.value });
        return;
      }
      if (el.id === "preview-scope") {
        apply({ type: "set-preview-scope", scope: el.value });
        return;
      }
      if (name === "kind" && el instanceof HTMLInputElement && el.type === "radio") {
        apply({ type: "select-kind", kind: el.value });
        return;
      }
      if (el.id === "kind-confirm") {
        apply({ type: "set-kind-confirmed", confirmed: el instanceof HTMLInputElement && el.checked });
        return;
      }
      if (el.id === "create-title") {
        apply({ type: "patch-create", patch: { title: el.value } });
        return;
      }
      if (el.id === "create-body") {
        apply({ type: "patch-create", patch: { body: el.value } });
        return;
      }
      if (el.id === "create-scope") {
        apply({ type: "patch-create", patch: { scope: el.value } });
        return;
      }
      if (el.id === "create-status" && isCreateStatus(el.value)) {
        apply({ type: "patch-create", patch: { status: el.value } });
        return;
      }
      if (el.id === "create-effective") {
        apply({ type: "patch-create", patch: { effective_from: el.value } });
        return;
      }
      if (el.id === "create-expires") {
        apply({ type: "patch-create", patch: { expires_at: el.value } });
        return;
      }
    }
  };

  const onSubmit = (event: Event): void => {
    const el = targetElement(event);
    if (!el) return;
    const form = el.closest("form");
    if (!form) return;
    const formName = form.getAttribute("data-form");
    if (formName === "create") {
      event.preventDefault();
      apply({ type: "submit-create" });
    } else if (formName === "supersede") {
      event.preventDefault();
      apply({ type: "submit-supersede" });
    } else if (formName === "filters" || formName === "preview-scope") {
      event.preventDefault();
    }
  };

  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  root.addEventListener("input", onChange);
  root.addEventListener("submit", onSubmit);
  paint();

  return () => {
    root.removeEventListener("click", onClick);
    root.removeEventListener("change", onChange);
    root.removeEventListener("input", onChange);
    root.removeEventListener("submit", onSubmit);
  };
}
