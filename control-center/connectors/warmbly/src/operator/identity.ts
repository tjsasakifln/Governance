/**
 * Founder identity for operator actions.
 *
 * There is no second identity path here. This delegates to the existing
 * ForwardAuth contract in `control-center/security`: Authelia writes
 * `Remote-User` / `Remote-Groups` / `Remote-Name` / `Remote-Email`, the host
 * nginx vhost for ops.confenge.com.br blanks any client-supplied copy, and
 * `parseForwardAuthIdentity` only trusts those headers from a configured
 * reverse-proxy hop. Anything else (untrusted hop, spoofed, missing, empty,
 * malformed, wrong group) is a deny — and a deny is a recorded refusal here.
 */

import {
  DEFAULT_TRUSTED_HOPS,
  actorRefFromIdentity,
  defaultTrustedHopPolicy,
  parseForwardAuthIdentity,
} from "@confenge/control-center-security";
import type {
  ForwardAuthIdentity,
  IdentityRequest,
  IdentityResult,
  TrustedHopPolicy,
} from "@confenge/control-center-security";

export type { ForwardAuthIdentity, IdentityRequest, TrustedHopPolicy };

/**
 * Ledger actor vocabulary. `control-center/security` returns ActorRef kind
 * "human"; the agent-activity ledger spells the same actor "founder". The map
 * is documented here so the two vocabularies never drift silently.
 */
export interface OperatorActor {
  readonly kind: "founder";
  readonly id: string;
  readonly display_name: string;
}

export type OperatorIdentityResult =
  | { ok: true; actor: OperatorActor }
  | { ok: false; code: string; reason: string };

export function defaultOperatorIdentityPolicy(
  trustedHops: readonly string[] = DEFAULT_TRUSTED_HOPS,
): TrustedHopPolicy {
  return defaultTrustedHopPolicy(trustedHops);
}

export function operatorActorFromIdentity(identity: ForwardAuthIdentity): OperatorActor {
  const actor = actorRefFromIdentity(identity);
  return {
    kind: "founder",
    id: actor.id,
    display_name: actor.display_name ?? actor.id,
  };
}

/**
 * Fail-closed. A caller cannot hand in a pre-built actor: the only input is the
 * raw request, and the only writer of the headers it reads is Authelia.
 */
export function resolveOperatorActor(
  request: IdentityRequest | undefined,
  policy: TrustedHopPolicy,
): OperatorIdentityResult {
  if (!request || typeof request.remoteAddress !== "string" || request.remoteAddress === "") {
    return {
      ok: false,
      code: "missing_identity",
      reason: "no authenticated request hop was presented to the operator channel",
    };
  }
  const result: IdentityResult = parseForwardAuthIdentity(request, policy);
  if (!result.ok) {
    return { ok: false, code: result.code, reason: result.reason };
  }
  return { ok: true, actor: operatorActorFromIdentity(result.identity) };
}
