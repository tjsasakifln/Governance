# Control Center GitHub collector

Read-only GitHub collector for Confenge Control Center. It turns allowlisted repository state into an `EngineeringSnapshot` plus a `SourceObservation` adapter view. It is not chat, not an ERP, and it does not write to GitHub.

This package owns only `control-center/connectors/github/`. PostgreSQL, MCP, UI, Warmbly, and other connectors are out of scope. Types here are the **local convergence contract** — sibling workstreams must not be edited to wire this up.

## Decisions

- Governance remains strategic/canonical authority. This collector only observes GitHub.
- Credentials come only from the environment (PAT or a pre-minted GitHub App installation token). The collector never POSTs to mint tokens, never writes issues/PRs/labels/merges, and issues only GET (optional HEAD is allowed by the transport contract but unused).
- Every aggregated item carries `source`, `observed_at` (UTC ISO-8601 `Z`), `freshness_status`, and `confidence` when it can be computed.
- HTTP 200 with `[]` is success with zero issues. HTTP 401/403/429/5xx or missing credentials are a distinct error channel (`freshness_status: failed` / `stale`) and are not encoded as “zero issues”.
- Compare `404` is `support: "unsupported"` with `ahead_by`/`behind_by` null — never invented zeros.
- ETag + `If-None-Match` + `304` reuse the stored body. `x-ratelimit-remaining: 0` or 429/403 rate-limit stops further requests (`retry-after` / `x-ratelimit-reset`).
- Observation identities are derived from source entity identity so a second collect of the same bodies is idempotent.
- Fail closed on missing credentials. Secrets never appear in snapshot JSON, logs, URLs, or the client bundle (there is no client bundle here).
- Dates are UTC internally. Financial amounts are not collected.

## Run

```bash
cd control-center/connectors/github
npm install
npm test
npm run collect -- --fixture-dir fixtures/populated --out ./out/engineering-snapshot.json --now 2026-08-20T18:00:00.000Z
```

Live GitHub (still GET-only) uses env tokens and `GITHUB_REPOS`. Do not run live collection from CI; tests replay fixtures with an injected HTTP transport and never open a socket to `api.github.com`.

## Env vars

| Variable | Purpose |
| --- | --- |
| `GITHUB_TOKEN` / `GITHUB_PAT` / `GH_TOKEN` | PAT bearer token |
| `GITHUB_APP_INSTALLATION_TOKEN` | Pre-minted GitHub App installation token |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_APP_INSTALLATION_ID` | Documented for operators. If present without `GITHUB_APP_INSTALLATION_TOKEN`, collect fails closed. Minting requires POST and is out of band. |
| `GITHUB_REPOS` | Comma-separated allowlist `owner/name,owner/name` |
| `GITHUB_API_BASE` | Default `https://api.github.com` |
| `GITHUB_RECENT_COMMIT_LIMIT` | 1–100, default 10 |
| `GITHUB_COMPARE_HEADS` | JSON map `{"owner/name":{"base":"main","head":"develop"}}` |

CLI flags: `--out`, `--fixture-dir`, `--repos`, `--now` (UTC ISO).

## Convergence contract

`collect()` returns:

```ts
{
  snapshot: EngineeringSnapshot,      // schema: confenge.control_center.engineering_snapshot.v1
  observations: SourceObservation[]   // schema: confenge.control_center.source_observation.v1
}
```

`EngineeringSnapshot` (and every nested item) includes provenance:

- `source: "github"`
- `observed_at`: UTC
- `freshness_status`: `fresh` \| `not_modified` \| `stale` \| `failed` \| `unsupported`
- `confidence`: 0–1 when computed

Per allowlisted repo the snapshot carries: identity + `default_branch`, recent commits, open issues (PRs filtered out via `pull_request`), open PRs (`draft`, `age_seconds` from a clock, review/check status), check/workflow failures, last-activity timestamps, and branch divergence (`ahead_by`/`behind_by`/`status`) or an explicit unsupported/unavailable marker.

`SourceObservation` is a flattened adapter of the same run (`kind` + `subject` + `payload`). This is **not** extra-cli `SourceObservation`. Later Control Center persistence/MCP/UI should ingest this JSON rather than importing extra-cli.

Expected later integration (do not implement here): a convergence campaign maps this snapshot into PostgreSQL operational state and scoped agent context.

## Tests

`npm test` compiles strict TypeScript and runs `node:test` against fixture manifests. No network. Primary cases: populated snapshot, empty issues vs 403/429/5xx/missing auth, allowlist skip, ETag 304, rate-limit stop, idempotent second collect, secret redaction, shipped CLI entry.
