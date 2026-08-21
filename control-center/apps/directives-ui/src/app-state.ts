import { founderApproval } from "./actor.ts";
import { isDirectiveKind, isScope } from "./contract.ts";
import { type CreateDraft, draftImpact, draftToInput } from "./create.ts";
import { isDirectiveUiError } from "./errors.ts";
import {
  EMPTY_FILTER,
  parseKindFilter,
  parseScopeFilter,
  parseStatusFilter,
} from "./filter.ts";
import type { DirectiveMemoryPort } from "./service.ts";
import { kindOption } from "./ui/labels.ts";
import type { DirectiveFilter, DirectiveKind, FounderApproval, ResourceId } from "./types.ts";

export type Screen = "list" | "create" | "detail" | "supersede" | "preview";

export interface UiState {
  filter: DirectiveFilter;
  screen: Screen;
  selectedId: ResourceId | null;
  createDraft: CreateDraft;
  previewScope: string;
  notice: string | null;
  error: string | null;
  errorCode: string | null;
}

export type Action =
  | { type: "set-query"; query: string }
  | { type: "set-kind-filter"; kind: string }
  | { type: "set-scope-filter"; scope: string }
  | { type: "set-status-filter"; status: string }
  | { type: "open-create" }
  | { type: "open-detail"; id: ResourceId }
  | { type: "open-supersede"; id: ResourceId }
  | { type: "open-preview"; scope?: string }
  | { type: "set-preview-scope"; scope: string }
  | { type: "back-to-list" }
  | { type: "select-kind"; kind: string }
  | { type: "set-kind-confirmed"; confirmed: boolean }
  | { type: "patch-create"; patch: Partial<CreateDraft> }
  | { type: "submit-create" }
  | { type: "submit-supersede" };

export interface AppSession {
  service: DirectiveMemoryPort;
  ui: UiState;
}

export function initialUiState(service: DirectiveMemoryPort): UiState {
  return {
    filter: { ...EMPTY_FILTER },
    screen: "list",
    selectedId: null,
    createDraft: service.newDraft(),
    previewScope: "company",
    notice: null,
    error: null,
    errorCode: null,
  };
}

export function approvalOf(session: AppSession): FounderApproval {
  return founderApproval(session.service.identity());
}

export function dispatch(session: AppSession, action: Action): AppSession {
  const ui = { ...session.ui, notice: null, error: null, errorCode: null };
  const next: AppSession = { service: session.service, ui };

  switch (action.type) {
    case "set-query":
      next.ui = { ...ui, filter: { ...ui.filter, query: action.query } };
      return next;
    case "set-kind-filter":
      next.ui = { ...ui, filter: { ...ui.filter, kind: parseKindFilter(action.kind) } };
      return next;
    case "set-scope-filter":
      next.ui = { ...ui, filter: { ...ui.filter, scope: parseScopeFilter(action.scope) } };
      return next;
    case "set-status-filter":
      next.ui = { ...ui, filter: { ...ui.filter, status: parseStatusFilter(action.status) } };
      return next;
    case "open-create":
      next.ui = {
        ...ui,
        screen: "create",
        createDraft: session.service.newDraft(),
        selectedId: null,
      };
      return next;
    case "open-detail":
      next.ui = { ...ui, screen: "detail", selectedId: action.id };
      return next;
    case "open-supersede": {
      const predecessor = session.service.get(action.id);
      const draft = session.service.newDraft();
      if (predecessor) {
        draft.kind = predecessor.kind;
        draft.kindConfirmed = false;
        draft.scope = predecessor.scope;
        draft.title = predecessor.title;
        draft.body = predecessor.body;
        draft.supersedeId = predecessor.id;
      }
      next.ui = {
        ...ui,
        screen: "supersede",
        selectedId: action.id,
        createDraft: draft,
      };
      return next;
    }
    case "open-preview":
      next.ui = {
        ...ui,
        screen: "preview",
        previewScope: action.scope && isScope(action.scope) ? action.scope : ui.previewScope,
      };
      return next;
    case "set-preview-scope":
      next.ui = {
        ...ui,
        previewScope: isScope(action.scope) ? action.scope : ui.previewScope,
      };
      return next;
    case "back-to-list":
      next.ui = { ...ui, screen: "list", selectedId: null };
      return next;
    case "select-kind": {
      if (!isDirectiveKind(action.kind)) {
        next.ui = {
          ...ui,
          error: "Tipo desconhecido.",
          errorCode: "invalid_kind",
        };
        return next;
      }
      next.ui = {
        ...ui,
        createDraft: { ...ui.createDraft, kind: action.kind, kindConfirmed: false },
      };
      return next;
    }
    case "set-kind-confirmed":
      next.ui = {
        ...ui,
        createDraft: { ...ui.createDraft, kindConfirmed: action.confirmed },
      };
      return next;
    case "patch-create":
      next.ui = { ...ui, createDraft: { ...ui.createDraft, ...action.patch } };
      return next;
    case "submit-create":
      return submit(next, "create");
    case "submit-supersede":
      return submit(next, "supersede");
  }
}

function submit(session: AppSession, mode: "create" | "supersede"): AppSession {
  const { ui, service } = session;
  try {
    const input = draftToInput(ui.createDraft);
    if (mode === "create") {
      const created = service.create(input);
      return {
        service,
        ui: {
          ...ui,
          screen: "detail",
          selectedId: created.id,
          notice: `Registrado: ${kindOption(created.kind).shortName.toLowerCase()} ${created.id}`,
          error: null,
          errorCode: null,
        },
      };
    }
    const predecessorId = ui.selectedId ?? ui.createDraft.supersedeId;
    if (!predecessorId) {
      return {
        service,
        ui: { ...ui, error: "Selecione o registro a substituir.", errorCode: "not_found" },
      };
    }
    const result = service.supersede(predecessorId, input);
    return {
      service,
      ui: {
        ...ui,
        screen: "detail",
        selectedId: result.successor.id,
        notice: `Supersede explícito: ${result.predecessor.id} ficou superseded; sucessor ${result.successor.id}`,
        error: null,
        errorCode: null,
      },
    };
  } catch (error) {
    if (isDirectiveUiError(error)) {
      return {
        service,
        ui: { ...ui, error: error.message, errorCode: error.code },
      };
    }
    return {
      service,
      ui: {
        ...ui,
        error: "Falha inesperada ao gravar.",
        errorCode: "unknown",
      },
    };
  }
}

export function selectedRecord(session: AppSession) {
  if (!session.ui.selectedId) return undefined;
  return session.service.get(session.ui.selectedId);
}

export function currentImpact(session: AppSession) {
  return draftImpact(session.ui.createDraft);
}

export function confirmLabel(kind: DirectiveKind | ""): string {
  if (kind === "") {
    return "Escolha o tipo antes de confirmar. Sem confirmação, nada é gravado.";
  }
  return kindOption(kind).confirmHint;
}
