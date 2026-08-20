# ADR-CC-001 — Control Center architecture boundaries

- **Status:** Accepted for campaign `CONFENGE-CONTROL-CENTER-FANOUT-2026-08-20`
- **Date:** 2026-08-20
- **Package:** `control-center/contracts/`
- **Does not:** implement UI, PostgreSQL, collectors, authentication, or MCP runtime.

## Context

CONFENGE needs a private operational cockpit and structured strategic memory that agents can consume. Today commercial catalog authority lives in Governance `commercial/`, CRM runtime lives in Warmbly, and engineering state lives in GitHub and other origin systems. Mixing those planes produced duplicate catalogs, unsafe identity shortcuts, and the temptation to drive cobrança from a dashboard.

This ADR freezes the boundaries so later workstreams (persistence, context service, MCP server, collectors, UI) can implement without renegotiating authority.

## Decision

### 1. Governance is strategic / canonical authority

Governance remains the source of truth for:

- commercial offer catalog, terms, capacity, production gates (`commercial/`);
- strategic directives, constraints, decisions, facts, priorities, risks, hypotheses stored as `Directive` in Control Center;
- this contract family.

Control Center does **not** replace `commercial/` and MUST NOT copy a second writable catalog.

### 2. Warmbly is commercial / CRM operational runtime

Warmbly remains the system of record for pipeline, inbound, client conversations, and commercial send. Control Center may *observe* Warmbly through read-only collectors and expose `CommercialSnapshot` / `ClientStatus` as read models stamped:

```
authority.catalog_authority = "governance"
authority.commercial_runtime = "warmbly"
authority.this_document = "read_model"
```

Control Center MUST NOT send commercial messages.

### 3. Collectors and read models are read-only aggregates

Collectors produce `SourceObservation` and `CollectorRun` with `idempotency_key` and `read_only: true`. They attach `provenance` (`source`, `observed_at`, `freshness_status`, `confidence`).

They MUST NOT:

- execute cobrança, checkout, refund, cancelamento;
- write to Asaas or any payment provider;
- mutate Warmbly commercially;
- invent catalog prices or offer codes.

Finance snapshots set `read_model_only: true` and `provider_mutations: "forbidden"`.

### 4. Control Center is an aggregation + memory plane, not chat and not ERP

It stores operational snapshots, exceptions (`AttentionItem`), at most three current priorities for the homepage, human directives with audit, and scoped agent sessions. It is not a chatbot log and not a general ledger.

### 5. Agents consume by scope

MCP (`docs/mcp.v1.json`) is the principal agent interface. HTTP (`docs/http.openapi.json`) is the internal companion. Both require explicit scopes. `company` is a scope that MUST be requested and granted; it is not the default. Future `prefix:id` scopes are opaque until documented.

### 6. Fail-closed security

No secrets in git, logs, URLs, analytics, or client bundles. Audit `detail` property names that look like secrets are schema-invalid. Identity is an opaque `ActorRef`; this package does not hard-code a human password. Single-user comes later via auth, not via a baked credential.

## Consequences

- Persistence, context, MCP, GitHub collector, and UI workstreams implement *against these contracts* only.
- Convergence with Warmbly / web-cfg / extra-cli is a later campaign; this package does not edit those repos.
- PR Governance #8 (partner program) is out of scope and must not be absorbed here.

## Schema versioning

- File: `<resource>.v1.schema.json`
- Field: `schema_version` const `control-center.<resource>.v1`
- Breaking change → new `v2` file; keep `v1`.
- Additive optional fields → `v1.1` (new const). `additionalProperties: false` on v1, so unknown fields are rejected.
- Scope extension via new `prefix:id` namespaces does **not** require a breaking bump.
- New bare literals (`hr`, `legal`, …) **do** require an additive revision of `SCOPE_LITERALS`.
