# READY_FOR_INTERNAL_PRODUCTION

Machine copy: `matrix/ready-for-internal-production.v1.json`.
Reducer: `readyForInternalProduction` in `src/gate.ts`.

## Definition

`READY_FOR_INTERNAL_PRODUCTION` is **true if and only if** every named attack check is present **exactly once** and its `state` is the string `pass`.

The following are **not ready**:

- `fail`
- `UNKNOWN`
- unrun
- missing
- duplicate check ids

This is a fail-closed conjunction. A clean demo or a green UI is not evidence. A skipped test is not a pass.

## Required checks (verbatim)

1. stale data mostrado como saudável
2. double counting financeiro
3. hypothesis promovida a fact
4. agent sobrescrevendo founder decision
5. scope leakage entre cliente/repos
6. duplicated collector event
7. provider mutation acidental
8. secret/PII leakage
9. timezone boundary
10. partial outage
11. stale RUNNING agent session
12. conflicting directives/supersession
13. auth bypass assumptions
14. missing provenance

## This wave

The adversarial corpus is expected to mark every attack `fail` and therefore **must not** grant `READY_FOR_INTERNAL_PRODUCTION`. This package defines and executes the hostile gate against fixtures; it does not certify the live Control Center.
