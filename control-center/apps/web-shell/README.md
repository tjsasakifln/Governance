# Control Center web shell

Mobile-first cockpit for Confenge Control Center. This workstream is **fixture-backed and decoupled from a live backend**. It is not chat, not a generic ERP, and not a KPI wall.

## Destinations

Chrome navigation exposes exactly these ten areas:

1. Hoje
2. Comercial
3. Operação Warmbly
4. Clientes
5. Financeiro
6. Engenharia
7. Infra
8. Crescimento
9. Memória/Decisões
10. Agentes

“Operação Warmbly” is the safe-operation cockpit for the outbound kill switch: dispatch state, pause reason, commercial window, approved queue, hourly cap and the recent audit trail are rendered **before** the three controls (pause in one step, resume in two, acknowledge an inbound alert). There is no send control there and there must never be one.

Hoje is an attention cockpit: open exceptions plus **at most three** current priorities. There is no chat composer. Financial and commercial-send mutations (cobrança, checkout, refund, cancelamento, Asaas write, commercial send) are not offered.

## Decisions (local)

- Governance remains the strategic/canonical authority; Warmbly remains the commercial/CRM operational authority. This shell only renders a read-model recorte.
- Persistence of aggregated state (PostgreSQL), HTTP APIs, and MCP for agents land in **later convergence campaigns**. This package copies v1 field names locally (`source`, `observed_at`, `freshness_status`, `confidence`, cents+currency, directive kinds, freshness `FRESH|STALE|UNKNOWN|ERROR`) and does **not** import unpublished sibling `control-center/*` packages.
- Mock adapters are the only I/O. They never `fetch`. Swap the adapter implementation later; keep the `ControlCenterReadAdapter` port.
- Single-user human is implicit. The operator is an opaque display handle (`human:operator`). No identity, password, or secret is hardcoded.
- Dates are UTC in data (`…Z`). Presentation uses `America/Sao_Paulo`.
- PWA: a web manifest + SVG icons only. No service worker / offline cache.

## Run (no env vars required)

```bash
cd control-center/apps/web-shell
npm install
npm test
npm run dev          # http://127.0.0.1:5173
npm run build
npm run preview      # http://127.0.0.1:4173
```

Do not open `index.html` via `file:`. The page detects that protocol and tells you to use `npm run dev` or `npm run preview`.

### Mock view states

Each destination is independently exercisable:

- `#/hoje` ready fixture data
- `#/hoje?view=loading`
- `#/hoje?view=error`
- `#/hoje?view=stale`
- `#/hoje?view=empty`

The chrome also exposes a labeled “Estado da vista (mock)” control (keyboard-accessible).

## Env vars

None required for mock mode. Do not put secrets in git, URLs, logs, analytics, or the client bundle. There is no analytics SDK here.

## Expected later convergence

| Later workstream | Expected swap |
| --- | --- |
| `control-center/contracts` | Replace local types with the published JSON Schema / TS package. Field names already match v1. |
| Context / HTTP API | `MockControlCenterAdapter` → HTTP read adapter. Keep provenance on every aggregated record. |
| MCP server | Agents consume scoped context via MCP, not this UI. |
| PostgreSQL | Operational aggregate + structured memory. This UI stays a client. |
| Collectors (GitHub, Warmbly, Asaas, infra) | Feed the read models this shell already shapes. |

Do not merge this package into `commercial/`, `decisions/`, `scripts/`, or other Control Center workstreams in this campaign.

## Tests

```bash
npm test
npm run typecheck
```

Unit/contract tests drive the shipped registry, mock adapters, Hoje selection, view-state helpers, and provenance mapping.
