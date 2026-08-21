import { ACTOR_ID_PATTERN, isSessionRole } from "./contract.ts";
import { DirectiveUiError } from "./errors.ts";
import type { FounderApproval, SessionIdentity, SessionRole } from "./types.ts";

/**
 * Opaque local-mock handles. Not a password, not an email, not a person name.
 * Overridable via CONTROL_CENTER_FOUNDER_ACTOR_ID / CC_ACTOR_ID / CC_ACTOR_ROLE.
 */
export const LOCAL_MOCK_FOUNDER_ACTOR_ID = "human:founder";
export const LOCAL_MOCK_ACTOR_ID = "human:founder";
export const LOCAL_MOCK_ACTOR_ROLE: SessionRole = "founder";

export const ENV_FOUNDER_ACTOR_ID = "CONTROL_CENTER_FOUNDER_ACTOR_ID";
export const ENV_ACTOR_ID = "CC_ACTOR_ID";
export const ENV_ACTOR_ROLE = "CC_ACTOR_ROLE";
export const ENV_USE_MOCK_IDENTITY = "CC_USE_MOCK_IDENTITY";

export interface IdentityEnv {
  readonly [key: string]: string | undefined;
}

function readTrimmed(env: IdentityEnv, key: string): string {
  const raw = env[key];
  return typeof raw === "string" ? raw.trim() : "";
}

function parseActorId(raw: string, field: string): string {
  if (raw === "") {
    throw new DirectiveUiError("invalid_actor_id", `${field} is required`);
  }
  if (raw.length > 128 || !ACTOR_ID_PATTERN.test(raw)) {
    throw new DirectiveUiError("invalid_actor_id", `${field} is not a valid opaque handle`);
  }
  if (/password|secret|token/i.test(raw)) {
    throw new DirectiveUiError("invalid_actor_id", `${field} looks like a secret; use an opaque handle`);
  }
  return raw;
}

export function mockIdentity(): SessionIdentity {
  return {
    actor: {
      kind: "human",
      id: LOCAL_MOCK_ACTOR_ID,
      display_name: "Operador local (mock)",
    },
    role: LOCAL_MOCK_ACTOR_ROLE,
    founderActorId: LOCAL_MOCK_FOUNDER_ACTOR_ID,
    source: "mock-local",
  };
}

/**
 * Fail-closed identity. Mock defaults apply only when CC_USE_MOCK_IDENTITY is
 * not "0" (this workstream is mock-only). Production convergence MUST set the
 * founder env var and MUST NOT ship a password.
 */
export function resolveIdentity(env: IdentityEnv): SessionIdentity {
  const allowMock = readTrimmed(env, ENV_USE_MOCK_IDENTITY) !== "0";
  const founderRaw = readTrimmed(env, ENV_FOUNDER_ACTOR_ID);
  const actorRaw = readTrimmed(env, ENV_ACTOR_ID);
  const roleRaw = readTrimmed(env, ENV_ACTOR_ROLE);

  if (founderRaw === "" && actorRaw === "" && roleRaw === "") {
    if (!allowMock) {
      return {
        actor: { kind: "human", id: "human:unconfigured" },
        role: "operator",
        founderActorId: "",
        source: "env",
      };
    }
    return mockIdentity();
  }

  const founderActorId =
    founderRaw === ""
      ? allowMock
        ? LOCAL_MOCK_FOUNDER_ACTOR_ID
        : ""
      : parseActorId(founderRaw, ENV_FOUNDER_ACTOR_ID);
  const actorId =
    actorRaw === ""
      ? allowMock
        ? LOCAL_MOCK_ACTOR_ID
        : ""
      : parseActorId(actorRaw, ENV_ACTOR_ID);
  let role: SessionRole = allowMock ? LOCAL_MOCK_ACTOR_ROLE : "operator";
  if (roleRaw !== "") {
    if (!isSessionRole(roleRaw)) {
      throw new DirectiveUiError("invalid_actor_role", `${ENV_ACTOR_ROLE} is unknown`);
    }
    role = roleRaw;
  }

  if (actorId === "") {
    return {
      actor: { kind: "human", id: "human:unconfigured" },
      role: "operator",
      founderActorId,
      source: "env",
    };
  }

  const actor: SessionIdentity["actor"] = { kind: "human", id: actorId };
  if (allowMock && actorId === LOCAL_MOCK_ACTOR_ID) {
    actor.display_name = "Operador local (mock)";
  }
  return {
    actor,
    role,
    founderActorId,
    source: founderRaw === "" && actorRaw === "" ? "mock-local" : "env",
  };
}

export function founderApproval(identity: SessionIdentity): FounderApproval {
  if (identity.founderActorId === "" || identity.actor.id === "human:unconfigured") {
    return {
      approved: false,
      canMutate: false,
      code: "identity_unconfigured",
      label: "Aprovação founder: ausente — identidade não configurada (fail-closed)",
    };
  }
  const approved =
    identity.role === "founder" && identity.actor.id === identity.founderActorId;
  if (!approved) {
    return {
      approved: false,
      canMutate: false,
      code: "not_founder",
      label: "Aprovação founder: ausente — este ator não pode registrar memória",
    };
  }
  return {
    approved: true,
    canMutate: true,
    code: "founder_ok",
    label: "Aprovação founder: este ator está autorizado a registrar memória",
  };
}

export function assertCanMutate(identity: SessionIdentity): FounderApproval {
  const approval = founderApproval(identity);
  if (!approval.canMutate) {
    throw new DirectiveUiError(
      approval.code,
      approval.label,
      { actor_id: identity.actor.id, role: identity.role },
    );
  }
  return approval;
}
