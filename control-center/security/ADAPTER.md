# Adapter — later HTTP / MCP / UI identity consumption

This workstream does **not** edit sibling Control Center services. They should consume the ForwardAuth contract at convergence.

## Contract

After Caddy `forward_auth` to Authelia `/api/authz/forward-auth` succeeds, the proxy injects:

| Header | Field |
|---|---|
| `Remote-User` | opaque operator id |
| `Remote-Groups` | comma-separated; must include `operators` |
| `Remote-Name` | display name |
| `Remote-Email` | email |

Trust those headers **only** from `CC_TRUSTED_PROXY_CIDRS` (immediate TCP peer). Deny otherwise.

Duplicated identity headers fail closed. A `Remote-*` header that arrives more
than once (an array-valued header from a mount that does not join duplicates)
yields no value at all, so a client-supplied copy can never beat the value the
proxy appends — Node's own `http` server joins duplicates into one string and is
denied for the same reason.

Public unauthenticated paths: `/healthz`, `/livez`. Payload from `healthPayload()` → `{"status":"ok"}`.

## Suggested call

```ts
import {
  parseForwardAuthIdentity,
  isPublicUnauthenticatedPath,
  healthPayload,
  defaultTrustedHopPolicy,
} from "@confenge/control-center-security";

const cidrs = (process.env.CC_TRUSTED_PROXY_CIDRS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const policy = defaultTrustedHopPolicy(cidrs);

if (isPublicUnauthenticatedPath(req.url)) {
  return json(healthPayload());
}

const result = parseForwardAuthIdentity(
  { remoteAddress: req.socket.remoteAddress ?? "", headers: req.headers },
  policy,
);
if (!result.ok) {
  return deny(401);
}
// result.identity.user → ActorRef.id (never a password)
```

Do not synthesize an actor when headers are absent. Do not read `X-Forwarded-For` for hop trust.

MCP context remains scoped; this edge does not dump company memory to agents.
