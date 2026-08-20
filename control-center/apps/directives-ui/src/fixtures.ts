import type { ActorRef, Directive, DirectiveKind } from "./types.ts";
import { SCHEMA_VERSION } from "./types.ts";

export const FIXTURE_NOW = "2026-08-20T15:00:00Z";

export const FIXTURE_ACTOR: ActorRef = {
  kind: "human",
  id: "human:founder",
  display_name: "Operador local (mock)",
};

function entry(
  partial: Omit<Directive, "schema_version" | "created_by" | "created_at" | "updated_at" | "audit"> & {
    created_at?: string;
    updated_at?: string;
    note?: string;
  },
): Directive {
  const createdAt = partial.created_at ?? "2026-08-20T12:00:00Z";
  const updatedAt = partial.updated_at ?? createdAt;
  return {
    schema_version: SCHEMA_VERSION,
    id: partial.id,
    kind: partial.kind,
    scope: partial.scope,
    status: partial.status,
    title: partial.title,
    body: partial.body,
    effective_from: partial.effective_from,
    expires_at: partial.expires_at,
    supersedes: partial.supersedes,
    created_by: FIXTURE_ACTOR,
    created_at: createdAt,
    updated_at: updatedAt,
    audit: [
      {
        at: createdAt,
        actor: FIXTURE_ACTOR,
        action: "created",
        to_status: partial.status === "superseded" ? "active" : partial.status,
      },
      ...(partial.status === "superseded"
        ? [
            {
              at: updatedAt,
              actor: FIXTURE_ACTOR,
              action: "superseded" as const,
              from_status: "active" as const,
              to_status: "superseded" as const,
              ...(partial.note ? { note: partial.note } : {}),
            },
          ]
        : []),
    ],
    ...(partial.tags ? { tags: partial.tags } : {}),
  };
}

export const FIXTURE_DIRECTIVES: Directive[] = [
  entry({
    id: "cc:directive:01K3CC-NO-PROVIDER-MUTATION",
    kind: "constraint",
    scope: "finance",
    status: "active",
    title: "No provider financial mutations in Control Center",
    body: "Control Center collectors and agents MUST NOT execute cobrança, checkout, refund, cancelamento, Asaas writes, or commercial send. Those remain in origin systems under separate authority.",
    effective_from: "2026-08-20T00:00:00Z",
    expires_at: null,
    supersedes: null,
    tags: ["fail-closed", "finance"],
  }),
  entry({
    id: "cc:directive:01K3CC-GOV-CANONICAL",
    kind: "decision",
    scope: "company",
    status: "active",
    title: "Governance is canonical for strategic memory",
    body: "Governance holds strategic/canonical authority. Warmbly remains commercial/CRM operational authority. Control Center aggregates; it does not replace origin systems.",
    effective_from: "2026-08-19T00:00:00Z",
    expires_at: null,
    supersedes: ["cc:directive:01K3CC-GOV-CANONICAL-OLD"],
    tags: ["authority"],
  }),
  entry({
    id: "cc:directive:01K3CC-GOV-CANONICAL-OLD",
    kind: "decision",
    scope: "company",
    status: "superseded",
    title: "Draft: dual authority unresolved",
    body: "Earlier unresolved wording. Kept readable after supersede; do not treat as current.",
    effective_from: "2026-08-01T00:00:00Z",
    expires_at: null,
    supersedes: null,
    updated_at: "2026-08-19T00:00:00Z",
    note: "succeeded by cc:directive:01K3CC-GOV-CANONICAL",
    tags: ["authority"],
  }),
  entry({
    id: "cc:directive:01K3CC-MCP-INTERFACE",
    kind: "directive",
    scope: "company",
    status: "active",
    title: "MCP is the principal agent interface",
    body: "Agents consume Control Center through MCP. HTTP is an internal companion. Agents query by scope; they do not receive a whole-company dump.",
    effective_from: "2026-08-20T00:00:00Z",
    expires_at: null,
    supersedes: null,
    tags: ["agents"],
  }),
  entry({
    id: "cc:directive:01K3CC-WARMBLY-CRM",
    kind: "fact",
    scope: "commercial",
    status: "active",
    title: "Warmbly is the commercial operational runtime",
    body: "Commercial pipeline, inbound, and CRM mutations stay in Warmbly. Control Center commercial snapshots are read models.",
    effective_from: "2026-08-18T00:00:00Z",
    expires_at: null,
    supersedes: null,
    tags: ["warmbly"],
  }),
  entry({
    id: "cc:directive:01K3CC-HOMEPAGE-THREE",
    kind: "priority",
    scope: "company",
    status: "active",
    title: "Homepage shows exceptions and three now-items",
    body: "The cockpit homepage privileges exceptions and at most three current priorities. It is not a KPI wall.",
    effective_from: "2026-08-20T00:00:00Z",
    expires_at: null,
    supersedes: null,
    tags: ["homepage"],
  }),
  entry({
    id: "cc:directive:01K3CC-STALE-COLLECTOR",
    kind: "risk",
    scope: "infrastructure",
    status: "active",
    title: "Stale collectors hide operational truth",
    body: "If github/asaas/warmbly collectors stop, freshness becomes STALE or ERROR. Agents must not treat last-known as current.",
    effective_from: "2026-08-20T00:00:00Z",
    expires_at: null,
    supersedes: null,
    tags: ["freshness"],
  }),
  entry({
    id: "cc:directive:01K3CC-OFFER-HYPOTHESIS",
    kind: "hypothesis",
    scope: "commercial",
    status: "active",
    title: "Partner-program offer may convert better with founder-approved copy",
    body: "Hypothesis only. Not a fact and not a decision. Do not mix into authoritative commercial memory until evidence and a decision exist.",
    effective_from: "2026-08-20T00:00:00Z",
    expires_at: "2026-09-30T00:00:00Z",
    supersedes: null,
    tags: ["hypothesis"],
  }),
  entry({
    id: "cc:directive:01K3CC-DRAFT-INBOUND",
    kind: "directive",
    scope: "inbound",
    status: "draft",
    title: "Inbound SLA wording (draft)",
    body: "Draft wording for inbound response expectations. Not yet active; agents must not receive this as current context.",
    effective_from: "2026-08-21T00:00:00Z",
    expires_at: null,
    supersedes: null,
    tags: ["draft"],
  }),
];

export const FIXTURE_KIND_COVERAGE: readonly DirectiveKind[] = [
  "decision",
  "directive",
  "fact",
  "constraint",
  "priority",
  "risk",
  "hypothesis",
];
