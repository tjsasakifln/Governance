# Threat / quality matrix

Machine copy: `matrix/threat-quality.v1.json`. Detectors live in `src/evaluators.ts`. This matrix is the hostile gate, not a dashboard.

UNKNOWN, unrun, or missing evidence is **not** ready.

| attack_id (verbatim) | Category | Detector | Reject |
|---|---|---|---|
| stale data mostrado como saudável | freshness | `evaluateStaleDataShownAsHealthy` | fail |
| double counting financeiro | finance | `evaluateDoubleCountingFinanceiro` | fail |
| hypothesis promovida a fact | memory | `evaluateHypothesisPromotedToFact` | fail |
| agent sobrescrevendo founder decision | authority | `evaluateAgentOverwritingFounderDecision` | fail |
| scope leakage entre cliente/repos | isolation | `evaluateScopeLeakage` | fail |
| duplicated collector event | idempotency | `evaluateDuplicatedCollectorEvent` | fail |
| provider mutation acidental | safety | `evaluateProviderMutationAcidental` | fail |
| secret/PII leakage | security | `evaluateSecretPiiLeakage` | fail |
| timezone boundary | time | `evaluateTimezoneBoundary` | fail |
| partial outage | availability | `evaluatePartialOutage` | fail |
| stale RUNNING agent session | agents | `evaluateStaleRunningAgentSession` | fail |
| conflicting directives/supersession | memory | `evaluateConflictingDirectives` | fail |
| auth bypass assumptions | auth | `evaluateAuthBypassAssumptions` | fail |
| missing provenance | provenance | `evaluateMissingProvenance` | fail |

Each attack ships an adversarial fixture (must fail) and a non-attack control (must not be classified as that attack) under `fixtures/`.
