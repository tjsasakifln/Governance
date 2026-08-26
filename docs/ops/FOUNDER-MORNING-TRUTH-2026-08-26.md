# Verdade operacional para a manhã — 2026-08-26

## Escopo e validade

Auditoria read-only concluída em `2026-08-26T04:03:43Z` sobre os estados correntes de `main`, issues, PRs e superfícies públicas. Este documento é evidência datada, não uma fonte live e não deve ser promovido a catálogo ou read model. Qualquer observação sem identidade e freshness próprias continua `UNKNOWN` no Control Center.

Implementação sucessora: a extensão Outbound Runway da mesma primeira viewport está documentada em `docs/ops/campaigns/CONFENGE-CONTROL-CENTER-OUTBOUND-RUNWAY-01/EVIDENCE.md`. Os valores do harness são sintéticos e sanitizados; esta auditoria histórica não foi convertida em ledger live.

Não houve mutação na campanha Warmbly, envio, pause/resume, requeue, reschedule, feed refresh, chamada Asaas, habilitação de checkout ou mutação de dinheiro real.

## Identidades auditadas

| Origem | Identidade observada | Estado |
| --- | --- | --- |
| Governance `origin/main` | `d980cf2a0aa67f3a3a9446ca7037a3c9d89ece3b` | sem PR aberto no instante da auditoria |
| web-cfg `origin/main` | `41cc328681507159ffdc12417d49e7474e2770a4` | identidade de repositório; não prova a identidade do deploy público |
| Warmbly `origin/main` | `3368e7d8f46573eef300b42ec214df8844b082d0` | diferente do runtime reportado em Warmbly #43 |
| Warmbly runtime | `0c23e37e9e2bfd276e46c77d15a01c6a24d1f177` | readback de `2026-08-26T01:40:55Z`; runtime mismatch aberto |

## Classificação contemporânea

| Item | Classificação | Verdade atual e critério para mudar |
| --- | --- | --- |
| `CFG-FIRST-TOUCH-ROUTING-v1` / Governance #129 | `PARTIAL` | contrato e projeção entraram em `main` por #148; a prova completa ainda exige source run corrente, cadeia até `QUEUED` por readback e runtime/release reconciliados |
| Governance #126 | `PARTIAL` | UI já distingue autoridade delegada/humana e estados queued/readback/HOLD; prova autenticada completa e filtros de toda a fila ainda não estão anexados |
| Governance #127 | `PARTIAL` | existe readback real de `QUEUED=1`, mas a matriz de retry/restart/concorrência e a reconciliação de runtime ainda não estão fechadas |
| Governance #128 | `BLOCKED_EXTERNAL` | denominador, cobertura e source run correntes não foram publicados nesta auditoria; nenhum refresh foi executado |
| Governance #109 | `STALE/SUPERSEDED` | duplica o invariante vigente de #127 e mantém enquadramento pós-campanha que não deve competir com a issue owner atual |
| Governance #1 | `PARTIAL` | overlay v2 versionado nesta mudança; Asaas real, naming efetivo e staffed capacity seguem não comprovados |
| Governance #120 | `PARTIAL` | contratos sintéticos existem e a projeção read-only fecha os hops; nenhuma cadeia real proposta→provider→Work Order foi provada |
| Governance #123 | `BLOCKED_HUMAN` | função pura e schema existem; falta o delivery owner publicar snapshot real de staffed capacity, compromissos, calendário e freshness |
| web-cfg #88 | `BLOCKED_EXTERNAL` | proposta/checkout/Asaas reais permanecem bloqueados; mappings e eventos reais não foram observados |
| web-cfg #412 / PR #422 | `EXECUTE_NOW` no repositório owner | PR aberto, mergeable e com checks verdes; até merge/deploy/readback, GSC readiness permanece bloqueada por gaps e histórico não persistido |

Nenhuma classificação `DONE` acima autoriza transporte, provider ou checkout. Os fundamentos versionados já presentes em `main` são `DONE` apenas dentro do seu escopo de contrato: policy de first touch, separação de autoridade humana/delegada, projeção queued/readback/HOLD, Work Order base e funções puras de capacidade.

## Primeira viewport — fatos permitidos

### 1. Outbound

- estado de transporte observado: `PAUSED`;
- policy: `CFG-FIRST-TOUCH-ROUTING-v1`;
- runtime readback: kill switch `ENGAGED`, `CONFENGE_SENDING_PAUSED=true`, `QUEUED=1`, `SENT=0`;
- source run, next due, sends today, limite, replies, bounces, opt-outs e saúde de provider: `UNKNOWN` quando não entregues pelo envelope live;
- autoridade de GO/NO-GO de transporte continua exclusivamente em Warmbly #43. Nada nesta branch autoriza `resume` ou SMTP.

### 2. Dados

- feed corrente, source run corrente, freshness e cobertura reconciliada: `UNKNOWN` nesta auditoria;
- blocker: a evidência live deve vir do produtor owner; snapshot histórico de #128 não é autoridade e não foi reutilizado;
- nenhuma coleta ou atualização de feed foi disparada.

### 3. Inbound / Web

- identidade de deploy: `UNKNOWN`; o SHA de `web-cfg/main` é apenas identidade do repositório;
- lead SLA: `UNKNOWN` sem observação live do endpoint owner;
- GSC readiness: `BLOCKED`, porque #412 segue aberto e #422 ainda não foi mergeado/deployado;
- probes públicos read-only em `2026-08-26T04:03Z`: homepage, `/diagnostico-b2g-expansao/` e `/comercial/termos-diagnostico-b2g/` responderam HTTP 200; `ops.confenge.com.br` respondeu HTTP 302 para a fronteira de autenticação.

### 4. Delivery / Finance

- Work Orders ativos: `UNKNOWN` sem snapshot live do produtor;
- `policy_ceiling=50` é conhecido apenas como teto de política;
- `staffed_capacity`, `committed`, `available` e freshness: `UNKNOWN`;
- admission: `UNKNOWN/CANNOT_ACCEPT`, fail-closed;
- mappings/objetos Asaas: `MISSING/UNKNOWN`; nenhum lookup de provider foi feito;
- checkout: `BLOCKED`; proposta aceita e `PAYMENT_CONFIRMED` não são receita recebida.

### 5. Próxima ação humana

Uma única ação primária é segura: o delivery owner publicar um snapshot real, datado e identificável de staffed capacity, WIP/committed e calendário. Até isso ocorrer, admission e checkout permanecem fail-closed. A reconciliação de objetos Asaas continua um blocker separado que exige sessão humana autorizada; não deve ser simulada nem executada automaticamente.

## Exception queue da auditoria

| Bucket | Owner | Reason | Evidence | Age no corte | Next action | Severity | Source / freshness |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `capacity_unknown` | delivery owner | staffed capacity real não publicada | Governance #123; `commercial/authority/authority-overlay.v2.json` | `UNKNOWN` | publicar snapshot real com as cinco dimensões de capacidade | critical | Governance / `UNKNOWN` |
| `payment_provider_ambiguity` | founder/finance | mappings e objetos Asaas não comprovados | Governance #1, #120; web-cfg #88 | `UNKNOWN` | reconciliar provider em sessão humana autorizada, sem habilitar checkout | critical | Asaas / `UNKNOWN` |
| `stale_drift` | data owner | source run/feed/denominador live ausentes | Governance #128 | `UNKNOWN` | publicar leitura corrente com run/hash/as_of; não copiar snapshot histórico | high | produtor de dados / `UNKNOWN` |
| `runtime_mismatch` | Warmbly owner | runtime `0c23e37…` difere de `main` `3368e7d…` | Warmbly #43, readback `2026-08-26T01:40:55Z` | 2h22m no corte | reconciliar identidade read-only antes de qualquer decisão de transporte | high | Warmbly runtime / stale para deploy identity |
| `delivery_blocker` | web/GSC owner | histórico/readiness de GSC ainda não fail-closed em produção | web-cfg #412 e PR #422 | 2h28m desde atualização da issue | merge/deploy/readback no repositório owner; até lá mostrar bloqueado | medium | GitHub/web-cfg / fresh no corte |

Buckets sem ocorrência provada (`identity_recipient_conflict`, `party_role_conflict`, `outbound_reply_handoff`) permanecem disponíveis no schema, mas não recebem contagem zero nem estado saudável por inferência.

## Cadeia comercial e autoridade

`web-cfg` é a única autoridade do catálogo público: registry de 54 entregáveis + 2 contêineres no blob `99e77f51336e7fe63af0446d7577b3b20fe9a9b0`, e naming authority no blob `5f39620c0488625648aa9c3919a9eea3b8ce2004`. Os quatro registros históricos de Governance são somente um subset/mapping financeiro e não formam catálogo alternativo.

A projeção comercial conserva identidades de oferta→proposta→aceite→financial gate→provider→commercial state→Work Order→delivery. Hop ausente não é promovido. `PAYMENT_CREATED`, `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED` são eventos distintos; apenas recebimento com prova primária não sintética pode sustentar receita recebida.

## Fontes

- Governance: #1, #109, #120, #123, #126, #127, #128, #129 e PR mergeado #148.
- Warmbly: #43.
- web-cfg: #88, #412 e PR #422.
- artefatos pinados: `commercial/authority/authority-overlay.v2.json`.
