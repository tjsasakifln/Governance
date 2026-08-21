import type { DestinationId } from "../destinations";
import {
  defaultPages,
  emptyPages,
  MOCK_OPERATOR,
  stalePages,
} from "../fixtures/catalog";
import type { ActorRef } from "../types";
import {
  ADAPTER_ACTIONS,
  type AdapterAction,
  type AdapterReadResult,
  type AdapterWriteResult,
  type ControlCenterReadAdapter,
  type DestinationPage,
} from "./contract";
import { AUTHORIZED_WRITE_PATH, type WriteShortcutKind } from "./paths";

export type MockScenario = "default" | "loading" | "error" | "stale" | "empty";

const ERROR_MESSAGE =
  "Falha simulada ao montar o recorte (modo mock). Nenhuma chamada de rede foi feita.";

function clonePage(page: DestinationPage): DestinationPage {
  return structuredClone(page);
}

export class MockControlCenterAdapter implements ControlCenterReadAdapter {
  readonly mode = "mock" as const;
  readonly actions: readonly AdapterAction[] = ADAPTER_ACTIONS;
  private scenario: MockScenario = "default";

  setScenario(scenario: MockScenario): void {
    this.scenario = scenario;
  }

  getScenario(): MockScenario {
    return this.scenario;
  }

  readOperator(): ActorRef {
    return { ...MOCK_OPERATOR };
  }

  readDestination(id: DestinationId): AdapterReadResult {
    if (this.scenario === "loading") {
      return { ok: true, loading: true, page: null };
    }
    if (this.scenario === "error") {
      return {
        ok: false,
        loading: false,
        error: { code: "MOCK_VIEW_ERROR", message: ERROR_MESSAGE },
      };
    }
    const catalog = this.catalog();
    const page = catalog[id];
    if (!page) {
      return {
        ok: false,
        loading: false,
        error: { code: "UNKNOWN_DESTINATION", message: `Destino desconhecido: ${id}` },
      };
    }
    return { ok: true, loading: false, page: clonePage(page) };
  }

  readAttention() {
    return clonePage(defaultPages().hoje).attention;
  }

  readPriorities() {
    return clonePage(defaultPages().hoje).priorities;
  }

  writeShortcut(kind: WriteShortcutKind, draft: { title: string; body: string }): AdapterWriteResult {
    void draft;
    return {
      ok: false,
      path: AUTHORIZED_WRITE_PATH,
      kind,
      message: "mock adapter does not POST; inject HttpControlCenterAdapter for writes",
    };
  }

  private catalog(): Record<DestinationId, DestinationPage> {
    if (this.scenario === "empty") return emptyPages();
    if (this.scenario === "stale") return stalePages();
    return defaultPages();
  }
}

export function createMockAdapter(scenario: MockScenario = "default"): MockControlCenterAdapter {
  const adapter = new MockControlCenterAdapter();
  adapter.setScenario(scenario);
  return adapter;
}
