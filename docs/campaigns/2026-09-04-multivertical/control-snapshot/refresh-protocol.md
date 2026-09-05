# Refresh protocol

This campaign produces an **initial photograph** and versioned locks. It does **not** “accompany in background”.

- `photograph_observed_at`: `2026-09-04T23:38:42Z`
- `refresh_owner`: goal **97** (shared registries / build / dependency integration)
- `audit_owner`: goal **98**
- `promotion_owner`: goal **99**

## When to refresh

Goal 97 **must** refresh this ledger before integrating sibling campaign PRs or shared files. Refresh again if any of the following drifted:

- any of the eight web-cfg open PRs changed `state`, `mergeable`, or required checks
- extra-cli#530, Warmbly#260, Governance#1/#65, web-cfg#61/#577–#588, extra-cli#531, Warmbly#43/#155 changed
- `origin/main` SHA of web-cfg, extra-cli, warmbly, Governance, or meetcfg moved
- lead-recovery / Inbound / outreach gained an open issue or PR (do not reactivate; record)

## How to refresh

1. Acquire the campaign preflight flock on the Governance common git dir; `git fetch origin --prune --tags`; release the lock.
2. Re-query GitHub with authenticated `gh` and/or GitHub MCP. Prompt numbers are anchors, not oracle.
3. Write a new `observed_at` (UTC) on every SHA and count. Do not overwrite historical rows in place without keeping the previous `observed_at`.
4. Reclassify named reconciliation nodes with exactly one of: `DONE|PARTIAL|NOW|HOLD|BLOCKED_EXTERNAL|SUPERSEDED|DECISION_ONLY|LATER`.
5. Recompute `contract-dag.json` `content_hash` values from the canonical payload **excluding** `content_hash`. Missing or divergent version/hash **fails closed**. Draft ids are not production runtime fallback.
6. Do not turn this protocol into a watcher, cron, or SMTP path.

## What not to refresh from memory

- “8 open web-cfg PRs”
- extra-cli#539 still open
- extra-cli#531 as site migration
- Warmbly#47 still open
- #586 as LCP clearance
- extra-cli#543 as Governance#1 close
- QUEUED as SMTP GO

## Fail-closed rules for the pack

- If GitHub cannot be read, the refresh is `BLOCKED_EXTERNAL`. Local prose is not success.
- If a contract `version` or `content_hash` is absent or diverges from the canonical payload hash, consumers must reject the pack.
- `outbound_eligible` must remain `false`. `auto_send` must remain `false`.
- Campaign 16 write set remains documentation/ledger. Product schemas, home, forms, queues, consumers, `.github/**`, lockfiles, and shared README/index stay out.

## 100-repetition behaviour

Re-parsing the eight snapshot files N times on the same HEAD must yield the same classifications, contract hashes, and lock campaign ids. Refreshing GitHub on a later `observed_at` may change classifications; that is a new photograph, not a mutation of the old one.
