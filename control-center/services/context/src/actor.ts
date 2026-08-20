import { authError, forbidden } from "./errors.ts";
import { sanitizeActorId } from "./sanitize.ts";
import { ACTOR_ROLES, type Actor, type ActorRole } from "./types.ts";

export function parseActorRole(value: unknown): ActorRole {
  if (typeof value !== "string" || value.trim() === "") {
    throw authError("missing_actor", "actor role is required");
  }
  const role = value.trim();
  if (!(ACTOR_ROLES as readonly string[]).includes(role)) {
    throw authError("unknown_actor_role", "actor role is unknown");
  }
  return role as ActorRole;
}

export function parseActor(idRaw: unknown, roleRaw: unknown): Actor {
  if (idRaw === undefined || idRaw === null || idRaw === "") {
    throw authError("missing_actor", "actor id is required");
  }
  if (roleRaw === undefined || roleRaw === null || roleRaw === "") {
    throw authError("missing_actor", "actor role is required");
  }
  let id: string;
  try {
    id = sanitizeActorId(idRaw, "actor_id");
  } catch {
    throw authError("invalid_actor_id", "actor id is invalid");
  }
  const role = parseActorRole(roleRaw);
  return { id, role };
}

export function assertReadable(actor: Actor, founderActorId: string): void {
  if (!founderActorId) {
    throw authError("unknown_actor", "founder identity is not configured");
  }
  if (actor.role === "founder" && actor.id !== founderActorId) {
    throw authError("unknown_actor", "founder identity does not match");
  }
}

export function assertFounder(actor: Actor, founderActorId: string): void {
  assertReadable(actor, founderActorId);
  if (actor.role !== "founder") {
    throw forbidden("agent_mutation_forbidden", "only the founder may mutate directives");
  }
  if (actor.id !== founderActorId) {
    throw authError("unknown_actor", "founder identity does not match");
  }
}

export function assertAgent(actor: Actor, founderActorId: string): void {
  assertReadable(actor, founderActorId);
  if (actor.role !== "agent") {
    throw forbidden("agent_mutation_forbidden", "proposals are submitted by agents");
  }
}
