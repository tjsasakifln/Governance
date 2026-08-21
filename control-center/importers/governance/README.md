# Control Center — Governance importer

READ-ONLY projector of Git authority already stored in this repository
(`decisions/`, `commercial/` manifests/authority) into Control Center
**memory candidates**. This package is not chat, not a second catalog, not an
ERP, and not a writer of origin systems.

Dry-run is **mandatory and the default**. The productive command is
`cc-governance-bootstrap`. Apply writes **only** the Control Center database
when both `--apply` and `--allow-control-center-db-write` are present.

## Decisions

1. Governance remains the canonical strategic plane. Candidates are projections
   of source bytes plus provenance. Git is the truth; this importer must not
   invent a different offer, price, or decision.
2. Candidate kinds are only `decision`, `directive`, `fact`, `constraint`,
   `priority`, `risk`, `hypothesis`.
3. `decision` is emitted only from an **explicit label**: a markdown heading
   named exactly `Decision` (optional trailing colon) or a JSON object with
   `kind` / `directive_kind` in the enum. The word “decided” in prose is not
   enough. Unlabeled markdown is `hypothesis`. Structured JSON with
   `schema_version` and no kind is `fact`. Everything else that cannot be
   parsed is listed in the **unclassifiable report** (never silently dropped
   or upgraded).
4. A `decisions: []` array without per-item `kind` is **not** a decision.
5. Every candidate carries `source`, `observed_at` (UTC), `freshness_status`,
   `confidence`, `content_hash` (`sha256:<hex>`), `source_path`, and
   `commit_sha`. Directive-shaped fields: `scope`, `status`, `effective_from`,
   `expires_at`, `supersedes`, `created_by`, `audit`.
6. Missing commit SHA is fail-closed: the file is unclassifiable with
   `freshness_status=ERROR`. SHA is never fabricated (`unknown`, `HEAD`,
   all-zero). Tests inject SHA via `--commit-sha` / `injectedGit`.
7. Idempotency key:
   `gov-import:<path>:<kind>:<index>:<content_hash>:<commit_sha>`.
   Same snapshot ⇒ same ids/keys/hashes.
8. Default actor is `{ kind: "system", id: "system:governance-importer" }`.
   No hardcoded human identity or password.
9. Partner-program paths (PR Governance #8) are out of scope and reported,
   not absorbed. Extra historical / legal packages are not copied into
   fixtures. Live walks may project whatever is already in Git as
   fact/hypothesis with provenance; they do not rewrite the catalog.
10. `--persist` is refused. `--apply --allow-control-center-db-write` is the
    opt-in Control Center DB write. Git and providers are never written.
    Partner-program / PR Governance #8 paths are reported, not absorbed.

## Run (bootstrap)

```bash
cd control-center/importers/governance
npx tsx src/bootstrap.ts --dry-run --root ../../..
npx tsx src/bootstrap.ts --apply --allow-control-center-db-write --root ../../..
```

Dry-run is the default (the `--dry-run` flag is accepted and is equivalent to
omitting `--apply`). Apply is explicit. Candidate count is recomputed from the
observed commit; staging RC 74 is evidence, not a contract. The JSON report
includes `bootstrap.staging_delta` explaining any difference.

## Run (dry-run)

Requires Node.js ≥ 20. From this directory:

```bash
npm install
npm test
npm run typecheck
npm run dry-run -- --root ../../.. --now 2026-08-20T15:00:00.000Z
```

Against the synthetic fixture tree (inject SHA because fixtures may be
uncommitted):

```bash
npm run dry-run -- \
  --root fixtures/synthetic-repo \
  --now 2026-08-20T15:00:00.000Z \
  --commit-sha a1b2c3d4e5f6789012345678901234567890abcd
```

Stdout is the import report JSON (`candidates` + `unclassifiable`).
Stderr is structured logs (no secrets, no PII). The importer opens files
read-only and never writes `decisions/`, `commercial/`, or origin Git.

## Env vars

| Variable | Purpose |
|---|---|
| `CC_GOVERNANCE_IMPORTER_ROOT` | Repo or fixture root (default: cwd) |
| `CC_GOVERNANCE_IMPORTER_NOW` | Pin `observed_at` (UTC RFC3339 with `Z`) |
| `CC_GOVERNANCE_IMPORTER_COMMIT_SHA` | Injected commit SHA for virtual/uncommitted trees |
| `CC_GOVERNANCE_IMPORTER_ALLOW_PERSIST` | Must stay unset. `--persist` is refused. |
| `CC_GOVERNANCE_IMPORTER_ALLOW_APPLY` | Equivalent to `--allow-control-center-db-write`. |
| `CONTROL_CENTER_DATABASE_URL` | Postgres URL for opt-in `--apply`. |

No GitHub token, Asaas key, or human password is used or required.

## Local contract (convergence)

Emitted JSON: `control-center.governance-import.v1`.

Each candidate: `control-center.governance-import-candidate.v1`.

This shape is intended to map later onto:

- `control-center/contracts` `Directive` + `SourceObservation` (snake_case;
  freshness `FRESH\|STALE\|UNKNOWN\|ERROR`; kinds as above)
- persistence collector port `recordObservation` / directive insert (sibling
  package currently uses camelCase and a slightly different freshness enum —
  **field-name drift is a convergence risk**, not a reason to edit that tree)

`PersistPort.persistCandidates` is the local adapter. The CLI never calls it.

Agents later consume by `scope`. This importer does not dump memory into MCP.

## Classification map

| Source | Kind |
|---|---|
| Markdown heading `Decision` / `Directive` / `Fact` / `Constraint` / `Priority` / `Risk` / `Hypothesis` | that kind |
| JSON `kind` or `directive_kind` in the enum | that kind |
| JSON with `schema_version` and no kind | `fact` |
| Unlabeled markdown/text | `hypothesis` |
| Invalid JSON, binary, empty, unsupported extension, missing SHA, partner-program, secret filenames | unclassifiable report |

Body is a clip of the source section or canonical JSON. Prices and offers are
not recomposed. Git remains canonical.

## Layout

```
src/           shipped parser, provenance, dry-run CLI, persist adapter
fixtures/      synthetic-repo only (no Extra, legal, partner-program, secrets)
tests/         unit/contract tests driving the shipped entry + fresh consumer
```

## Non-goals

Cockpit UI, MCP server, PostgreSQL writes, sibling workstream edits, PR #8
absorption, cobrança/checkout/refund/Asaas mutation, copying live commercial
terms into fixtures.
