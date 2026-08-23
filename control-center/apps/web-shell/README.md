# Control Center web shell

Mobile-first cockpit for Confenge Control Center. This workstream is **fixture-backed and decoupled from a live backend**. It is not chat, not a generic ERP, and not a KPI wall.

## Destinations

Chrome navigation exposes exactly these eight areas:

1. Hoje
2. Comercial
3. Clientes
4. Financeiro
5. Engenharia
6. Infra
7. Memória/Decisões
8. Agentes

Hoje is an attention cockpit: open exceptions plus **at most three** current priorities. There is no chat composer. Financial and commercial-send mutations (cobrança, checkout, refund, cancelamento, Asaas write, commercial send) are not offered.

## Cards de alerta

Alertas (top 3 e incidentes) usam um card com duas metades, montado em
`src/alerts.ts` e `src/ui/alert-card.ts`:

- **Frente** — gravidade em português, impacto em linguagem simples, origem
  (sistema · tipo · locator), área responsável com link, idade desde a detecção,
  prazo/SLA e **O que fazer agora** com a ação segura recomendada.
- **`Como foi priorizado`** — bloco recolhido (`<details>`) com a prosa do motor
  de atenção (`Score … = peso_categoria … × freshness_bp … × confidence_bp …`,
  `KILL-RULE`), as evidências e a proveniência completa. Nenhum desses termos
  aparece fora do bloco recolhido.

Distinção visual obrigatória: `data-alert-class` separa `incidente` (gravidade
crítica/alta), `acao` (média) e `ajuste` (baixa, ou categoria `estetica`/`refactor`).
Um ajuste estético nunca usa a faixa de incidente.

O prazo/SLA é **política deste cockpit**, não um campo upstream: nenhum contrato
carrega data-limite para um item de atenção, e o card diz isso.

“Reconhecer” grava `ACKNOWLEDGE_EXCEPTION` em `POST /v1/operator-actions`. Isso
**não** resolve o incidente, não altera Warmbly/Asaas/GitHub e não transiciona
`AttentionItem.status` — nada no backend transiciona esse campo hoje. O item
continua no ranking (`eligible_statuses = ["open","acknowledged"]`). Não há
controle de resolver ou dispensar, porque não há escrita que o sustente.

Responsável é **área**, não pessoa: nenhum contrato carrega responsável nominal.

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
