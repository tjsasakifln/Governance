# Control Center — conector PNCP (freshness)

Transforma métricas **já existentes** de ingestão / read-model do PNCP num sinal operacional verificável: `FRESH` | `STALE` | `ERROR` | `UNKNOWN`.

Esta pasta é o único path desta campanha. Não recrawleia PNCP, não faz backfill, não escreve no extra-cli, Warmbly, `commercial/` nem em qualquer outro workstream.

## Decisões

- Governance continua autoridade estratégica; extra-cli continua a autoridade operacional do datalake PNCP. Este conector só **lê** um artefato de saúde, uma API HTTP ou uma linha de view.
- Toda saída (`ServiceHealth`, `SourceObservation`) carrega `source`, `observed_at` e `freshness_status`. `confidence` é sempre preenchido (0–1).
- `healthy: true` e o rótulo `PNCP saudável` só existem quando o classificador devolve `FRESH` **e** há timestamp de dados **e** evidência de freshness (`last_success_at`, `source_max_timestamp` ou `last_item_observed_at`, `recent_window_count`, `consecutive_errors`). Caso contrário o dashboard não tem como mostrar “PNCP saudável” a partir deste payload.
- Collector vivo com dados parados (`last_success` / heartbeat recentes, timestamps de dados ou janela recentes fora do SLA) é `STALE`, nunca `FRESH`.
- Credencial indisponível (HTTP 401/403 ou `credential_status=unavailable`) é `ERROR`.
- Fonte silenciosa / métricas incompletas é `UNKNOWN` (ou `STALE` se já existirem dados antigos).
- Datas internas em UTC. Valores financeiros não se aplicam a este conector.
- Fail-closed: fonte inalcançável, JSON inválido, ficheiro em falta ou adapter por configurar → `ERROR`/`UNKNOWN`, nunca `FRESH`.
- Sem `any`. Validação de config em runtime (zod). Logs estruturados sem PII, secrets, DSN, headers ou query strings.

## Como correr

```bash
cd control-center/connectors/pncp
npm install
npm test
npm run typecheck
npx tsx src/cli.ts --kind health_artifact --path fixtures/pipeline-vivo.json
```

O classificador é puro. I/O (fs / HTTP / callback de view) fica no adapter. Não há recrawl.

## Variáveis de ambiente / thresholds

| Variável | Default | Significado |
| --- | --- | --- |
| `PNCP_METRICS_KIND` | `health_artifact` | `health_artifact` \| `http_api` \| `db_view` |
| `PNCP_METRICS_ARTIFACT_PATH` | — | JSON local de métricas (read-only) |
| `PNCP_METRICS_HTTP_URL` | — | GET JSON read-only |
| `PNCP_FRESHNESS_SLA_HOURS` | `24` | SLA de `last_success_at` (alinhado a extra-cli `FRESHNESS_SLA_PNCP_HOURS`) |
| `PNCP_DATA_SLA_HOURS` | `24` | SLA de `source_max_timestamp` / último item |
| `PNCP_RECENT_WINDOW_HOURS` | `24` | Janela documentada para `recent_window_count` |
| `PNCP_MIN_RECENT_WINDOW_COUNT` | `1` | Mínimo de itens na janela para `FRESH` |
| `PNCP_CONSECUTIVE_ERROR_THRESHOLD` | `3` | `ERROR` se erros consecutivos ≥ este valor |
| `PNCP_COLLECTOR_ALIVE_MAX_AGE_HOURS` | `1` | Heartbeat / último sucesso “vivo” |
| `PNCP_DEAD_PIPELINE_MAX_AGE_HOURS` | `72` | Pipeline morto |

Não colocar secrets em git, logs, URLs de analytics ou no bundle. DSN do extra-cli, se usado na convergência futura, fica só em env e nunca é logado.

## Fixtures

| Ficheiro | Nome | Status esperado |
| --- | --- | --- |
| `fixtures/pipeline-vivo.json` | pipeline vivo | `FRESH` com timestamp + evidência |
| `fixtures/pipeline-morto.json` | pipeline morto | `STALE` |
| `fixtures/source-silenciosa.json` | source silenciosa | `UNKNOWN` |
| `fixtures/credencial-indisponivel.json` | credencial indisponível | `ERROR` |
| `fixtures/collector-alive-data-stopped.json` | collector vivo, dados parados | `STALE` (`collector_stalled`) |
| `fixtures/incomplete-heartbeat-only.json` | sucesso recente sem timestamp de dados | não `FRESH` |
| `fixtures/extra-cli-freshness-gate-row.json` | envelope extra-cli sem `consecutive_errors` | não `FRESH` (métricas incompletas) |

## Integração esperada (campanha de convergência)

O extra-cli já calcula um gate em `scripts/freshness_gate.py` (`last_success_at`, `last_ingested_at`, `latest_business_date`, `recent_records`). Este conector **não importa** extra-cli.

Na convergência posterior:

1. Expor uma view read-only com o contrato em `contracts/pncp_freshness_metrics.view.sql`, **ou** um artefato/API JSON com os mesmos campos.
2. Extra-cli precisa passar a emitir `consecutive_errors` (hoje não existe). Sem esse campo o classificador recusa `FRESH` (fail-closed / métricas incompletas). Aliases já aceites: `last_ingested_at` → `last_item_observed_at`, `latest_business_date` → `source_max_timestamp`, `recent_records` → `recent_window_count`.
3. O dashboard / homepage (“3 coisas mais importantes”) deve consumir `ServiceHealth.label` e `healthy`. Não inventar “PNCP saudável” a partir de um payload sem `freshness_status=FRESH`.
4. MCP / context-service devem consultar este sinal por escopo `pncp`, não a memória inteira da empresa.
5. `kind=http_api` e `kind=db_view` já existem como adapter; o driver `pg` e a URL real ficam para a convergência. Sem DSN/callback, o adapter falha fechado.

Contratos JSON: `contracts/service-health.schema.json`, `contracts/source-observation.schema.json`.
