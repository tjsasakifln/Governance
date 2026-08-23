import type { IncomingMessage } from "node:http";
import {
  actorRefFromIdentity,
  defaultTrustedHopPolicy,
  parseForwardAuthIdentity,
} from "@confenge/control-center-security";
import { authError } from "../errors.ts";
import type { ActorRef } from "../types.ts";

export type OperatorActorResolver = (req: IncomingMessage) => ActorRef;

/**
 * A write actor comes only from Authelia headers presented by the explicitly
 * trusted edge hop. Browser-controlled x-actor-* headers are intentionally not
 * consulted here.
 */
export function createOperatorActorResolverFromEnv(
  env: NodeJS.ProcessEnv,
): OperatorActorResolver | undefined {
  const trustedHops = (env.CC_OPERATOR_ACTION_TRUSTED_HOPS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (trustedHops.length === 0) return undefined;
  const policy = defaultTrustedHopPolicy(trustedHops);
  return (req) => {
    const result = parseForwardAuthIdentity(
      {
        remoteAddress: req.socket.remoteAddress ?? "",
        headers: req.headers,
        rawHeaders: req.rawHeaders,
      },
      policy,
    );
    if (!result.ok) {
      throw authError("missing_actor", `operator identity denied: ${result.code}`);
    }
    return actorRefFromIdentity(result.identity);
  };
}
