# Warmbly matrix

Current Warmbly main: `c8128f1e9baf8f67d97021530c7d0cbcbc707612`  
Production Warmbly: `13e7a082b7614ada39f994989e23398d85595400` (PR #104 included)  
Routes are under `/v1/confenge/...`. Handlers return `{"data": payload}`.

| Surface | Shipped? | Test | Notes |
| --- | --- | --- | --- |
| Envelope unwrap | yes | envelope.test.ts | scoreboard/executive/exceptions/organic `{data}` → inner; `{data:null}` and unrelated object CONTRACT_DRIFT; 404 gap, no fake empty |
| Commercial overview | yes | projectors.test.ts, honesty-http.test.ts | Funnel from counts; missing stages omitted |
| Cohorts | yes | projectors.test.ts | Anchor `contact.created_at`; durable contact/account/lead join or JOIN_UNPROVEN; unrelated same-window deal excluded; duplicate id not double-counted; reply_rate denominator = contacted |
| Activity | yes | commercial-ops.test.ts | Capped timeline; REVIEW_ACTIVITY form |
| Pipeline | yes | projectors.test.ts | Capped deals; stale ≥14d |
| Exceptions | yes | projectors.test.ts | `intel_exceptions` first, then attention; ACKNOWLEDGE_EXCEPTION is Control Center-only |
| Organic / Crescimento | yes | projectors.test.ts | `intel_organic_scoreboard` projected to growth.organic_scoreboard |
| Operator validation | yes | operator-actions.test.ts + operator-actions-pg.test.ts | PG unique key is durable authority; founder-only; Warmbly not mutated |
| Forbidden mutation | yes | SEND_EMAIL 4xx; DB CHECK; allowlist | auto_send observed, never enabled |

Intel GET contracts (Warmbly `internal/api/handler/confenge_intel.go`):

- GET `/v1/confenge/intel/scoreboard` → `{"data": Scoreboard}`
- GET `/v1/confenge/intel/executive` → `{"data": ExecutiveView}`
- GET `/v1/confenge/intel/exceptions` → `{"data": []Exception}`
- GET `/v1/confenge/intel/organic-scoreboard` → `{"data": OrganicScoreboard}`

Required API key bits for the collector: READ_CONTACTS + READ_CRM + READ_CAMPAIGNS + READ_UNIBOX. Never SEND_CAMPAIGNS.
