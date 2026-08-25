# Control Center — context service

Serviço de memória estratégica e diretivas do Confenge Control Center.

Não é chat. Não é ERP. Não substitui Warmbly. Agrega estado canônico mínimo para uma sessão de agente **por escopo**, com proveniência, herança controlada e trilha de auditoria.

Este pacote é autônomo: o repositório ainda não tem toolchain TypeScript na raiz. A convergência posterior deve ligar `control-center/contracts/`, `control-center/persistence/` e `control-center/services/mcp/` sem reescrever a política daqui.

## Decisões

1. **Sete kinds** fechados: `decision`, `directive`, `fact`, `constraint`, `priority`, `risk`, `hypothesis`. Kind é imutável na linhagem; mudar kind exige `supersede`.
2. **CRUD lógico** = create + read + nova versão + supersede + expire + activate/revoke. Sem delete físico. Revisões anteriores permanecem legíveis. Status canônicos: `draft|active|superseded|revoked|expired`.
3. **Mutação é founder/human-only**, fail-closed. Identidade vem de `CONTROL_CENTER_FOUNDER_ACTOR_ID` + headers/CLI `X-Actor-Id` / `X-Actor-Kind` / `CONTEXT_ACTOR_*`. Não há senha, identidade hardcoded ou admin bypass.
4. **Agente** lê por escopo e **só** escreve em `/v1/proposals` (`DirectiveProposal`). Proposal **não** ativa, expira, revoga ou substitui `constraint`/`decision` ativas.
5. **Herança controlada**: `repo:x` recebe `company` + domínio **explicitamente configurado** para aquele repo + `repo:x`. `client:y` recebe `company` + `clients` + `client:y`. Não desce para filhos, não vaza irmãos, não despeja a memória da empresa.
6. **`hypothesis` não é `fact` nem `decision`**. `get_decisions()` nunca devolve hypothesis. `get_context` separa as listas.
7. Toda diretiva carrega `scope` (string), `status`, `effective_from`, `expires_at`, `supersedes` (lista de IDs `cc:*` ou null), `created_by` (`ActorRef`). Itens agregados carregam proveniência `source` (`SourceRef`), `observed_at`, `freshness_status` (`FRESH|STALE|UNKNOWN|ERROR`) e `confidence`. `ERROR` nunca é reescrito como `UNKNOWN`.
8. Datas internas em UTC (`...Z`). Valores financeiros, se citados no texto, são centavos inteiros + currency — este serviço não persiste ledger.
9. Logs JSON estruturados. Proibido logar body, PII, secrets, `DATABASE_URL` ou nomes de campos secretos.
10. PostgreSQL é a persistência alvo da campanha, mas **este workstream não é dono do schema**. Adapter local = fixture in-memory (`PersistencePort`). Se `DATABASE_URL` estiver setado, o boot recusa fallback silencioso. `expected-schema.sql` é contrato de teste, não autoridade de runtime.

## Operações expostas (contrato para MCP / UI)

| Operação | Quem | Efeito |
|---|---|---|
| `createDirective` | human founder | cria revisão 1; `supersedes` lista fecha predecessores |
| `createVersion` | human founder | nova revisão, linhagem preservada |
| `supersede` | human founder | fecha uma ou mais linhagens (`superseded`) e cria sucessora |
| `expire` / `activate` / `revoke` | human founder | nova revisão de status |
| `getDirective` / `listRevisions` | human founder, agent | leitura, inclusive histórico |
| `submitProposal` | agent | sugestão pendente; **não** altera o conjunto ativo |
| `get_context(scope)` | human founder, agent | contexto mínimo determinístico do escopo |
| `get_active_directives(scope)` | human founder, agent | conjunto ativo com herança |
| `get_priorities()` | human founder, agent | priorities ativas no escopo `company` (ou query) |
| `get_decisions()` | human founder, agent | **somente** `kind=decision` |

HTTP (privado, bind default `127.0.0.1`):

```
GET  /healthz
GET  /v1/context?scope=
GET  /v1/active-directives?scope=
GET  /v1/priorities
GET  /v1/decisions
POST /v1/directives
POST /v1/directives/:id/versions
POST /v1/directives/:id/supersede
POST /v1/directives/:id/expire
POST /v1/directives/:id/activate
POST /v1/directives/:id/revoke
GET  /v1/directives/:id
GET  /v1/directives/:id/revisions
POST /v1/proposals
GET  /v1/proposals
GET  /v1/commercial/review-drafts
GET  /v1/commercial/review-drafts/:id
POST /v1/commercial/review-drafts/:id
POST /v1/commercial/review-batches
```

As quatro rotas comerciais são uma ponte server-side protegida pela identidade operacional autenticada no edge para o human gate do Warmbly. `APPROVE` vincula `expected_content_hash` e agenda a próxima janela útil; não existe envio imediato nessa ponte.

A listagem devolve `control-center.review-draft-page.v1`: `limit`, `offset` e
`loaded_count` descrevem o recorte solicitado. `total_count`,
`remaining_count`, `has_more` e `next_offset` só sobrevivem quando a paginação
do Warmbly é válida e coerente. Ausência, tipo inválido, total menor que os itens
observados ou continuidade contraditória resulta em `coverage_status=UNPROVEN`;
o tamanho da página nunca é promovido a total do servidor.

A resposta 2xx do write não é prova de efeito. Para uma decisão individual, a ponte parseia o envelope do Warmbly, executa `GET /v1/confenge/review/drafts/:id` e devolve `control-center.review-decision-receipt.v1`. `APPROVE` só sai como `confirmed` quando write e readback concordam em ID, hash/approved hash, operador, instante e `QUEUED|SENT`, com `due_at == scheduled_for` em `QUEUED`. Corpo vazio, divergência ou readback indisponível vira `not_confirmed` e orienta a não repetir antes de reler com a mesma `Idempotency-Key`.

Headers obrigatórios em tudo exceto `/healthz`: `X-Actor-Id`, `X-Actor-Kind` (`human` | `agent` | `system`).

## Como rodar

```bash
cd control-center/services/context
npm install
npm test
```

Entrada HTTP (fixture representativa):

```bash
CONTROL_CENTER_FOUNDER_ACTOR_ID=founder-local \
CONTEXT_SERVICE_FIXTURE=representative \
HOST=127.0.0.1 PORT=8787 \
npm start
```

Entrada in-process / CLI (mesmo `bootFromEnv` + `createContextService`):

```bash
CONTROL_CENTER_FOUNDER_ACTOR_ID=founder-local \
CONTEXT_ACTOR_ID=agent-session-1 \
CONTEXT_ACTOR_KIND=agent \
CONTEXT_SERVICE_FIXTURE=representative \
npx tsx src/cli.ts get_context --scope repo:Governance
```

Comandos CLI: `get_context`, `get_active_directives`, `get_priorities`, `get_decisions`.

## Variáveis de ambiente

Valores abaixo são **nomes e exemplos não-secretos**. Não commitar `.env`.

| Variável | Obrigatória | Função |
|---|---|---|
| `CONTROL_CENTER_FOUNDER_ACTOR_ID` | sim | id opaco do founder human (não é senha) |
| `CONTROL_CENTER_REPO_DOMAINS` | não | mapa `repo:domain` para herança; default representativo `Governance:commercial,Warmbly:commercial` |
| `CONTEXT_SERVICE_FIXTURE` | não | `empty` (default) ou `representative` |
| `CONTEXT_ACTOR_ID` / `CONTEXT_ACTOR_KIND` | CLI sim | ator da sessão CLI (`human` \| `agent` \| `system`) |
| `HOST` / `PORT` | não | bind HTTP; default loopback `127.0.0.1:8787` |
| `DATABASE_URL` | não | se setada, o processo **recusa** o fixture (convergência) |
| `WARMBLY_BASE_URL` | revisão comercial | origem privada/loopback da API Warmbly |
| `WARMBLY_API_TOKEN` | revisão comercial | credencial server-side com leitura e escrita de contatos; nunca vai ao browser |

## Adapter de persistência (handoff)

Interface: `src/store/adapter.ts` (`PersistencePort`, versão `control-center.context.persistence.v1`).

Implementação desta onda: `src/store/fixture.ts`.

SQL esperado (contrato de teste; **não** aplicar e **não** carregar em runtime): `src/store/expected-schema.sql`.

Regra de convergência: `control-center/persistence/` deve implementar o port e gravar o audit **na mesma transação** da mutação. Este serviço não importa essa árvore.

## Handoff esperado

| Destino | O que consome |
|---|---|
| `control-center/contracts/` | kinds, scope string, ActorRef, SourceRef, freshness, payload de `get_context` |
| `control-center/persistence/` | `PersistencePort` + SQL de teste |
| `control-center/services/mcp/` | as quatro operações de leitura + proposals; **sem** mutação financeira |

Fora de escopo aqui: UI, MCP, collectors, Warmbly, Asaas, `commercial/`, PR Governance #8, adapter Postgres real.

## Limites

- JSON ≤ 32 KiB
- title ≤ 200, body ≤ 8000, rationale ≤ 4000
- campos desconhecidos rejeitados
- `created_by` é sempre o ator autenticado
- IDs `cc:<type-kebab>:<ulid-or-slug>`


## Warmbly operator channel

Off unless every one of these is set. Missing any of them leaves the channel
unmounted and every `/v1/warmbly/operator/*` route answering `404`.

| Variable | Meaning |
| --- | --- |
| `CC_WARMBLY_OPERATOR_ENABLED` | exactly `true`; anything else keeps it off |
| `CC_WARMBLY_BASE_URL` | Warmbly base URL for the write client |
| `CC_WARMBLY_OPERATOR_TOKEN` | bearer for those writes |
| `CC_WARMBLY_OPERATOR_TRUSTED_HOPS` | comma-separated CIDRs allowed to present `Remote-*` |

`CC_WARMBLY_OPERATOR_TRUSTED_HOPS` is deliberately **not** `CC_TRUSTED_PROXY_CIDRS`
and has no default. The shared value is `10.89.0.0/24`, which is the whole
`cc_edge` network: `caddy` sits there at `10.89.0.2`, but so do `authelia`,
`context`, `web`, `mcp` and `collector`. Reads have lived behind that CIDR for a
while and that is a defensible tradeoff. A write that resumes outbound cold email
is not: any container on the network could forge `Remote-User: tiago` and get a
resume executed and ledgered as the founder, without Authelia ever being asked.

In the production-edge overlay the correct value is the caddy address alone:

```
CC_WARMBLY_OPERATOR_TRUSTED_HOPS=10.89.0.2/32
```

If it is unset the channel refuses to mount and logs
`warmbly.operator.trusted_hop_required`. Failing closed is the intended
behaviour: the hop that may speak for Authelia has to be named on purpose.

Operator writes also require `content-type: application/json`. A cross-origin
`<form enctype="text/plain">` POST is CORS-simple, so no preflight runs and the
`same_site: lax` session cookie is still sent from any `*.confenge.com.br` page;
requiring JSON is what a form cannot satisfy.
