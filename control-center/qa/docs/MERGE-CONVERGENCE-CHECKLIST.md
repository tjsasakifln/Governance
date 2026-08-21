# Merge / convergência checklist

Machine copy: `matrix/merge-convergence.v1.json`.

Use this as the mechanical merge gate for the future Control Center convergência campaign. This wave only owns `control-center/qa/`.

## This campaign

- [ ] Diff is only `control-center/qa/`.
- [ ] No writes to `commercial/`, `decisions/`, `scripts/`, root README, PR Governance #8, Warmbly, web-cfg, extra-cli, or other `control-center/` trees.
- [ ] Evaluators do not import sibling workstreams; local adapters/contracts/fixtures stand in.
- [ ] Gate performs no cobrança, checkout, refund, cancelamento, Asaas write, or commercial send.

## Named attacks (each must reject)

- [ ] stale data mostrado como saudável
- [ ] double counting financeiro
- [ ] hypothesis promovida a fact
- [ ] agent sobrescrevendo founder decision
- [ ] scope leakage entre cliente/repos
- [ ] duplicated collector event
- [ ] provider mutation acidental
- [ ] secret/PII leakage
- [ ] timezone boundary
- [ ] partial outage
- [ ] stale RUNNING agent session
- [ ] conflicting directives/supersession
- [ ] auth bypass assumptions
- [ ] missing provenance

## Ready rule

- [ ] `READY_FOR_INTERNAL_PRODUCTION` is the fail-closed conjunction of the 14 named checks.
- [ ] UNKNOWN / unrun / missing evidence is not ready.

## Later convergência (not this PR)

- [ ] Implement the ports in `src/adapters.ts` against PostgreSQL / context-service / MCP.
- [ ] Keep this package as the CI gate; do not rewrite tests around live services.
- [ ] Do not absorb PR Governance #8.
