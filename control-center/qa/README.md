# Control Center QA (adversarial gate)

Hostile contract suite for the Confenge Control Center. This package is **not** a chat UI, not an ERP, and not a substitute for Warmbly/Asaas/GitHub. It is the mechanical, fail-closed gate the future convergência campaign must pass.

Write scope of this campaign: `control-center/qa/` only.

## Decisions

1. Governance remains strategic/canonical authority; Warmbly remains commercial/CRM operational authority.
2. Attack identifiers are the 14 campaign strings **verbatim**. Docs, fixtures, evaluators, CLI output, and `READY_FOR_INTERNAL_PRODUCTION` share that list.
3. Every aggregated record in later services must carry `source`, `observed_at`, `freshness_status`, and `confidence`. This gate fails `missing provenance` when they are absent.
4. Directive kinds stay `decision | directive | fact | constraint | priority | risk | hypothesis`. A hypothesis is not a fact. An agent must not overwrite a founder decision.
5. Agents consult by scope. `client:A` does not imply `client:B` or `repo:X`. Parent literals do not grant parameterized children.
6. Collectors are idempotent and read-only. Duplicate `idempotency_key` applied twice is an attack.
7. MCP is the agent interface. Financial/provider mutations are forbidden: cobrança, checkout, refund, cancelamento, Asaas writes, commercial send. This CLI never performs them.
8. Money is integer cents + ISO-4217 currency. Internal timestamps are UTC with a `Z` suffix. Presentation may use `America/Sao_Paulo`.
9. Live agent sessions use architecture status `open`. The attack id remains `stale RUNNING agent session` and treats an open/live session past TTL as that attack.
10. `READY_FOR_INTERNAL_PRODUCTION` is a fail-closed conjunction of the 14 named checks. `UNKNOWN`, unrun, missing, duplicate, or fail is not ready.
11. Single-user human later, but this suite rejects hardcoded identity/password and unauthenticated privileged actions.
12. Secrets and PII must not appear in git, logs, URLs, analytics, or client bundles. Leak evidence records **paths and kinds**, never secret values.
13. Sibling Control Center workstreams are not imported. Local adapters in `src/adapters.ts` document the ports a later campaign will implement.
14. This wave does not grant `READY_FOR_INTERNAL_PRODUCTION` to the live system; it proves the gate is hostile against fixtures.

## Named attacks

- stale data mostrado como saudável
- double counting financeiro
- hypothesis promovida a fact
- agent sobrescrevendo founder decision
- scope leakage entre cliente/repos
- duplicated collector event
- provider mutation acidental
- secret/PII leakage
- timezone boundary
- partial outage
- stale RUNNING agent session
- conflicting directives/supersession
- auth bypass assumptions
- missing provenance

See `docs/THREAT-QUALITY-MATRIX.md`, `docs/MERGE-CONVERGENCE-CHECKLIST.md`, and `docs/READY-FOR-INTERNAL-PRODUCTION.md`.

## Layout

```
src/attacks.ts          verbatim ids
src/evaluators.ts       shipped detectors (tests must call these)
src/gate.ts             READY_FOR_INTERNAL_PRODUCTION reducer
src/corpus.ts           load fixtures + run evaluators
src/cli.ts              launchable gate entry
src/adapters.ts         FixturePort + documented later ports
fixtures/attacks/       one adversarial payload per attack
fixtures/controls/      non-attack control per attack
fixtures/gate/          all-pass / UNKNOWN / missing check sets
matrix/                 machine-readable matrix, checklist, ready rule
```

## Run tests and the gate

Requires Node.js ≥ 20. No PostgreSQL. No external services.

```bash
cd control-center/qa
npm install
npm test
npm run typecheck
npx tsx src/cli.ts --corpus adversarial
```

`npm test` drives the shipped evaluators and reducer.

Default CLI corpus is `adversarial`. It prints one JSON object listing every named attack, marks each adversarial case `fail` / `not-ready`, and leaves `READY_FOR_INTERNAL_PRODUCTION` false. Exit code `2` means not ready (expected for the adversarial corpus). Exit `0` only when the reducer grants ready.

Other corpora (local fixtures only):

```bash
npx tsx src/cli.ts --corpus controls
npx tsx src/cli.ts --corpus all-pass
npx tsx src/cli.ts --corpus unknown-check
npx tsx src/cli.ts --corpus missing-check
```

The entry performs no cobrança, checkout, refund, cancelamento, Asaas write, or commercial send.

## Environment variables

This package has **no required environment variables** and ships no `.env`. Absence of later service variables is fail-closed in those services, not here.

Later workstreams (not implemented here) are expected to introduce their own, for example:

| Variable | Later owner | Notes |
|---|---|---|
| `DATABASE_URL` | persistence | PostgreSQL for snapshots and memory |
| `CC_ACTOR_ID` | auth | Opaque `ActorRef.id`; never a password in git |
| `WARMBLY_READ_BASE_URL` | collectors | Read-only |
| `GITHUB_TOKEN` | github collector | Server-side only; never in client bundle or URLs |
| `ASAAS_API_KEY` | finance origin | Never consumed for writes from Control Center |

## Expected convergência (later campaign)

Do **not** implement these from this package:

- Wire `control-center/` into the Governance root README, `commercial/`, `decisions/`, or `scripts/`.
- Absorb PR Governance #8 (partner program).
- Import `control-center/contracts` or other workstream trees just to make the monorepo “green” before convergência.
- Grant `READY_FOR_INTERNAL_PRODUCTION` to live Control Center in this wave.

Do, later:

- Implement the ports documented in `src/adapters.ts` (`ObservationPort`, `FinancePort`, `DirectivePort`, `ScopePort`, `CollectorPort`, `ToolPort`, `LeakPort`, `ClockPort`, `HealthPort`, `SessionPort`, `AuthPort`, `ProvenancePort`) against PostgreSQL / MCP.
- Keep this gate as the CI merge blocker. Point live snapshots at the same evaluator functions; do not reimplement detection in tests or in the UI.
- Money remains integer cents + currency. Dates remain UTC `Z` internally.

## Adapter contract (local)

`FixturePort` is the only implementation in this campaign. It returns the JSON `payload` of a fixture. Evaluators depend on record shapes, not SQL or HTTP. A future service can construct the same payloads from the database and call `evaluateAttack` / `readyForInternalProduction` unchanged.
