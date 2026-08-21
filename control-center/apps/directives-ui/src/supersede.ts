import { toUtcDateTime } from "./datetime.ts";
import { DirectiveUiError } from "./errors.ts";
import { buildDirective } from "./create.ts";
import type { ActorRef, Clock, CreateDirectiveInput, Directive } from "./types.ts";

export interface SupersedeResult {
  predecessor: Directive;
  successor: Directive;
}

function cloneActor(actor: ActorRef): ActorRef {
  const cloned: ActorRef = { kind: actor.kind, id: actor.id };
  if (actor.display_name) cloned.display_name = actor.display_name;
  return cloned;
}

/**
 * Explicit supersede: the prior record stays readable as `superseded` with
 * body/kind frozen. A successor is appended and references the predecessor.
 * There is no in-place history rewrite.
 */
export function supersedeDirective(
  predecessor: Directive,
  input: CreateDirectiveInput,
  actor: ActorRef,
  clock: Clock,
): SupersedeResult {
  if (predecessor.status === "superseded") {
    throw new DirectiveUiError(
      "already_superseded",
      "this record is already superseded; supersede the current successor instead",
      { id: predecessor.id },
    );
  }
  if (predecessor.status === "revoked") {
    throw new DirectiveUiError("already_revoked", "revoked records cannot be superseded", {
      id: predecessor.id,
    });
  }

  const now = toUtcDateTime(clock.now());
  const linked: CreateDirectiveInput = {
    ...input,
    supersedes: mergeSupersedes(input.supersedes, predecessor.id),
  };
  const successor = buildDirective(linked, actor, clock);

  const frozenBody = predecessor.body;
  const frozenKind = predecessor.kind;
  const frozenTitle = predecessor.title;

  const updated: Directive = {
    ...predecessor,
    status: "superseded",
    updated_at: now,
    body: frozenBody,
    kind: frozenKind,
    title: frozenTitle,
    audit: [
      ...predecessor.audit,
      {
        at: now,
        actor: cloneActor(actor),
        action: "superseded",
        from_status: predecessor.status,
        to_status: "superseded",
        note: `succeeded by ${successor.id}`,
      },
    ],
  };

  if (updated.body !== frozenBody || updated.kind !== frozenKind || updated.title !== frozenTitle) {
    throw new DirectiveUiError("history_rewrite", "supersede must not rewrite predecessor body/kind");
  }

  return { predecessor: updated, successor };
}

function mergeSupersedes(
  existing: string[] | null,
  predecessorId: string,
): string[] {
  const set = new Set(existing ?? []);
  set.add(predecessorId);
  return [...set];
}
