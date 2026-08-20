# Control Center — context service

Serviço de memória estratégica e diretivas do Confenge Control Center.

Não é chat. Não é ERP. Não substitui Warmbly. Agrega estado canônico mínimo para uma sessão de agente **por escopo**, com proveniência, herança controlada e trilha de auditoria.

Este pacote é autônomo: o repositório ainda não tem toolchain TypeScript na raiz. A convergência posterior deve ligar `control-center/contracts/`, `control-center/persistence/` e `control-center/services/mcp/` sem reescrever a política daqui.

## Decisões

1. **Sete kinds** fechados: `decision`, `directive`, `fact`, `constraint`, `priority`, `risk`, `hypothesis`. Kind é imutável na linhagem; mudar kind exige `supersede`.
2. **CRUD lógico** = create + read + nova versão + supersede + expire + activate/deactivate. Sem delete físico. Revisões anteriores permanecem legíveis.
3. **Mutação é founder-only**, fail-closed. Identidade vem de `CONTROL_CENTER_FOUNDER_ACTOR_ID` + headers/CLI `X-Actor-Id` / `CONTEXT_ACTOR_*`. Não há senha ou identidade hardcoded.
4. **Agente** lê por escopo e **só** escreve em `/v1/proposals`. Proposal **não** ativa, expira ou substitui `constraint`/`decision` ativas.
5. **Herança controlada**: um lookup em recurso recebe `company` + aquele `domain` + aquele `resource`. Não desce para filhos, não vaza irmãos, não despeja a memória da empresa.
6. **`hypothesis` não é `fact` nem `decision`**. `get_decisions()` nunca devolve hypothesis. `get_context` separa as listas.
7. Toda diretiva carrega `scope`, `status`, `effective_from`, `expires_at`, `supersedes`, `created_by`. Itens agregados carregam `source`, `observed_at`, `freshness_status` e `confidence` quando definido.
8. Datas internas em UTC (`...Z`). Valores financeiros, se citados no texto, são centavos inteiros + currency — este serviço não persiste ledger.
9. Logs JSON estruturados. Proibido logar body, PII, secrets, `DATABASE_URL` ou nomes de campos secretos.
10. PostgreSQL é a persistência alvo da campanha, mas **este workstream não é dono do schema**. Adapter local = fixture in-memory. Se `DATABASE_URL` estiver setado, o boot recusa fallback silencioso.

## Operações expostas (contrato para MCP / UI)

| Operação | Quem | Efeito |
|---|---|---|
| `createDirective` | founder | cria revisão 1 |
| `createVersion` | founder | nova revisão, linhagem preservada |
| `supersede` | founder | fecha a linhagem antiga (`superseded`) e cria sucessora |
| `expire` / `activate` / `deactivate` | founder | nova revisão de status |
| `getDirective` / `listRevisions` | founder, agent | leitura, inclusive histórico |
| `submitProposal` | agent | sugestão pendente; **não** altera o conjunto ativo |
| `get_context(scope)` | founder, agent | contexto mínimo determinístico do escopo |
| `get_active_directives(scope)` | founder, agent | conjunto ativo com herança |
| `get_priorities()` | founder, agent | priorities ativas no escopo company (ou query) |
| `get_decisions()` | founder, agent | **somente** `kind=decision` |

HTTP (privado, bind default `127.0.0.1`):

```
GET  /healthz
GET  /v1/context?company=&domain=&resource=
GET  /v1/active-directives?company=&domain=&resource=
GET  /v1/priorities
GET  /v1/decisions
POST /v1/directives
POST /v1/directives/:id/versions
POST /v1/directives/:id/supersede
POST /v1/directives/:id/expire
POST /v1/directives/:id/activate
POST /v1/directives/:id/deactivate
GET  /v1/directives/:id
GET  /v1/directives/:id/revisions
POST /v1/proposals
GET  /v1/proposals
```

Headers obrigatórios em tudo exceto `/healthz`: `X-Actor-Id`, `X-Actor-Role` (`founder` | `agent`).

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
CONTROL_CENTER_COMPANY=confenge \
HOST=127.0.0.1 PORT=8787 \
npm start
```

Entrada in-process / CLI (mesmo `bootFromEnv` + `createContextService`):

```bash
CONTROL_CENTER_FOUNDER_ACTOR_ID=founder-local \
CONTEXT_ACTOR_ID=agent-session-1 \
CONTEXT_ACTOR_ROLE=agent \
CONTEXT_SERVICE_FIXTURE=representative \
npx tsx src/cli.ts get_context --company confenge --domain commercial --resource offer:CFG-DIAG-EXP-v1
```

Comandos CLI: `get_context`, `get_active_directives`, `get_priorities`, `get_decisions`.

## Variáveis de ambiente

Valores abaixo são **nomes e exemplos não-secretos**. Não commitar `.env`.

| Variável | Obrigatória | Função |
|---|---|---|
| `CONTROL_CENTER_FOUNDER_ACTOR_ID` | sim | id opaco do founder (não é senha) |
| `CONTROL_CENTER_COMPANY` | não | default `confenge` para priorities/decisions sem scope |
| `CONTEXT_SERVICE_FIXTURE` | não | `empty` (default) ou `representative` |
| `CONTEXT_ACTOR_ID` / `CONTEXT_ACTOR_ROLE` | CLI sim | ator da sessão CLI |
| `HOST` / `PORT` | não | bind HTTP; default loopback `127.0.0.1:8787` |
| `DATABASE_URL` | não | se setada, o processo **recusa** o fixture (convergência) |

## Adapter de persistência (handoff)

Interface: `src/store/adapter.ts` (`PersistenceAdapter`, versão `control-center.context.persistence.v1`).

Implementação desta onda: `src/store/fixture.ts`.

SQL esperado (não aplicar daqui): `src/store/expected-schema.sql`.

Regra de convergência: `control-center/persistence/` deve implementar o adapter e gravar o audit **na mesma transação** da mutação. Este serviço não importa essa árvore.

## Handoff esperado

| Destino | O que consome |
|---|---|
| `control-center/contracts/` | kinds, scope, provenance, payload de `get_context` |
| `control-center/persistence/` | `PersistenceAdapter` + SQL |
| `control-center/services/mcp/` | as quatro operações de leitura + proposals; **sem** mutação financeira |

Fora de escopo aqui: UI, MCP, collectors, Warmbly, Asaas, `commercial/`, PR Governance #8.

## Limites

- JSON ≤ 32 KiB
- title ≤ 200, body ≤ 8000, rationale ≤ 4000
- campos desconhecidos rejeitados
- `created_by` é sempre o ator autenticado
