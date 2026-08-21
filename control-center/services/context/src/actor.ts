import { authError, forbidden } from "./errors.ts";
import { sanitizeActorId } from "./sanitize.ts";
import { ACTOR_KINDS, type ActorKind, type ActorRef } from "./types.ts";

export function parseActorKind(value: unknown): ActorKind {
  if (typeof value !== "string" || value.trim() === "") {
    throw authError("missing_actor", "actor kind is required");
  }
  const kind = value.trim();
  if (!(ACTOR_KINDS as readonly string[]).includes(kind)) {
    throw authError("unknown_actor_role", "actor kind is unknown");
  }
  return kind as ActorKind;
}

export function parseActor(idRaw: unknown, kindRaw: unknown): ActorRef {
  if (idRaw === undefined || idRaw === null || idRaw === "") {
    throw authError("missing_actor", "actor id is required");
  }
  if (kindRaw === undefined || kindRaw === null || kindRaw === "") {
    throw authError("missing_actor", "actor kind is required");
  }
  let id: string;
  try {
    id = sanitizeActorId(idRaw, "actor_id");
  } catch {
    throw authError("invalid_actor_id", "actor id is invalid");
  }
  const kind = parseActorKind(kindRaw);
  return { kind, id };
}

export function sameActor(a: ActorRef, b: ActorRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

export function assertReadable(actor: ActorRef, founderActorId: string): void {
  if (!founderActorId) {
    throw authError("unknown_actor", "founder identity is not configured");
  }
  if (actor.kind === "human" && actor.id !== founderActorId) {
    throw authError("unknown_actor", "founder identity does not match");
  }
}

export function assertFounder(actor: ActorRef, founderActorId: string): void {
  assertReadable(actor, founderActorId);
  if (actor.kind !== "human") {
    throw forbidden("agent_mutation_forbidden", "only the configured human founder may mutate directives");
  }
  if (actor.id !== founderActorId) {
    throw authError("unknown_actor", "founder identity does not match");
  }
}

export function assertAgent(actor: ActorRef, founderActorId: string): void {
  assertReadable(actor, founderActorId);
  if (actor.kind !== "agent") {
    throw forbidden("agent_mutation_forbidden", "proposals are submitted by agents");
  }
}

/** Founder or authenticated agent. Unknown and system actors fail closed. No admin bypass. */
export function assertOperationalReader(actor: ActorRef, founderActorId: string): void {
  assertReadable(actor, founderActorId);
  if (actor.kind !== "human" && actor.kind !== "agent") {
    throw authError("unknown_actor", "operational reads require the founder or an authenticated agent");
  }
}
