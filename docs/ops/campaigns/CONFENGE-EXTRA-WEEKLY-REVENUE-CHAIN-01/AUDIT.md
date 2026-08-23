# Audit: Extra weekly revenue chain

Audit date: 2026-08-22. Scope: Governance `main` at `75f23c1` and Warmbly `main` at `55dd64d3`, before the ordered PRs listed below.

## Issues are not implementation evidence

| Reference | Audit finding | Software disposition |
| --- | --- | --- |
| Governance #47 | A merged documentation PR, not the Warmbly payment chain | No implementation credit |
| Governance #124–#129 | These issue numbers do not exist in this repository | Warmbly issues were audited instead |
| Warmbly #47 | Open commercial-intelligence scope. It does not prove a real cohort or received revenue | Remains partially open |
| Warmbly #124 | Requested a versioned Asaas adapter, but no adapter existed in tracked history or the inspected VPS pack | Warmbly PR #132 |
| Warmbly #125 | `ChainIdentity` preferred event idempotency over commercial correlation; payment events could fragment. Payment confirmation also required a hosted checkout even with a stable provider charge | Warmbly PR #133 |
| Warmbly #126 | A held webhook with a non-empty chain identity could be reported processed | Warmbly PRs #132 and #133 |
| Warmbly #127 | No versioned adapter install, exact Nginx route, or file-mode verification was present | Warmbly PR #132 |
| Warmbly #128 | No adapter-owned backup/restore drill existed | Warmbly PR #132 |
| Warmbly #129 | Some commercial metrics existed, but there was no adapter backlog/dead-letter/backup freshness surface. A real non-synthetic canary is still absent | Adapter observability in #132; real canary remains residual |

## Code, schema, test, and ADR findings

- Governance already collected `/v1/confenge/intel/executive`, but the UI did not expose an account-to-receipt row.
- The Control Center was already read-only for financial provider mutations. This boundary was preserved.
- Warmbly already had immutable offer snapshots and distinct created, confirmed, and received payment states. The terms-drift comparison, however, compared against an already merged snapshot and could miss an incoming price change.
- Warmbly event receipts were durable, but an unprocessed duplicate could short-circuit before prerequisites arrived.
- The existing Warmbly deployment documentation referred to an untracked adapter path. PR #132 makes that artifact versioned.
- ADR-CC-001 established the broad authority boundaries. ADR-CC-002 adds the canonical weekly identity and `UNKNOWN` semantics.

No title was treated as proof. Every disposition above is tied to an inspected code path, migration, fixture, or executable test.
