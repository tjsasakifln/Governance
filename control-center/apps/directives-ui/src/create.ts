import {
  BODY_MAX,
  TITLE_MAX,
  isCreateStatus,
  isDirectiveKind,
  isResourceId,
  isScope,
  isUtcDateTime,
} from "./contract.ts";
import { parseUtcDateTime, toUtcDateTime } from "./datetime.ts";
import { DirectiveUiError } from "./errors.ts";
import { describeSaveImpact, type SaveImpact } from "./impact.ts";
import { newDirectiveId } from "./ids.ts";
import type {
  ActorRef,
  Clock,
  CreateDirectiveInput,
  CreateStatus,
  Directive,
  DirectiveKind,
  Scope,
} from "./types.ts";
import { SCHEMA_VERSION } from "./types.ts";

export interface CreateDraft {
  kind: DirectiveKind | "";
  kindConfirmed: boolean;
  title: string;
  body: string;
  scope: Scope;
  status: CreateStatus;
  effective_from: string;
  expires_at: string;
  supersedeId: string;
}

export function defaultCreateDraft(now: Date, defaultScope: Scope = "company"): CreateDraft {
  return {
    kind: "",
    kindConfirmed: false,
    title: "",
    body: "",
    scope: defaultScope,
    status: "active",
    effective_from: toUtcDateTime(now),
    expires_at: "",
    supersedeId: "",
  };
}

export function parseExpiresAt(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return trimmed;
}

export function draftToInput(draft: CreateDraft): CreateDirectiveInput {
  if (draft.kind === "") {
    throw new DirectiveUiError(
      "kind_required",
      "Escolha o tipo da memória. Não há tipo padrão — decisão e fato são escolhas distintas.",
    );
  }
  if (!draft.kindConfirmed) {
    throw new DirectiveUiError(
      "kind_not_confirmed",
      `Confirme explicitamente que o tipo é ${draft.kind}. Sem essa confirmação o registro não é gravado.`,
      { kind: draft.kind },
    );
  }
  const expires = parseExpiresAt(draft.expires_at);
  const supersedes =
    draft.supersedeId.trim() === "" ? null : [draft.supersedeId.trim()];
  return {
    kind: draft.kind,
    kindConfirm: draft.kind,
    title: draft.title,
    body: draft.body,
    scope: draft.scope,
    status: draft.status,
    effective_from: draft.effective_from,
    expires_at: expires,
    supersedes,
  };
}

export function draftImpact(draft: CreateDraft): SaveImpact {
  return describeSaveImpact(draft.scope, parseExpiresAt(draft.expires_at), draft.status);
}

function requireKind(value: string, field: string): DirectiveKind {
  if (!isDirectiveKind(value)) {
    throw new DirectiveUiError("invalid_kind", `${field} must be a known directive kind`, {
      field,
    });
  }
  return value;
}

export function assertKindConfirmed(kind: DirectiveKind, kindConfirm: string): void {
  const confirmed = requireKind(kindConfirm, "kindConfirm");
  if (confirmed !== kind) {
    throw new DirectiveUiError(
      "kind_mismatch",
      `Confirmação de tipo (${confirmed}) não coincide com o tipo escolhido (${kind}). Uma decisão não pode ser gravada como fato.`,
      { kind, kindConfirm: confirmed },
    );
  }
}

export function validateCreateInput(input: CreateDirectiveInput): CreateDirectiveInput {
  const kind = requireKind(input.kind, "kind");
  assertKindConfirmed(kind, input.kindConfirm);
  if (!isScope(input.scope)) {
    throw new DirectiveUiError("invalid_scope", "scope is not a v1 scope string", {
      scope: input.scope,
    });
  }
  if (!isCreateStatus(input.status)) {
    throw new DirectiveUiError(
      "invalid_status",
      "create only accepts draft or active; superseded/revoked/expired are lifecycle results",
    );
  }
  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 1 || title.length > TITLE_MAX) {
    throw new DirectiveUiError("invalid_title", `title must be 1–${TITLE_MAX} characters`);
  }
  if (body.length < 1 || body.length > BODY_MAX) {
    throw new DirectiveUiError("invalid_body", `body must be 1–${BODY_MAX} characters`);
  }
  if (!isUtcDateTime(input.effective_from)) {
    throw new DirectiveUiError("invalid_effective_from", "effective_from must be UTC with Z");
  }
  if (input.expires_at !== null) {
    if (!isUtcDateTime(input.expires_at)) {
      throw new DirectiveUiError("invalid_expires_at", "expires_at must be UTC with Z or null");
    }
    const from = parseUtcDateTime(input.effective_from, "effective_from");
    const until = parseUtcDateTime(input.expires_at, "expires_at");
    if (until.getTime() <= from.getTime()) {
      throw new DirectiveUiError("invalid_expires_at", "expires_at must be after effective_from");
    }
  }
  let supersedes: string[] | null = null;
  if (input.supersedes !== null) {
    if (input.supersedes.length === 0) {
      supersedes = null;
    } else {
      const unique = [...new Set(input.supersedes)];
      for (const id of unique) {
        if (!isResourceId(id)) {
          throw new DirectiveUiError("invalid_supersedes", "supersedes ids must be resource ids");
        }
      }
      supersedes = unique;
    }
  }
  return {
    kind,
    kindConfirm: kind,
    title,
    body,
    scope: input.scope,
    status: input.status,
    effective_from: input.effective_from,
    expires_at: input.expires_at,
    supersedes,
    ...(input.tags ? { tags: input.tags } : {}),
  };
}

export function buildDirective(
  input: CreateDirectiveInput,
  actor: ActorRef,
  clock: Clock,
): Directive {
  const valid = validateCreateInput(input);
  const now = toUtcDateTime(clock.now());
  const id = newDirectiveId(clock.now());
  const record: Directive = {
    schema_version: SCHEMA_VERSION,
    id,
    kind: valid.kind,
    scope: valid.scope,
    status: valid.status,
    title: valid.title,
    body: valid.body,
    effective_from: valid.effective_from,
    expires_at: valid.expires_at,
    supersedes: valid.supersedes,
    created_by: { kind: actor.kind, id: actor.id },
    created_at: now,
    updated_at: now,
    audit: [
      {
        at: now,
        actor: { kind: actor.kind, id: actor.id },
        action: "created",
        to_status: valid.status,
      },
    ],
  };
  if (actor.display_name) {
    record.created_by = { ...record.created_by, display_name: actor.display_name };
    const first = record.audit[0];
    if (first) {
      record.audit[0] = {
        ...first,
        actor: { ...first.actor, display_name: actor.display_name },
      };
    }
  }
  if (valid.tags && valid.tags.length > 0) {
    record.tags = valid.tags;
  }
  return record;
}
