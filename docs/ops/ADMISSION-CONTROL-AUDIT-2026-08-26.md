# Admission control audit — 2026-08-26

## Baseline reused

PR #149 is merged at `cd0c5d0` and already supplied:

- `commercial/authority/authority-overlay.v2.json`, pinning web-cfg #329 (54 deliverables + 2 containers) and #343 naming authority;
- `confenge.capacity_projection.v1`, separating policy ceiling, staffed capacity, committed, available and freshness;
- the first Control Center viewport in `founder-operating-truth.ts` / `ui/hoje.ts`;
- fail-closed current truth: policy ceiling 50 is known, but staffed/committed/available remain `UNKNOWN` without a real snapshot.

PR #136 already supplied the Work Order authority, readiness v1, the v1 pure capacity canary and an idempotent synthetic hold model.

This change does not add a second authority overlay, catalog, Work Order store, WIP ledger or Control Center truth plane. It extends the same delivery capacity module and the same first viewport. v1 contracts and functions remain callable.

## Additive delta

- `confenge.capacity_admission.v2`: pure decision for exact deliverable/version/scope/deadline;
- `confenge.capacity_projection.v2`: redacted read-only projection created directly from the decision, with no recalculation;
- staffed snapshot v2 with explicit as-of/expiry/freshness policy and a separate working-calendar contract;
- complete/fresh Work Order input: every non-terminal canonical Work Order consumes its canonical effort exactly once;
- versioned estimated effort, deadline risk, blockers and next action;
- model-only ambiguous cancellation/refund/timeout state `RECONCILIATION_REQUIRED` that remains capacity-consuming;
- 54/54 readiness matrix v2 with all rows still `UNKNOWN`, plus per-row owner/blocker/evidence/next action/expiry;
- explicit web-cfg/Warmbly consumption rules that forbid WIP recalculation and `sold_out=false => available`;
- Control Center display of ceiling ≠ staffed ≠ committed ≠ available, freshness, deadline risk, blockers and next action.

## Safety verdict

- outbound campaign: untouched;
- checkout: remains disabled;
- real reservation: impossible through `CapacityLedger` (`MODEL_ONLY` guard);
- human capacity: not invented; no real staffed snapshot exists, so current operational admission remains `UNKNOWN`;
- catalog: retains v1 `sold_out` only as a static block; dynamic availability lives in the admission decision;
- projections: aggregate/reference-only, with tests excluding client/account/contact fields.

## Human blockers that remain

1. Delivery owner must publish a real, time-bounded staffed-capacity snapshot. This cannot be inferred from the commercial ceiling 50.
2. Delivery owner/supervisor must approve a real working calendar and any WIP/override policy.
3. #122 must accumulate real operational evidence per exact deliverable/version. Identity/catalog pins do not promote readiness.
4. Cancellation/refund/timeout commit/release semantics require human policy/evidence before any production reservation implementation.
5. Real checkout, provider mutation and outbound actions remain separately unauthorized.
