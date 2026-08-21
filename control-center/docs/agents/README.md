# Control Center MCP — agent clients

Private MCP for Grok, Codex, and other JSON-RPC clients. Agents **read scoped
context** and may **report a session result or a blocker**. They cannot create,
alter, activate, revoke, or supersede a `decision` or `constraint`. Founder
approval cannot be forged. Missing or wrong tokens fail closed and return no
records.

This MCP is **loopback / VPN only**. Do not publish it. Do not create
`mcp.confenge.com.br` or any public MCP hostname.

## Tools

Eight canonical dotted names remain for already-working clients:

- `confenge.get_company_state`
- `confenge.get_context`
- `confenge.get_active_directives`
- `confenge.get_priorities`
- `confenge.get_client_context`
- `confenge.get_decisions`
- `confenge.report_session_result`
- `confenge.report_blocker`

Eight undotted **compatibility aliases** call the same implementation, use the
same validation, share the same audit / correlation identity, do not duplicate
activity, and gain no extra capability:

- `get_company_state`
- `get_context`
- `get_active_directives`
- `get_priorities`
- `get_client_context`
- `get_decisions`
- `report_session_result`
- `report_blocker`

Grok 1.0.5 qualifies tools as `<server>__<tool>` and **ignores extra-dot
qualified names**. Native Grok configs therefore use server name `confenge` and
the undotted aliases (`confenge__get_context`). Do not keep a name-rewriting
scratch proxy as the production path.

## Transports

### stdio (default)

The shipped entry `control-center/services/mcp/src/index.ts` speaks MCP JSON-RPC
as NDJSON on stdin/stdout. Logs go to stderr.

```bash
cd control-center/services/mcp
CONFENGE_MCP_AUTH_TOKEN="${CONFENGE_MCP_AUTH_TOKEN}" npm start
```

Handshake: `initialize` → `notifications/initialized` → `tools/list` /
`tools/call`. Present the token as `params._meta.authorization: "Bearer …"` on
stdio, or `Authorization: Bearer …` on HTTP.

### HTTP JSON-RPC

Bind loopback (or a VPN address). Default host is `127.0.0.1`.

```bash
CONFENGE_MCP_AUTH_TOKEN="${CONFENGE_MCP_AUTH_TOKEN}" \
CONFENGE_MCP_HTTP_HOST=127.0.0.1 \
CONFENGE_MCP_HTTP_PORT=8787 \
npm start
```

```
POST http://127.0.0.1:8787/mcp
Authorization: Bearer ${CONFENGE_MCP_AUTH_TOKEN}
Content-Type: application/json
```

Body is one JSON-RPC 2.0 object (no batches). `GET /healthz` is unauthenticated
liveness only and does not serve context. Authelia cookies are not MCP
authentication.

Example `tools/call` (undotted alias):

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "get_context",
    "arguments": { "scope": "repo:Governance" },
    "_meta": { "authorization": "Bearer ${CONFENGE_MCP_AUTH_TOKEN}" }
  }
}
```

Rate limit is per token fingerprint (`sha256` prefix), not per display name.

## Native Grok config

Copy [grok.mcp.toml.example](./grok.mcp.toml.example) into `~/.grok/config.toml`
or a trusted project `.grok/config.toml`. The token is injected from the
environment (`${CONFENGE_MCP_AUTH_TOKEN}`); never commit a live value.

Proof expected from a Grok session that can reach this MCP:

1. `get_context` with `scope=repo:Governance`
2. `report_session_result`
3. `report_blocker`
4. wrong token fail-closed
5. sibling scope does not leak
6. report persists across MCP restart

## Official Codex config

Copy [codex.config.toml.example](./codex.config.toml.example) into
`~/.codex/config.toml` (Codex `[mcp_servers.*]`). Same env expansion. Same
functional proof when Codex is authenticated.

If Codex is not authenticated, the honest state is `NOT_TESTED_CLIENT_MISSING`.
Re-run after `codex login` (or the current Codex auth command):

```bash
codex mcp list
# then start a session that calls get_context / report_session_result / report_blocker
```

Do not declare Codex proven without that transcript.

## Bootstrap of Governance memory

Productive, idempotent import of Git authority into the Control Center DB:

```bash
cd control-center/importers/governance
npx tsx src/bootstrap.ts --dry-run --root ../../..
npx tsx src/bootstrap.ts --apply --allow-control-center-db-write --root ../../..
```

Dry-run is the default. Apply is explicit, writes only the Control Center
database, stamps source path + commit SHA + content hash, classifies
conservatively (ambiguous prose → hypothesis; decision only with an explicit
mark), and reports unclassifiable items. No Git write, no provider write, no
silent PR #8 / partner-program absorption. Candidate count is recomputed on the
observed commit; staging RC 74 is evidence, not a contract.

## Non-goals

- Public MCP hostname
- Scratch name-rewrite proxy as the production client path
- Financial / provider tools
- Authelia cookie auth on MCP
- Agent writes that create or mutate decision / constraint
