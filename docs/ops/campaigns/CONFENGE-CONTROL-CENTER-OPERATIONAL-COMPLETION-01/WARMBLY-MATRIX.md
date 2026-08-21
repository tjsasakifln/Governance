# Warmbly matrix

| Surface | Shipped? | Test | Notes |
| --- | --- | --- | --- |
| Commercial overview | yes | projectors.test.ts, honesty-http.test.ts | Funnel from counts when present; missing stages omitted not zeroed in projector **or** `commercialFrom`; UI `ausente` |
| Cohorts | yes | projectors.test.ts | Windows 7d/28d/90d/open; acquisition anchor `contact.created_at`; inbound-truth scoreboard labeled separately; numerator+denominator; tiny n labeled; **reply_rate denominator = contacted, never population** |
| Activity | yes | commercial-ops.test.ts, Warmbly operations slice | Capped timeline; REVIEW_ACTIVITY form |
| Pipeline | yes | projectors.test.ts | Capped deals; stale ≥14d |
| Exceptions | yes | Warmbly attention → operations.exceptions | ACKNOWLEDGE_EXCEPTION form |
| Operator validation | yes | operator-actions.test.ts (HTTP + Postgres); honesty-http.test.ts | Founder-only, idempotent, Control Center audit record (Warmbly not mutated); cockpit paints ok/error from `lastOperatorResult` |
| Forbidden mutation | yes | operator-actions HTTP SEND_EMAIL 4xx; DB CHECK rejects SEND_EMAIL; Warmbly allowlist denies mutating POST; HTTP adapter denies SEND_* client-side | Auto-send observed, never enabled |
| Growth hops | yes | honesty-http.test.ts, commercial-ops.test.ts | Nine hops always painted on Crescimento; GSC hops BLOCKED without ingest; GET scope=commercial |

Live Warmbly intel GETs 404 on the local stub and are recorded as gaps (`required_upstream_contract` / unavailable), never mocked.
Warmbly PR #104 was not merged.
