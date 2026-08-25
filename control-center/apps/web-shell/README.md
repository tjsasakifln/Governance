# Control Center web shell

Mobile-first cockpit for Confenge Control Center. It is not chat, not a generic ERP, and not a KPI wall. Production reads its bounded context from the context service; local development can use fixtures.

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

“Operação Warmbly” is the safe-operation cockpit for the outbound kill switch: dispatch state, pause reason, commercial window, approved queue, hourly cap and the recent audit trail are rendered **before** the three controls (pause in one step, resume in two, acknowledge an inbound alert). There is no immediate-send or cohort-dispatch control. In Revisão, candidate APPROVE is the complete per-message scheduling authority: it writes `auto_send=true`, `QUEUED` and `due_at`; the Warmbly worker transports later.

### Rotas do gate humano de cohorts

O gate humano vive **inteiramente** sob “Operação Warmbly”, em três sub-rotas:

| Rota | O que é |
| --- | --- |
| `#/warmbly` (`operacao`) | Resumo do piloto — Fonte → Cohort → Validação → Revisão → Agendamento — mais a versão mais recente, o botão “Abrir revisão” e os controles seguros de pausa/retomada/reconhecimento. |
| `#/warmbly/cohorts` | Lista de cohorts versionadas, denominadores, recuperação e próxima seleção sem repetição (1–10). |
| `#/warmbly/revisao?resource=<id>` | Revisão candidato a candidato; APPROVE agenda a mensagem e o reparo administrativo reprocessa aprovações antigas. |

O `resource` viaja na subnav: abrir “Revisão” a partir de “Cohorts” **não** perde a
versão selecionada, e uma Revisão sem `resource` oferece a lista de versões em vez
de uma página vazia.

Criar usa `NEXT_UNCLAIMED`: claims transacionais por conta, fonte, fornecedor e
destinatário formam cohorts disjuntas sem offset controlável pelo navegador.
`RECOVER_PRIOR` relê os fornecedores de versões vencidas na fonte atual e cria
texto, evidência e hashes novos; não herda APPROVE ou agendamento antigos.

#### Revisão é uma fila de decisões, não um formulário

`#/warmbly/revisao` abre no recorte **Pendentes** (`?estado=pendentes`, que é o
padrão e por isso não aparece na URL) e diz quanto falta:
`N pendentes · N aprovadas · N em ajuste · N no total`. Os recortes
`aprovadas`, `ajuste` e `todas` continuam legíveis e preservam `resource` e o
estado de expansão das mensagens.

No caminho feliz, **uma mensagem válida é aprovada e enfileirada com uma única ação**: sem
motivo digitado, sem caixa de ciência e sem acionar a verificação do destinatário
antes. O clique em Aprovar é a ciência e viaja como `acknowledged=true`; um
APPROVE sem comentário registra `approved_by_human_reviewer` e o comentário
opcional vence esse padrão. Quando o candidato não tem validação vigente, a
própria aprovação pede a verificação ao Warmbly, relê o estado e só registra o
APPROVE se ele voltar `VALID` — caso contrário nada é decidido e a tela diz o
estado observado. O botão é “Aprovar e enfileirar para envio”: a mesma operação
deixa a mensagem com `auto_send=true`, `QUEUED` e `due_at`. Não há GO ou handoff.

A aprovação sai da fila de revisão na hora (otimista) e volta para ela em qualquer desfecho
que não seja aplicação confirmada: recusa, falha, desconhecido, ou releitura que
não confirma APPROVE efetivo e o agendamento. Nada disso é durável — um reload
lê a fila do servidor.

APPROVE continua bloqueado onde verificar de novo não resolve: sem destinatário,
destinatário que não é endereço, veredito já resolvido como `INVALID`/`RISKY`, e
bloqueios materiais declarados pelo servidor (`hard_bounce`, suppression,
opt-out, duplicidade, copy QA, proveniência ausente). HOLD e REJECT continuam
exigindo motivo escrito, e o controle “Verificar o destinatário agora” continua
disponível como escape — só não é mais pré-requisito, e só aparece onde a
validação não é VALID.

Teclado: `A` aprova o card que já está sob o foco (nunca outro), `Ctrl/Cmd+Enter`
aprova a primeira pendência. Nenhum dos dois dispara com o cursor dentro de um
campo de texto — o editor de ajuste vive na mesma página.

#### Agendamento e reparo

A Revisão lê o status outbound do servidor e mostra kill switch/pausa antes de
qualquer trabalho. Com bloqueio ativo, APPROVE continua criando `QUEUED` e
`due_at`, mas a tela diz que nada sairá.

GO/NO-GO e “Entregar à fila” foram removidos do fluxo vivo. Registros antigos
aparecem somente em um disclosure de auditoria, sem efeito operacional. O worker
é quem envia, dentro da janela comercial e sob o teto por hora; o Control Center
não oferece `send`, `dispatch`, `queue` ou `resume` de cohort.

“Reprocessar aprovações já registradas” é um reparo global de `admins`, não um
próximo passo. Ele chama a rota fixa `POST …/cohorts/reconcile-approved`, usa o
mesmo agendador do APPROVE, deduplica candidatos e é idempotente. Os contadores
são os do servidor; campo ausente aparece como ausente, nunca zero. A borda
descarta query string e envia corpo upstream vazio. O teste negativo continua
enumerando `send`, `dispatch`, `queue`, `resume`, `payment`, `charge`, `enroll`
e `deliver` em todas as formas.

A automação global permanece desligada: `CONFENGE_AUTO_SEND_ENABLED=false` e
`GREEN_AUTORUN=false`. O `auto_send=true` mostrado no card pertence somente à
mensagem aprovada.

`#/comercial/cohorts` (“Comercial → Coortes”) é **outra coisa**: são coortes de
aquisição e métricas por período. Nenhum runbook do gate humano deve apontar para
lá — o caminho correto é **Operação Warmbly → Cohorts**. Pausar, retomar e
reconhecer também já não vivem em Comercial; a aba de lá só carrega o ponteiro
para `#/warmbly`.

Autoridade deliberada: `operators` cria, reproduz, pede verificação, ajusta e
registra APPROVE/HOLD/REJECT; APPROVE pode provocar envio futuro e o botão diz
que enfileira. `admins` executa somente o reparo de aprovações já registradas —
sem esse grupo o controle aparece desabilitado e a borda devolve 403 antes do
upstream. A identidade é resolvida pelo Authelia; o navegador não envia ator.

Ajustar assunto/corpo cria uma **nova versão** (`POST …/candidates/{id}/adjust`).
Enquanto essa rota não estiver implantada, a UI trata o 404 como estado esperado,
diz isso e desabilita o editor em vez de oferecer um controle que não escreve.

Hoje is an attention cockpit: open exceptions plus **at most three** current priorities. There is no chat composer. `Comercial → Rascunhos` is the founder's exact-copy review surface: adjust, approve for the next eligible business window, or reject back into editorial recovery. Financial mutations and immediate commercial send are not offered.

### Comercial → Rascunhos: lista + inspector

`#/comercial/rascunhos?resource=<draft-id>` mantém o backlog como linhas compactas
e renderiza assunto, corpo, contexto e controles somente no inspector selecionado.
Mesmo com 500 linhas existe no máximo um `data-review-form` no DOM. Sem
`resource`, a primeira mensagem acionável é selecionada; um deep link ausente
falha para a próxima disponível com aviso explícito.

No caminho feliz há um único CTA: **Aprovar e agendar para <e-mail>**. A classe de
rota não abre checkbox ou modal. Editar e Rejeitar/segurar são links secundários
que abrem modos explícitos do mesmo inspector; não existe dropdown genérico
“Registrar decisão”. Depois de receipt/readback confirmado, a URL seleciona a
próxima mensagem e o foco acompanha o inspector. No mobile o inspector vem antes
da lista completa, e no desktop os dois formam colunas sem um segundo scroll.

O hash também preserva `offset`. A resposta versionada
`control-center.review-draft-page.v1` mantém a página e a cobertura separadas dos
itens: quando o Warmbly prova `pagination.total`, a tela diz **N carregados de M
no servidor**, mostra o restante e habilita Anterior/Próxima conforme a prova.
Sem total, ela diz literalmente que o total não foi informado; `has_more` válido
pode provar apenas a continuidade, nunca o denominador. Metadado contraditório
falha fechado como `UNPROVEN`. Filtros, batch e um cursor opaco novo continuam
fora deste recorte.

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

- Governance remains the strategic/canonical authority; Warmbly remains the commercial/CRM operational authority. The shell renders bounded read models and submits only typed human-review decisions through the context service.
- Persistence of aggregated state (PostgreSQL), HTTP APIs, and MCP for agents land in **later convergence campaigns**. This package copies v1 field names locally (`source`, `observed_at`, `freshness_status`, `confidence`, cents+currency, directive kinds, freshness `FRESH|STALE|UNKNOWN|ERROR`) and does **not** import unpublished sibling `control-center/*` packages.
- The adapter port has fixture and HTTP implementations. Production uses the same-origin `/api/context` proxy; Warmbly credentials stay server-side.
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
