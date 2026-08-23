# Caminho operacional crítico — evidência de integração

Data da execução: 2026-08-22/23, `America/Sao_Paulo`.

Esta pasta usa somente dados sintéticos ou respostas públicas somente leitura. Nenhum e-mail, cobrança, alteração no Asaas ou write no Warmbly foi executado.

## Decisão sobre os PRs DIRTY

| PR | Estado observado | Contrato/mudança válida | Autoria | Testes próprios | Decisão |
|---|---|---|---|---|---|
| #86 | merged em `0edf35d` | Telemetria real de coorte/e-mail controlado; `UNKNOWN` não vira outcome; envelope e projetor Warmbly | Tiago Sasaki | `commercial-ops`, `projectors`, `warmbly/envelope` | Mantido como primeiro passo já presente em `main`. |
| #80 | merged por squash em `75f23c1`, depois de #86 | Rota de detalhe de lead/oportunidade; fronteira estrutural entre auditoria local e o único write Warmbly permitido; alvos canônicos no read model | Tiago Sasaki; coautoria Claude Opus 5 nos commits originais | `commercial-ops`, `lead-detail`, `projectors`, `warmbly/envelope`, convergência `lead-detail-surface` | Mantido como segundo passo já resolvido contra #86. O histórico sujo/repetido da branch não foi importado. |
| #79 | open, `CONFLICTING`, head `3c669693` baseado em `bc0f9fc` | Catálogo pt-BR e detalhe técnico progressivo sem perder tokens crus | Tiago Sasaki; coautoria Claude Opus 5 | `contract`, `domain-fields`, `labels` | Aplicado seletivamente por cherry-pick (`fbc99ad`, com `-x`) sobre a árvore atual. |

Sobreposição medida:

- #79 × #80: `styles.css`, `ui/domains.ts`, `ui/render.ts`;
- #79 × #86: `ui/domains.ts`;
- #80 × #86: `ui/domains.ts`, `commercial-ops.test.ts`, projetor/testes comerciais e envelope/testes Warmbly.

Ordem executada: `main com #86 → squash #80 → aplicação seletiva #79 → integrador #62/#65/#67 → rebase limpo sobre #87/#88`. Não foi feito merge de árvore da #79: por estar muito atrás de `main`, isso removeria superfícies posteriores. Nos conflitos de #79 foram mantidos o detalhe e a paginação da #80, a superfície Warmbly dedicada e os outcomes honestos da #86; foram aproveitados os rótulos pt-BR, ajuda contextual e blocos técnicos. Foram descartados o painel de dispatch embutido e renderizadores antigos de atividade/exceções da #79 porque duplicavam as superfícies atuais. O rebase final preservou o contrato de persistência de coorte e o schema de relatório Warmbly introduzidos por #87/#88.

## Contrato e percurso entregue

O contrato `OperationalTruth` define exatamente `ZERO | ABSENT | UNKNOWN | STALE | ERROR | HEALTHY`, sempre com `as_of`, `source`, `confidence` e `reason`. A precedência é fail-closed: erro e stale não são escondidos por zero; payload parcial é `UNKNOWN`; ausência de origem é `ABSENT`; zero só existe quando foi observado em leitura completa e recente.

O percurso observável é:

`triagem diária → detalhe nomeado do lead/oportunidade → exceção agrupada → ação permitida → receipt/outcome`

Ações de atribuição/triagem/tratamento gravam somente auditoria append-only no Control Center. Reconhecer uma exceção não a resolve nem a remove. Write no Warmbly só aparece para um inbound lead provado ou como deep link HTTPS exato fornecido pela origem; envio comercial, cobrança e mutações genéricas permanecem negados. O receipt mostra ator, sessão/correlação, desfecho e fronteira de escrita.

## Matriz issue → teste → evidência

| Issue/caso | Camada | Teste executado | Evidência |
|---|---|---|---|
| #62 — seis estados e campos obrigatórios | unitário/contrato | `contracts/tests/operational-truth.test.ts`; schema/OpenAPI | Todos os estados mutuamente exclusivos; payload parcial e stale-zero preservados. |
| #62 — zero real, ausência, parcial e stale disfarçado | integração HTTP | `services/context/test/commercial-list.test.ts` | `ZERO`, `ABSENT`, `UNKNOWN/partial_payload` e `STALE` distintos na resposta. |
| #62 — impacto/próxima ação pt-BR | UI | `apps/web-shell/tests/operational-truth.test.ts`, `labels.test.ts` | Banner canônico; token cru somente em atributo/detalhe recolhido. |
| #65 — triagem, filtros e detalhe | unitário/integração/e2e | `list-filters.test.ts`, `commercial-list.test.ts`, `lead-detail.test.ts`, `launch-probe.mjs` | Condições não lido/vencido/sem responsável/bloqueado; entrada no detalhe por `Enter`. |
| #67 — estados, agrupamento e evidência | unitário | `connectors/runner/tests/projectors.test.ts` | Duplicatas equivalentes viram uma exceção com `occurrence_count` e todos os `occurrence_ids`; ack permanece ack. |
| #65/#67 — write boundary e auditoria | contrato/integração/e2e | `operator-actions.test.ts` em context/persistence, `honesty-http.test.ts`, `launch-probe.mjs` | 401/ator inválido negado; ações locais append-only; receipt renderizado após fixture write. |
| timeout | unitário UI/adapter | `honesty-http.test.ts` | Desfecho `unknown`, instrução para não repetir cegamente. |
| payload parcial | contrato/integração/e2e | `operational-truth.test.ts`, `commercial-list.test.ts`, exceções no probe | Fila parcial não se apresenta vazia nem saudável. |
| duplicata | unitário/integração | projetor, context e persistence `operator-actions` | Evidência agrupada e idempotência retorna `duplicate`, sem segunda escrita. |
| write negado | unitário/integração | `honesty-http.test.ts`, `services/context/test/operator-actions.test.ts`, `warmbly-dispatch.test.ts` | `SEND_EMAIL`/ator indevido/rota fora do allowlist recusados. |
| #76 — corpus vivo necessário | mutação/QA vivo | `live-runtime/presented-freshness.test.ts`, `qa:live` | STALE, UNKNOWN e ERROR pintados como healthy fazem o detector falhar; zero amostras agora é `UNKNOWN`, não passe. |

## QA e artefatos sanitizados

- Regressão final: contratos 117/117, persistência 33/33, collector 68/68,
  integração 67/67, web-shell 238/238, hardening 23/23 e typecheck de todos os workspaces.
  Resumo sanitizado: [verification-summary.log](verification-summary.log).
- E2E de produção local: build Vite + Context/Postgres reais + Chromium headless. Resultado: `critical_path=triage_to_detail keyboard=Enter result=found`, depois `critical_path=exception_to_receipt outcome=accepted`; 0 erros de página; loading/error/stale/empty exercitados; 7 viewports e 16 hashes sem overflow.
- QA adversarial: 14/14 ataques detectados. O processo sai com código 2 de propósito e `READY_FOR_INTERNAL_PRODUCTION=false` contra fixtures hostis.
- QA vivo local: 14/14 checks explicitamente `pass`, 49 apresentações de freshness inspecionadas e nenhum efeito proibido. Relatório: [qa-live.json](qa-live.json).
- Screenshot do percurso e receipt: [web-shell-critical-path.png](web-shell-critical-path.png).
- Screenshot móvel: [web-shell-390.png](web-shell-390.png).
- Screenshot desktop: [web-shell-desktop.png](web-shell-desktop.png).
- Log sanitizado do smoke somente leitura: [smoke-read-only.log](smoke-read-only.log).

O navegador foi executado com dependências do Chromium extraídas em `/tmp`; nada foi instalado no host. Os screenshots contêm apenas a fixture “Metalúrgica Aurora” e o ator sintético `founder-local`.

## Smoke produtivo somente leitura

Executado sem cookie/sessão e sem qualquer método de escrita:

| Recurso | Resultado |
|---|---|
| `GET /` | `302` para `auth.ops.confenge.com.br` |
| `GET /v1/today?scope=company` | `302` para autenticação |
| `GET /healthz` | `200 application/json`, corpo `{"status":"ok"}`, TLS verificado |
| `GET /ready` | `404` |

Headers públicos observados em `/healthz`: HSTS, CSP, `frame-ancestors 'none'`, `nosniff`, `DENY`, política de permissões sem geolocalização/microfone/câmera/pagamento. O smoke comprova TLS, liveness e fail-closed anônimo; não comprova o percurso autenticado em produção.

## Rollback

1. Reverter os commits do PR integrador em ordem inversa; não reverter `0edf35d`/#86 nem `75f23c1`/#80 isoladamente, pois ambos já são base de `main`.
2. Reimplantar a imagem anterior do web/context/runner.
3. Se for necessário estreitar novamente o allowlist local, aplicar somente `005_operational_workflow_actions.down.sql`. Os receipts existentes são história append-only e não devem ser apagados.
4. Confirmar `/healthz`, autenticação e leitura das filas. Não executar write de rollback no Warmbly: este PR não cria dado de negócio upstream em produção.

## Resíduos explícitos

- O percurso autenticado em `ops.confenge.com.br` não foi exercitado porque não havia sessão de operador; só o caminho equivalente em fixture/Postgres local completou find → understand → act → receipt.
- `/ready` produtivo retorna 404 e deve ser decidido/implementado pela operação antes de usá-lo como readiness probe.
- Exceções Warmbly genéricas continuam sem endpoint de resolução autorizado. Quando não há inbound lead provado nem deep link HTTPS exato, a UI informa “não suportado” e mantém o item aberto.
- Ações locais não alteram a origem; o estado só muda após uma leitura upstream ou workflow explicitamente suportado.
- A #79 deve ser fechada como superseded após o merge do integrador; fazer merge posterior dela reintroduziria duplicação e regressões.
