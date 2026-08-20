# Engineering executive read model

Private Control Center domain package. It turns **GitHub collector snapshots** into an executive view the founder can read in seconds: where engineering is blocked, why, and with links.

This is **not** chat, **not** an ERP, **not** a GitHub clone, and **not** the homepage UI. It does not call GitHub. It does not mutate issues, PRs, checks, Asaas, Warmbly, or any external system.

## Decisions

1. **GitHub collector remains the ingest authority.** This package consumes collector-shaped JSON (`schema: confenge.control_center.engineering_snapshot.v1`). It does not scrape GitHub or copy diffs.
2. **Executive read model, not a wall of KPIs.** Per-repo output is health, blockers, open PRs, broken checks, P0/P1 issues, last activity, and aging. Company-wide output is aggregations plus ranked **attention candidates** with an explainable reason and a link.
3. **Provenance is mandatory.** Every aggregated item carries `source` (system/kind/locator), `observed_at` (UTC Z), `freshness_status` (`FRESH|STALE|UNKNOWN|ERROR`), and `confidence` in `[0, 1]`. Missing collector provenance is rejected fail-closed.
4. **`trabalho ativo sem evidência recente` is a hypothesis, never a fact.** A repo with a usable observation and no blockers is quiet-saudável (healthy silence or known recent-enough activity). A repo with no usable observation (`UNKNOWN`/`ERROR`) may emit the hypothesis and stays distinguishable.
5. **Links and references only.** Titles, numbers, html_url, aging. Never PR/issue bodies, patches, or check logs.
6. **Scoped reads.** `repo:<owner/name>` returns that repo. It does not dump company memory. `company` / `infrastructure` return the company aggregation.
7. **In-process store this wave.** Query operations a later Postgres consumer must match: `ingest`, `getCompany`, `getRepo`, `listAttention`. No identity/password hardcoded.
8. **Local adapter because sibling trees are absent on `origin/main`.** `control-center/connectors/github/` and `control-center/contracts/` are parallel workstreams. This package copies a **minimal** collector-snapshot + provenance/attention contract. Field names may need a convergence pass; do not import those trees from here.

Collector freshness maps to canonical freshness:

| Collector | Canonical |
| --- | --- |
| `fresh`, `not_modified` | `FRESH` |
| `stale` | `STALE` |
| `failed` | `ERROR` |
| `unsupported` | `UNKNOWN` |

`source` on collector items is the string `"github"`; output uses `{ system, kind, locator, label? }` so it can converge with `control-center/contracts` provenance.

## Run

From this directory:

```bash
npm install
npm test
npm run consumer
npm run typecheck
```

Replay clock for fixtures: `2026-08-20T12:00:00.000Z`. Tests and the consumer inject that clock; they do not hit the network.

## Env vars

No secrets. Thresholds and a replay clock only:

| Variable | Meaning | Default |
| --- | --- | --- |
| `CC_ENGINEERING_PR_STALE_AFTER_SECONDS` | Open PR aging threshold | `604800` (7d) |
| `CC_ENGINEERING_FRESHNESS_WINDOW_SECONDS` | FRESH vs STALE window vs `now` | `21600` (6h) |
| `CC_ENGINEERING_NOW` | Optional UTC Z replay timestamp | collector `observed_at` |

Do not put PATs, tokens, or passwords in env files committed here. This package never reads `GITHUB_TOKEN`.

## Query contract (homepage / MCP / persistence later)

Ship payload, not a page.

- **Homepage** should consume `attention_headlines` and `attention` (ranked, `homepage_eligible`). Privilege exceptions. Do not render a KPI wall from `aggregates` as the primary view.
- **MCP / context API** should query by scope: `readByScope(model, "repo:owner/name")` or `store.listAttention("repo:owner/name")`. Agents must not receive every repo unless they requested and were granted `company`.
- **Persistence** should store the executive view + provenance, not raw GitHub diffs. Ingest is idempotent on collector `snapshot_id` / per-repo `observation_id` once Postgres exists. Match `InMemoryEngineeringStore` operations.
- **Canonical projection** is `model.canonical` (`control-center.engineering-snapshot.v1` counts + attention ids) for the contracts workstream.

Attention candidate fields this wave: `repo`, `reason_code` (`stale_pr` \| `ci_red` \| `p0_issue` \| `p1_issue` \| `unknown_quiet`), `claim_kind` (`fact` \| `hypothesis`), `reference.html_url`, plus canonical-ish `id` / `scope` / `severity` / `summary` / `provenance`.

## Fixtures

Named fixtures under `fixtures/`:

- `pr-stale.json` — open PR past the aging threshold
- `ci-red.json` — failing checks
- `repo-quiet-saudavel.json` — usable observation, no blockers
- `repo-quiet-desconhecido.json` — failed/unusable observation

`assembleCollectorSnapshots([...])` is the company-wide input.

## Convergence

Expected later, **not** in this campaign:

- Replace local collector types with `@confenge/control-center-github-collector` once it lands on `main`.
- Validate output against `@confenge/control-center-contracts` `engineering-snapshot.v1` / `attention-item.v1`.
- Persist via the persistence/audit workstream.
- Homepage and MCP consume this payload without this package rendering UI or serving MCP.

Until then, this directory is the whole workstream.
