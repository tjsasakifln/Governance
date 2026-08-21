# Control Center — Directives UI

UX mobile-first para registrar memória estratégica estruturada (`control-center.directive.v1`).

Não é chat. Não é ERP. Não substitui Warmbly nem os sistemas de origem. Não executa cobrança, checkout, refund, cancelamento, escrita Asaas ou envio comercial.

Este pacote é autônomo: o mock vive aqui. A convergência posterior deve trocar o adapter local pelo HTTP de `control-center/services/context`, pinando `control-center/contracts/`.

## Decisões

1. Contrato local duplicado de `control-center.directive.v1` (kinds, statuses, campos obrigatórios, scopes string). Sibling contracts/context-service são read-only e **não** são importados.
2. Sete kinds: `decision`, `directive`, `fact`, `constraint`, `priority`, `risk`, `hypothesis`. Não há tipo padrão no formulário — o operador escolhe e **confirma** o tipo. Decisão não pode ser gravada como fato por omissão.
3. `hypothesis` é visualmente e textualmente distinta (não autoritativa; não é fato nem decisão). O preview de agente a separa das listas autoritativas.
4. História nunca é reescrita em silêncio. Não existe “editar”. **Supersede** é ação explícita: o predecessor permanece legível como `superseded` (body/kind congelados) e nasce um sucessor com `supersedes`.
5. Preview “contexto que um agente verá para scope X”: match **exato** de scope string v1. Sem dump da empresa. Sem herança `{company,domain,resource}` — isso é do context-service e fica para a convergência.
6. Identidade single-user via handles opacos (`CONTROL_CENTER_FOUNDER_ACTOR_ID`, `CC_ACTOR_ID`, `CC_ACTOR_ROLE`). **Não é senha.** Mutação fail-closed se o ator não for o founder configurado. O HTML local só carrega handles de mock.
7. Datas internas em UTC (`…Z`). Apresentação pode usar `America/Sao_Paulo`.
8. Informação agregada na UI (lista/preview) carrega `source`, `observed_at`, `freshness_status`, `confidence`.
9. Adapter desta onda: `MockDirectiveService` (`mode: "mock"`). Sem PostgreSQL, sem MCP, sem HTTP vivo.

## Como rodar

Node.js ≥ 20.

```bash
cd control-center/apps/directives-ui
npm install
npm test
npm run typecheck
npm start
# http://127.0.0.1:4177/
```

`npm start` gera `dist/app.js` (IIFE, `<script src>` clássico) e serve o diretório. Abrir o `index.html` via `file:` só funciona **depois** do build; caso contrário a página explica o comando. Não há tela preta silenciosa.

Scripts: `npm run build`, `npm run serve` (porta `PORT`, default `4177`, bind `127.0.0.1`).

## Variáveis de ambiente

Somente **nomes**. Não commitar `.env`. Nenhum valor secreto abaixo.

| Variável | Obrigatória | Função |
|---|---|---|
| `CONTROL_CENTER_FOUNDER_ACTOR_ID` | na convergência | handle opaco do founder (não é senha) |
| `CC_ACTOR_ID` | na convergência | handle opaco do ator da sessão |
| `CC_ACTOR_ROLE` | na convergência | `founder` \| `operator` \| `agent` |
| `CC_USE_MOCK_IDENTITY` | não | `0` recusa defaults de mock (fail-closed). Qualquer outro valor (incluindo ausente neste workstream) permite o handle local `human:founder` |
| `HOST` / `PORT` | não | bind do `scripts/serve.mjs`; default `127.0.0.1:4177` |

No browser, os mesmos nomes são lidos de `<meta name="cc-founder-actor-id">` etc. São handles de mock, não credenciais.

## Adapter local e convergência esperada

Porto atual (`src/service.ts`):

- `list(filter)` — busca + filtro por `kind`, `scope`, `status`
- `create(input)` / `createFromDraft(draft)` — exige `kindConfirm === kind`
- `supersede(id, input)` — predecessor `superseded`, sucessor novo
- `preview(scope)` — contexto mínimo daquele scope
- `identity()` / founder approval

Handoff posterior (não implementado aqui):

1. Substituir `MockDirectiveService` por HTTP privado de `control-center/services/context` (`POST /v1/directives`, `POST /v1/directives/:id/supersede`, `GET /v1/context?…`).
2. Pinar schemas em `control-center/contracts/` (`directive.v1`, `agent-context.v1`).
3. Mapear scopes string v1 (`company`, `finance`, `client:slug`, …) para `{ company, domain, resource }` do context-service. Status v1 `draft`/`revoked` ↔ `inactive` do serviço. Não misturar os dois modelos neste pacote.
4. MCP permanece a interface principal dos agentes; esta UI é humana.
5. Não alterar `commercial/`, `decisions/`, `scripts/`, README raiz, Warmbly, nem o PR Governance #8.

## Fora de escopo

PostgreSQL, MCP runtime, homepage/KPI, mutações em provedores, edição in-place, auth multi-user, senha hardcoded.
