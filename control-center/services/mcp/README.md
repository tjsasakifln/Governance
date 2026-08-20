# Confenge Control Center MCP

Isolated MCP server for Grok, Codex, and other agents. It exposes **scoped operational context** and two session-report writes. It is not chat, not an ERP, and not a payment console.

This package lives only under `control-center/services/mcp/`. It boots against **local fixtures** through a **stub Context API adapter**. It does not import or call a sibling Context API, PostgreSQL, Warmbly, Asaas, or any other workstream.

## Decisions

- Governance remains the strategic/canonical authority. Warmbly remains the operational commercial/CRM authority. This server only **aggregates and serves** state.
- Transport default is **stdio NDJSON** (MCP). Optional `POST /mcp` JSON-RPC when `CONFENGE_MCP_HTTP_PORT` is set.
- Protocol subset: `initialize` + `notifications/initialized`, `tools/*`, `resources/*`, `prompts/*`, `ping`. JSON-RPC 2.0. Protocol versions `2024-11-05`, `2025-03-26`, `2025-06-18`.
- Auth token is injected via `CONFENGE_MCP_AUTH_TOKEN`. Requests present `Authorization: Bearer …` (HTTP) or `params._meta.authorization`. Missing env, missing token, or wrong token **fail closed** and do not serve context.
- Every `tools/call` is validated, rate-limited, and tagged with a `correlation_id`.
- Reads are first-class. Writes are only `confenge.report_session_result` and `confenge.report_blocker`. Agents cannot create or alter `decision`, `constraint`, or authoritative `directive`.
- No cobrança, checkout, refund, cancelamento, or Asaas/provider mutation tools exist.
- Aggregated records carry `source`, `observed_at` (UTC), `freshness_status`, and `confidence` when applicable. Money in fixtures is integer cents + currency.
- Scope-taking tools require `scope` or `client` and never return the whole-company dump.

## Run

```bash
cd control-center/services/mcp
npm install
npm test
npm run build
CONFENGE_MCP_AUTH_TOKEN="$(cat /run/secrets/confenge-mcp-token)" npm start
```

Dev (TypeScript, same entry as production):

```bash
CONFENGE_MCP_AUTH_TOKEN="inject-me" npm run dev
```

Optional HTTP JSON-RPC:

```bash
CONFENGE_MCP_AUTH_TOKEN="inject-me" CONFENGE_MCP_HTTP_PORT=8787 npm start
# POST /mcp   Authorization: Bearer …
# GET  /healthz
```

Clients must send `initialize`, then `notifications/initialized`, then preflight (`prompts/get confenge.session_preflight` and/or `resources/read confenge://preflight/checklist`) before acting.

## Environment

| Variable | Required | Meaning |
| --- | --- | --- |
| `CONFENGE_MCP_AUTH_TOKEN` | yes, to serve context | Shared bearer token. Inject from a secret manager. Never commit a real value. |
| `CONFENGE_MCP_RATE_LIMIT_MAX` | no (default 30) | Max `tools/call` per window per token fingerprint |
| `CONFENGE_MCP_RATE_LIMIT_WINDOW_MS` | no (default 60000) | Rate-limit window |
| `CONFENGE_MCP_HTTP_PORT` | no | If set, listen HTTP instead of stdio |
| `CONFENGE_MCP_HTTP_HOST` | no (default 127.0.0.1) | HTTP bind host |

Logs are structured JSON on **stderr**. Authorization values, tokens, and secrets are redacted. Do not put the token in URLs, query strings, or analytics.

## MCP surface

Tools (exact names):

- `confenge.get_company_state`
- `confenge.get_context` (`scope` required)
- `confenge.get_active_directives` (`scope` required)
- `confenge.get_priorities`
- `confenge.get_client_context` (`client` required)
- `confenge.get_decisions` (`since` optional, ISO-8601 UTC)
- `confenge.report_session_result`
- `confenge.report_blocker`

Resources:

- `confenge://preflight/checklist`
- `confenge://preflight/scopes`
- `confenge://session/operating-rules`

Prompts:

- `confenge.session_preflight`
- `confenge.session_close`

## Stub Context API contract

Local port: `ContextApiPort` in `src/types.ts`. Fixture adapter: `src/stub-adapter.ts`.

```ts
interface ContextApiPort {
  getCompanyState(): Promise<CompanyState>;
  getContext(scope: string): Promise<ScopedContext>;
  getActiveDirectives(scope: string): Promise<DirectiveRecord[]>;
  getPriorities(): Promise<PriorityRecord[]>;
  getClientContext(client: string): Promise<ClientContext>;
  getDecisions(since?: string): Promise<DecisionRecord[]>;
  reportSessionResult(input: SessionResultInput): Promise<WriteReceipt>;
  reportBlocker(input: BlockerInput): Promise<WriteReceipt>;
}
```

Rules the adapter must keep:

- Unknown `scope` / `client` fail closed (no dump of everything).
- `getContext` / `getActiveDirectives` return only the requested scope.
- `getClientContext` returns only that client.
- Whole-company internal memory is never a tool response.
- Directive records include `kind`, `scope`, `status`, `effective_from`, `expires_at`, `supersedes`, `created_by`, and `audit`.
- Provenance fields on every aggregated record.

This campaign does **not** HTTP-call a future Context service. The stub is the integration seam.

## Convergence (later campaign)

A later campaign should:

1. Implement `ContextApiPort` against the real Control Center Context API / PostgreSQL read model (owned by other workstreams). Inject it in `src/index.ts` instead of `createStubContextApi()`.
2. Keep these eight tool names, resource URIs, and prompt names stable.
3. Continue injecting `CONFENGE_MCP_AUTH_TOKEN` from secret storage; do not add identity/password hardcoding.
4. Keep financial/provider mutation out of this process. Collectors and Asaas stay elsewhere.
5. Preserve fail-closed auth, rate limits, structured errors, and correlation ids.
6. Do not fold this package into `commercial/`, Warmbly, extra-cli, or PR Governance #8.

## Tests

```bash
npm test
```

Protocol tests drive the shipped JSON-RPC handler. Abuse tests cover missing/wrong token, malformed JSON-RPC, unknown tool, missing scope/client, and rate limits. Launch tests spawn `src/index.ts` over stdio and run preflight → `get_context` → `report_session_result` twice.
