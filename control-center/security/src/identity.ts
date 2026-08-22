import type { ActorRef } from "@confenge/control-center-contracts";
import { FORWARD_AUTH_HEADERS, REQUIRED_GROUPS } from "./constants.js";
import { isTrustedHop } from "./hop.js";
import type {
  ForwardAuthIdentity,
  IdentityRequest,
  IdentityResult,
  TrustedHopPolicy,
} from "./types.js";

const USER_RE = /^[a-zA-Z0-9._-]{1,64}$/;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const NAME_RE = /^[^\p{Cc}]{1,128}$/u;

function headerValue(
  headers: IdentityRequest["headers"],
  name: string,
): string | undefined {
  const want = name.toLowerCase();
  for (const [key, raw] of Object.entries(headers)) {
    if (key.toLowerCase() !== want) {
      continue;
    }
    if (Array.isArray(raw)) {
      // Fail closed on any duplicate. Taking the first value lets a client-sent
      // copy of an identity header win over the one the proxy appends; Node's
      // own http server joins duplicates into one string and denies, and a
      // mount that hands us arrays must not behave differently.
      if (raw.length !== 1) {
        return undefined;
      }
      const only = raw[0];
      return only === undefined ? undefined : only;
    }
    return raw;
  }
  return undefined;
}

function deny(code: Exclude<IdentityResult, { ok: true }>["code"], reason: string): IdentityResult {
  return { ok: false, code, reason };
}

function splitGroups(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function extractForwardAuthHeaders(
  headers: IdentityRequest["headers"],
): {
  presentCount: number;
  values: {
    user: string | undefined;
    groups: string | undefined;
    name: string | undefined;
    email: string | undefined;
  };
} {
  const user = headerValue(headers, FORWARD_AUTH_HEADERS[0]);
  const groups = headerValue(headers, FORWARD_AUTH_HEADERS[1]);
  const name = headerValue(headers, FORWARD_AUTH_HEADERS[2]);
  const email = headerValue(headers, FORWARD_AUTH_HEADERS[3]);
  const presentCount = [user, groups, name, email].filter((v) => v !== undefined).length;
  return { presentCount, values: { user, groups, name, email } };
}

/**
 * Fail-closed ForwardAuth identity. Headers are trusted only from a configured
 * proxy hop. Missing, empty, spoofed, or untrusted-source identity is denied.
 */
export function parseForwardAuthIdentity(
  request: IdentityRequest,
  policy: TrustedHopPolicy,
): IdentityResult {
  const trusted = isTrustedHop(request.remoteAddress, policy.trustedHops);
  const extracted = extractForwardAuthHeaders(request.headers);
  const hasAny = extracted.presentCount > 0;

  if (!trusted) {
    if (hasAny) {
      return deny(
        "spoofed_identity",
        "identity headers from an untrusted hop are ignored (fail-closed)",
      );
    }
    return deny("untrusted_hop", "request hop is not a trusted reverse-proxy");
  }

  const required: Array<keyof typeof extracted.values> = ["user", "groups", "name", "email"];
  for (const field of required) {
    const value = extracted.values[field];
    if (value === undefined) {
      return deny("missing_identity", `missing ${headerLabel(field)} from trusted hop`);
    }
    if (value.trim() === "") {
      return deny("empty_identity", `empty ${headerLabel(field)} from trusted hop`);
    }
  }

  const user = extracted.values.user?.trim() ?? "";
  const groupsRaw = extracted.values.groups?.trim() ?? "";
  const name = extracted.values.name?.trim() ?? "";
  const email = extracted.values.email?.trim() ?? "";

  if (!USER_RE.test(user)) {
    return deny("malformed_identity", "Remote-User is not a safe identifier");
  }
  if (!EMAIL_RE.test(email)) {
    return deny("malformed_identity", "Remote-Email is malformed");
  }
  if (!NAME_RE.test(name)) {
    return deny("malformed_identity", "Remote-Name is malformed");
  }

  const groups = splitGroups(groupsRaw);
  if (groups.length === 0) {
    return deny("empty_identity", "empty Remote-Groups from trusted hop");
  }

  const requiredGroups = policy.requiredGroups.length > 0 ? policy.requiredGroups : REQUIRED_GROUPS;
  const allowed = new Set(groups);
  if (!requiredGroups.some((g) => allowed.has(g))) {
    return deny("malformed_identity", "Remote-Groups does not include a required operator group");
  }

  const identity: ForwardAuthIdentity = { user, groups, name, email };
  return { ok: true, identity };
}

function headerLabel(field: "user" | "groups" | "name" | "email"): string {
  switch (field) {
    case "user":
      return "Remote-User";
    case "groups":
      return "Remote-Groups";
    case "name":
      return "Remote-Name";
    case "email":
      return "Remote-Email";
    default: {
      const _exhaustive: never = field;
      return _exhaustive;
    }
  }
}

export function defaultTrustedHopPolicy(trustedHops: readonly string[]): TrustedHopPolicy {
  return { trustedHops, requiredGroups: REQUIRED_GROUPS };
}

export function actorRefFromIdentity(identity: ForwardAuthIdentity): ActorRef {
  return {
    kind: "human",
    id: identity.user,
    display_name: identity.name,
  };
}

export function actorRefFromIdentityResult(result: IdentityResult): ActorRef | null {
  if (!result.ok) {
    return null;
  }
  return actorRefFromIdentity(result.identity);
}
