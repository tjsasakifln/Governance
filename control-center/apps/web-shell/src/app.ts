import { createMockAdapter, type MockScenario } from "./adapters/mock";
import type { ControlCenterReadAdapter, DestinationPage } from "./adapters/contract";
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
}

export function paintShell(
  root: MountableRoot,
  adapter: ControlCenterReadAdapter & {
    setScenario?(s: MockScenario): void;
    getScenario?(): MockScenario;
  },
  hash: string,
): void {
  const parsed = parseHash(hash || "#/hoje");
  const override = parseViewKind(parsed.view);
  adapter.setScenario?.(scenarioFromView(override));
  const result = adapter.readDestination(parsed.destination);
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
  });
}

export function mount(
  root: MountableRoot,
  adapter: ControlCenterReadAdapter & {
    setScenario?(s: MockScenario): void;
    getScenario?(): MockScenario;
  } = createMockAdapter(),
  runtime: ShellRuntime = browserRuntime(),
): { unmount: () => void } {
  const paint = (): void => {
    paintShell(root, adapter, runtime.getHash());
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
