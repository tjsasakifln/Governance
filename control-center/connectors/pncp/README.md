# Control Center — conector PNCP (adapter de `PNCP_CONTRACT_FRESHNESS/1.0`)

Lê o contrato versionado **já produzido** pelo extra-cli (`scripts/ops/pncp_contract_freshness.py`, autoridade `PNCP_CONTRACT_FRESHNESS/1.0`) e projecta `ServiceHealth` + `SourceObservation` canónicos do Control Center.

Esta pasta é o único path desta campanha. Não recrawleia PNCP, não faz backfill, não classifica lag/janelas, não escreve no extra-cli, Warmbly, Asaas, `commercial/` nem em qualquer outro workstream.

## Decisões

- extra-cli continua a autoridade operacional do freshness PNCP (`FRESH|DEGRADED|STALE|UNKNOWN`). Este conector é um **adapter**: traduz o `status` e preserva evidências. Não inventa um segundo classificador.
- Mapa (nunca promove estado):
  - `FRESH` → `FRESH`
  - `DEGRADED` → `STALE` (preserva `upstream_status=DEGRADED` e os mesmos `reason_codes`)
  - `STALE` → `STALE`
  - `UNKNOWN` → `UNKNOWN` (não vira `ERROR`)
  - falha de transporte / parser / `contract_version` desconhecida → `ERROR` (nunca `FRESH`)
- Parser versionado fail-closed: só `PNCP_CONTRACT_FRESHNESS/1.0`. Versão ausente ou não suportada é `ERROR`.
- Saídas agregadas são `control-center.service-health.v1` e `control-center.source-observation.v1`. Toda agregação leva `provenance` com `source`, `observed_at`, `freshness_status` ∈ `{FRESH,STALE,UNKNOWN,ERROR}` e `confidence` ∈ `[0,1]`.
- Adapters READ-ONLY: ficheiro (read), HTTP (GET), comando (stdout injectável). O argv por omissão do comando é extra-cli `--from-snapshot` `--json`. `--live` e ingest são recusados.
- Datas internas em UTC. Sem dinheiro neste conector. Logs estruturados sem PII, secrets, DSN, headers ou query strings.

## Como correr

```bash
cd control-center/connectors/pncp
npm install
npm test
npm run typecheck
npx tsx src/cli.ts --kind file --path fixtures/contract-degraded.json
npx tsx src/cli.ts --kind file --path fixtures/contract-fresh.json
```

Parse + mapa são puros. I/O (fs / GET / command runner) fica no adapter. Testes injectam transporte; extra-cli `--live` não é necessário.

## Variáveis de ambiente

| Variável | Default | Significado |
| --- | --- | --- |
| `PNCP_ADAPTER_KIND` | `file` | `file` \| `http` \| `command` |
| `PNCP_CONTRACT_PATH` | — | JSON local `PNCP_CONTRACT_FRESHNESS/1.0` (read-only) |
| `PNCP_CONTRACT_HTTP_URL` | — | GET JSON read-only do mesmo contrato |
| `PNCP_COMMAND_SNAPSHOT` | — | path passado a extra-cli `--from-snapshot --json` |

Não colocar secrets em git, logs, URLs ou no bundle.

## Fixtures

| Ficheiro | Upstream | Control Center |
| --- | --- | --- |
| `fixtures/contract-fresh.json` | `FRESH` | `FRESH` |
| `fixtures/contract-degraded.json` | `DEGRADED` (timestamps que passariam um SLA local 24h) | `STALE`, `upstream_status=DEGRADED` |
| `fixtures/contract-stale.json` | `STALE` | `STALE` |
| `fixtures/contract-unknown.json` | `UNKNOWN` | `UNKNOWN` |
| `fixtures/contract-unknown-version.json` | `PNCP_CONTRACT_FRESHNESS/9.9` | `ERROR` |
| `fixtures/contract-malformed.json` | payload incompleto | `ERROR` |
| `fixtures/contract-invalid.json` | JSON inválido | `ERROR` |

## Fora de âmbito

- Editar extra-cli ou reclassificar SLO/cadência/janela.
- Recrawl, backfill, `--live`, mutação Asaas ou comunicação comercial.
- Label «PNCP saudável» (substituída por `ServiceHealth` + `provenance`).
