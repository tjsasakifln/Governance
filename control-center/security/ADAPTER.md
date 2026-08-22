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

Duplicated identity headers fail closed, but only if the caller passes
`rawHeaders`. Node's `http` server does **not** deny a duplicate: it joins the
values with `", "` into one string. For `Remote-Groups` that string is then split
back into a group list, so a client-sent `Remote-Groups: operators` appended to
the proxy's `viewers` yields both groups — an escalation `headers` alone cannot
see, because it is indistinguishable from a legitimate two-group value.

`parseForwardAuthIdentity` therefore counts occurrences in `IdentityRequest.rawHeaders`
and denies any `Remote-*` sent more than once. An array-valued header (a mount
that does not join) is denied separately in `headerValue`. **A caller that omits
`rawHeaders` loses the duplicate check**: forward `req.rawHeaders` wherever
identity decides a write.

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
