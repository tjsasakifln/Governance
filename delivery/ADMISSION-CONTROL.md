# Admission control v2

`evaluate_admission_v2` is the single capacity decision engine. It combines the commercial ceiling, a time-bounded staffed snapshot, a separately versioned working calendar, a complete/fresh read-only snapshot of canonical Work Orders, model-only allocation state, readiness/effort/dependencies and the requested deadline.

The result is `CAN_ACCEPT | CANNOT_ACCEPT | UNKNOWN` with stable `reason_codes`, evidence-backed blockers, expiry, earliest feasible date, deadline risk and next action. Any unknown authority propagates to `UNKNOWN`; `UNKNOWN` never becomes `CAN_ACCEPT`.

## Authority boundary

- `policy_ceiling=50` is a commercial maximum from `capacity-policy.v1`; it is never copied into `staffed_capacity`.
- Staffed capacity is a human declaration. No real declaration exists in this repository today, so the current operational state remains `UNKNOWN`.
- All non-terminal Work Orders from #121 consume their canonical `estimated_capacity_units`. A snapshot must explicitly state `complete=true`; otherwise admission is `UNKNOWN`.
- Readiness comes from #122 for the exact deliverable/version/scope, including versioned effort and current dependencies.
- The calendar is an independently versioned input. Deadline feasibility is deterministic and does not forecast future hiring or availability.
- The Control Center receives only `confenge.capacity_projection.v2`, created directly from one admission decision without recalculating WIP. It remains a read model, not a ledger.

## Mutation boundary

The SQLite `CapacityLedger` is `MODEL_ONLY` and rejects real decisions. It proves hold/commit/release/expire, idempotency and concurrency for synthetic fixtures only. Cancellation, refund or checkout timeout ambiguity becomes `RECONCILIATION_REQUIRED` and continues consuming capacity until explicit reconciliation.

No code in this package enables checkout, creates a real reservation, contacts Asaas, changes Warmbly, or touches outbound.

## Consumers

The normative consumer contract is `delivery/admission-consumer-contract.v2.json`. web-cfg and Warmbly submit identity/deadline and consume the signed/versioned result; neither recalculates WIP. `sold_out=false` means only that a static catalog kill switch is not set. Missing, stale, synthetic or `UNKNOWN` admission remains unavailable to real consumers.

## Current factual status

The 54-row matrix at `delivery/fixtures/readiness-54.fail-closed.v2.json` pins web-cfg #329/#343 and records owner, blocker, evidence, next action and expiry per row. All 54 remain honestly `UNKNOWN`; the prior synthetic aggregate canary remains separate and cannot promote real readiness or staffed capacity.
