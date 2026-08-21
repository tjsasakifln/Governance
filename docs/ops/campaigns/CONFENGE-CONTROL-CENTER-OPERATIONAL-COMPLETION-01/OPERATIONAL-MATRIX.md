# Operational matrix

LIVE READ PROVEN is false for every upstream that requires production credentials. Local PostgreSQL projector path is proven.

| SOURCE | CONFIGURED? | LAST OBSERVED | FRESHNESS | CONFIDENCE | PROJECTOR | API | UI | LIVE READ PROVEN? | HUMAN GATE? | BLOCKER |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Warmbly | env WARMBLY_BASE_URL + token | collector envelope observed_at | FRESH/STALE/UNKNOWN/ERROR | 0–1 separate | commercial v1 + clients | `/v1/domains/commercial` | Comercial + Crescimento | no (no prod secrets here) | maybe BLOCKED_BY_SECRET | CREDENTIAL_GATE |
| Asaas | ASAAS_API_KEY | collector | never green on missing | separate | finance v1 paid ≠ received | `/v1/domains/finance` | Financeiro | no | HUMAN_GATE_ASAAS_READ_CREDENTIAL if secret absent | CREDENTIAL_GATE; `real_money_mutation_approved=false` |
| GitHub | GITHUB_REPOS allowlist + token | collector | UNKNOWN if blocked | separate | engineering v1 company + repo:* | `/v1/domains/engineering` | Engenharia | no | set GITHUB_REPOS in prod env | CREDENTIAL_GATE |
| extra-cli PNCP | PNCP_CONTRACT_PATH | PNCP_CONTRACT_FRESHNESS/1.0 | mapped, never promoted | separate | pncp v1 | `/v1/domains/pncp` | Infra + Crescimento | no | file path on host | LIVE_ENVIRONMENT_GATE |
| Infrastructure | CC_INFRA_ALLOWLIST | collector | partial outage stays degraded | separate | infrastructure v1 | `/v1/domains/infrastructure` | Infra | no | allowlist must be set | CREDENTIAL_GATE / config |
| Growth/inbound | Warmbly intel + PNCP | scoreboard 404 = gap | NO_DATA if empty | separate | commercial.operations.growth | commercial + pncp | Crescimento | no | GSC/GA4 still BLOCKED without ingest | EXTERNAL_SERVICE_GATE |
| Clients | derived from Warmbly ops | projector | inherits commercial | inherits | clients v1 | `/v1/domains/clients` | Clientes `#/clientes/<slug>` | no | missing Asaas shown as UNKNOWN source | CREDENTIAL_GATE |
| Governance memory | always | directives | FRESH when founder writes | 1 | n/a | `/v1/context` `/v1/directives` | Memória | n/a (local) | founder actor | none |
| Agent activity | MCP reports | persistence | statuses objective | separate | agent-activity | `/v1/agent-activities` | Agentes | n/a | agents cannot overwrite founder decisions | none |
