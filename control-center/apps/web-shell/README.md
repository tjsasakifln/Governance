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

### Rotas do gate humano de cohorts

O gate humano vive **inteiramente** sob “Operação Warmbly”, em três sub-rotas:

| Rota | O que é |
| --- | --- |
| `#/warmbly` (`operacao`) | Resumo do piloto — Fonte → Cohort → Validação → Revisão → GO → Handoff — mais a versão mais recente, o botão “Abrir revisão” e os três controles de disparo. |
| `#/warmbly/cohorts` | Lista de cohorts versionadas, com os denominadores do preview e a criação de uma cohort pequena (1–10). |
| `#/warmbly/revisao?resource=<id>` | Revisão candidato a candidato da versão escolhida, e o registro de GO/NO-GO. |

O `resource` viaja na subnav: abrir “Revisão” a partir de “Cohorts” **não** perde a
versão selecionada, e uma Revisão sem `resource` oferece a lista de versões em vez
de uma página vazia.

`#/comercial/cohorts` (“Comercial → Coortes”) é **outra coisa**: são coortes de
aquisição e métricas por período. Nenhum runbook do gate humano deve apontar para
lá — o caminho correto é **Operação Warmbly → Cohorts**. Pausar, retomar e
reconhecer também já não vivem em Comercial; a aba de lá só carrega o ponteiro
para `#/warmbly`.

Autoridade: `operators` cria, reproduz, pede verificação, ajusta e registra
APPROVE/HOLD/REJECT. `admins` é exigido para GO/NO-GO — sem esse grupo o controle
aparece desabilitado com o motivo, e nunca escondido em silêncio. A identidade é
resolvida pelo Authelia na borda; esta tela não envia cabeçalho de ator em
nenhuma escrita do gate.

Ajustar assunto/corpo cria uma **nova versão** (`POST …/candidates/{id}/adjust`).
Enquanto essa rota não estiver implantada, a UI trata o 404 como estado esperado,
diz isso e desabilita o editor em vez de oferecer um controle que não escreve.

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

## Language: pt-BR on the surface, raw tokens in the data

There is no i18n framework here and there does not need to be one: the shell
speaks pt-BR and `src/ui/labels.ts` is the single catalogue of visible text for
every enum and technical code (precedent: `apps/directives-ui/src/ui/labels.ts`).

Three invariants hold together, and `tests/labels.test.ts` enforces all three:

- **Visible text is Portuguese.** No route may show a raw enum (`FRESH`,
  `BLOCKED`, `RUNNING`), a schema name, or an implementation term in the text an
  operator reads.
- **Raw tokens stay in the data.** `data-freshness`, `data-status`,
  `data-hop-status`, `data-severity`, `data-raw` and friends keep the original
  token: the Playwright probe and the contract tests read them, and changing
  them would break the pipeline, not just the copy.
- **Nothing is deleted.** Identifiers, schema versions, locators and the raw
  enums live on in a collapsed, selectable `<details class="tech">` block
  rendered by `technicalDetails()`. Progressive disclosure, not removal.

Concepts an operator cannot avoid — atualização (freshness), confiança
(confidence), bloqueio (blocked), ausência (absent) — carry their explanation in
`title`/`data-help` via `helpTerm()`.

A code the backend never enumerated (Warmbly sends free-text exception codes) is
shown exactly as it arrived rather than guessed at.

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
