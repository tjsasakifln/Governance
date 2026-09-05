# Branch drift risks

`observed_at`: `2026-09-04T23:38:42Z`. Concurrent campaigns share the Governance object store via worktrees. This photograph does not watch in background.

## web-cfg

- `origin/main` moved to `89b081a` when #586 merged (2026-09-04T19:21:26Z).
- DAG PRs #535/#536/#548/#549 report `CONFLICTING` against that tip. Their recorded bases include `81c600b7` (pre-#586).
- Dependabot #522/#523 still show older bases (`ee4882f3`); #524 shows `d5862320`. MERGEABLE does not mean the DAG order is satisfied.
- #536 additionally carries a required `site-ci` LCP FAILURE. Rebase will not by itself clear LCP HOLD.
- Campaign 01 is the only writer of those eight PRs. Campaign 16 must not comment, close, or rebase them.
- Risk: two agents “helpfully” rebase the same DAG node onto `89b081a` and collide.

## extra-cli

- `origin/main` is `3919f4d9` (#543) as of 2026-09-04T21:33:47Z.
- Open PR #531 head `cc49ad3b` / base `2f0761e4` is behind that tip even though GitHub reports MERGEABLE. Independent LATER work; still a drift risk if someone rebases it into the wave.
- Host `RUNNING_SHA` cited on extra-cli#530 comments (`1b9db789`) is not `origin/main`. Official live snapshot ≠ outbound pin. Do not collapse those SHAs.

## Governance worktrees (do not share)

Sibling campaign worktrees observed on this clone at identity time (read of `git worktree list` only; no writes):

| path slug | branch | HEAD at identity |
|---|---|---|
| `c20260904-06-governance-intake` | `feat/campaign-20260904-net-new-multivertical-intake-policy-v3` | `230d73a` (same origin/main) |
| `c20260904-15-premortem` | `audit/campaign-20260904-multivertical-premortem-v3` | `230d73a` |
| `c20260904-16-control-snapshot` | `chore/campaign-20260904-multivertical-control-snapshot-v3` | `230d73a` then this delta |

Risk: campaign 06 already owns `commercial/inbound/**` and `schemas/net-new-inbound-handraiser*`. Campaign 16 must not edit those paths. If indexing or CI registration is needed, emit fragments under `docs/integration/campaign-20260904/16/` for goal 97.

Do not `git pull` on `main`. Do not merge/rebase/cherry-pick sibling campaign branches. Integration is goals 97–99.

## warmbly / meetcfg

- No open PRs. Drift risk is **stale issue bodies**, not unmerged heads.
- Warmbly main `8602ce4a` is the SHA cited as `RUNNING_SHA` in #260 ACK. That ACK is canary-only.

## Dormant repos

lead-recovery, Inbound, outreach: zero open PRs/issues. Last pushes 2026-06-27 / 2025-07-11 / 2026-07-02. Risk is reactivation, not drift. Do not open work there.

## Snapshot vs live GitHub

This pack is an initial photograph. Counts and SHAs expire. Goal 97 must re-fetch `origin/main` and open PR lists before integration. See `refresh-protocol.md`.
