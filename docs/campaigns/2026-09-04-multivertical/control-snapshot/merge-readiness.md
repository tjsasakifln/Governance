# Merge readiness

Campaign 16 does **not** merge any wave PR. This is a photograph for campaign 01 and goal 97. `observed_at`: `2026-09-04T23:38:42Z`.

Historical DAG recorded on web-cfg#536: `#522/#523/#524 → #544 → #536 → #548 → #549 → #535`.

## web-cfg open PRs (campaign 01)

| PR | mergeable | required checks | classification | merge-ready? | notes |
|---|---|---|---|---|---|
| #522 Dependabot puppeteer-core | MERGEABLE | site-ci SUCCESS; pSEO SUCCESS | NOW | candidate after campaign 01 review | Do not merge from campaign 16 |
| #523 Dependabot terser | MERGEABLE | site-ci SUCCESS; pSEO SUCCESS | NOW | candidate after campaign 01 review | |
| #524 Dependabot github-actions | MERGEABLE | **site-ci FAILURE; pSEO FAILURE** | HOLD | no | Repair checks first |
| #544 full-page capture | MERGEABLE | site-ci SUCCESS | NOW | candidate after DAG predecessors | |
| #536 runtime privacy | CONFLICTING | **site-ci FAILURE (LCP HOLD)** | HOLD | no | #586 merged a subset; LCP HOLD remains |
| #548 money pages | CONFLICTING | site-ci SUCCESS on stale head | HOLD | no until rebase | head vs main@89b081a |
| #549 CTA next-state | CONFLICTING | site-ci SUCCESS on stale head | HOLD | no until rebase | |
| #535 contract-analysis SEO | CONFLICTING | site-ci SUCCESS on stale head | HOLD | no until rebase | |

`web-cfg` `origin/main` is `89b081a8676d8a0b30747dfcb1477f21d9ac4dfb` (#586). Several DAG heads still base on `81c600b7` or older Dependabot bases — drift, not merge-ready.

## extra-cli

| PR | mergeable | checks | classification | merge-ready for this wave? |
|---|---|---|---|---|
| #531 CONTRACT_LIFECYCLE_TRUTH | MERGEABLE | 27 SUCCESS / **Test All FAILURE** | LATER | no — independent of the inbound/multivertical wave; not site migration |

No other extra-cli PR is open. #539 and #543 are already merged.

## Other active repos

| repo | open PRs | merge-ready work in this wave |
|---|---|---|
| warmbly | 0 | none |
| Governance | 0 (this docs PR is created after the photograph) | docs-only campaign 16 PR only |
| meetcfg | 0 | none |

## Explicit non-merges

- Campaign 16: `NO_MERGE` of web-cfg DAG, Dependabot, extra-cli#531, or sibling campaign branches.
- Do not merge #536 while LCP HOLD and `CONFLICTING`.
- Do not fast-forward Governance local `main`.
- Goal 97 refreshes this ledger before integrating shared registries/CI.
- `--force-with-lease` and force-push are forbidden in campaign 16.

## Checks snapshot (web-cfg, compact)

All eight open PRs also show CodeQL SUCCESS, Netlify header/redirect SUCCESS, Pages-changed NEUTRAL, deploy-preview SUCCESS except where site-ci/pSEO failed as tabled above.
