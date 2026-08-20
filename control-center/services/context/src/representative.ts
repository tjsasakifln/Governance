import type { RepoDomainMap } from "./scope.ts";
import type { PersistencePort } from "./store/adapter.ts";
import type { DirectiveRecord, Provenance, Scope, SourceRef } from "./types.ts";

export const REPRESENTATIVE_NOW = "2026-08-20T12:00:00.000Z";

export const REPRESENTATIVE_SCOPE: Scope = "repo:Governance";
export const SIBLING_SCOPE: Scope = "repo:Warmbly";
export const CLIENT_SCOPE: Scope = "client:acme";
export const SIBLING_CLIENT_SCOPE: Scope = "client:other";

export const REPRESENTATIVE_REPO_DOMAINS: RepoDomainMap = {
  Governance: "commercial",
  Warmbly: "commercial",
};

const OBSERVED = "2026-08-20T00:00:00.000Z";
const EFFECTIVE = "2026-01-01T00:00:00.000Z";
const CREATED = "2026-08-19T12:00:00.000Z";

const FOUNDER_SOURCE: SourceRef = {
  system: "manual",
  kind: "directive",
  locator: "representative",
};

function rec(
  partial: Omit<DirectiveRecord, "created_at" | "updated_at" | "effective_from" | "provenance"> & {
    provenance?: Provenance;
    effective_from?: string;
    created_at?: string;
    updated_at?: string;
  },
): DirectiveRecord {
  const provenance = partial.provenance ?? {
    source: FOUNDER_SOURCE,
    observed_at: OBSERVED,
    freshness_status: "FRESH",
    confidence: 1,
  };
  const created = partial.created_at ?? CREATED;
  return {
    ...partial,
    effective_from: partial.effective_from ?? EFFECTIVE,
    created_at: created,
    updated_at: partial.updated_at ?? created,
    provenance,
  };
}

export const REPRESENTATIVE_IDS = {
  companyPriority: "cc:directive:company-priority",
  companyDecision: "cc:directive:company-decision",
  domainDirective: "cc:directive:commercial-directive",
  resourceFact: "cc:directive:repo-governance-fact",
  expired: "cc:directive:repo-governance-expired",
  supersededConstraint: "cc:directive:constraint-old",
  activeConstraint: "cc:directive:constraint-now",
  hypothesis: "cc:directive:company-hypothesis",
  siblingFact: "cc:directive:sibling-repo-fact",
  clientFact: "cc:directive:client-acme-fact",
  siblingClientFact: "cc:directive:client-other-fact",
  clientsDomain: "cc:directive:clients-domain",
  collectionError: "cc:directive:collection-error",
} as const;

const FOUNDER = { kind: "human" as const, id: "founder-local" };

export function representativeRecords(): DirectiveRecord[] {
  return [
    rec({
      id: REPRESENTATIVE_IDS.companyPriority,
      revision_id: "cc:directive-revision:company-priority-1",
      version: 1,
      kind: "priority",
      title: "Close Diagnostico limited production",
      body: "The three things that matter now start with Diagnostico limited production readiness.",
      scope: "company",
      status: "active",
      expires_at: null,
      supersedes: null,
      created_by: FOUNDER,
    }),
    rec({
      id: REPRESENTATIVE_IDS.companyDecision,
      revision_id: "cc:directive-revision:company-decision-1",
      version: 1,
      kind: "decision",
      title: "Governance is strategic authority",
      body: "Governance is the canonical strategic authority. Warmbly remains commercial CRM authority.",
      scope: "company",
      status: "active",
      expires_at: null,
      supersedes: null,
      created_by: FOUNDER,
    }),
    rec({
      id: REPRESENTATIVE_IDS.domainDirective,
      revision_id: "cc:directive-revision:commercial-directive-1",
      version: 1,
      kind: "directive",
      title: "No financial-provider mutation from Control Center",
      body: "This wave does not charge, refund, cancel, or mutate Asaas.",
      scope: "commercial",
      status: "active",
      expires_at: null,
      supersedes: null,
      created_by: FOUNDER,
    }),
    rec({
      id: REPRESENTATIVE_IDS.resourceFact,
      revision_id: "cc:directive-revision:repo-governance-fact-1",
      version: 1,
      kind: "fact",
      title: "Governance repo is the strategic authority tree",
      body: "tjsasakifln/Governance holds canonical strategic memory. List prices stay in catalog, 800000 BRL cents one-time for CFG-DIAG-EXP-v1.",
      scope: REPRESENTATIVE_SCOPE,
      status: "active",
      expires_at: null,
      supersedes: null,
      created_by: FOUNDER,
    }),
    rec({
      id: REPRESENTATIVE_IDS.expired,
      revision_id: "cc:directive-revision:repo-governance-expired-1",
      version: 1,
      kind: "directive",
      title: "Temporary launch window",
      body: "This directive expired and must not appear in the active set.",
      scope: REPRESENTATIVE_SCOPE,
      status: "active",
      effective_from: "2025-12-01T00:00:00.000Z",
      expires_at: "2026-01-02T00:00:00.000Z",
      supersedes: null,
      created_by: FOUNDER,
    }),
    rec({
      id: REPRESENTATIVE_IDS.supersededConstraint,
      revision_id: "cc:directive-revision:constraint-old-1",
      version: 1,
      kind: "constraint",
      title: "Do not publish Extra historical exception",
      body: "Superseded wording of the Extra non-publication constraint.",
      scope: "commercial",
      status: "superseded",
      expires_at: null,
      supersedes: null,
      created_by: FOUNDER,
    }),
    rec({
      id: REPRESENTATIVE_IDS.activeConstraint,
      revision_id: "cc:directive-revision:constraint-now-1",
      version: 1,
      kind: "constraint",
      title: "Extra historical exception is not public",
      body: "Extra historical 1000000 cents/month remains non-public.",
      scope: "commercial",
      status: "active",
      expires_at: null,
      supersedes: [REPRESENTATIVE_IDS.supersededConstraint],
      created_by: FOUNDER,
    }),
    rec({
      id: REPRESENTATIVE_IDS.hypothesis,
      revision_id: "cc:directive-revision:company-hypothesis-1",
      version: 1,
      kind: "hypothesis",
      title: "Extra could become a later SKU",
      body: "Hypothesis only: Extra historical demand might later become a priced SKU. Not a fact or decision.",
      scope: "company",
      status: "active",
      expires_at: null,
      supersedes: null,
      created_by: FOUNDER,
      provenance: {
        source: FOUNDER_SOURCE,
        observed_at: OBSERVED,
        freshness_status: "FRESH",
        confidence: 0.4,
      },
    }),
    rec({
      id: REPRESENTATIVE_IDS.siblingFact,
      revision_id: "cc:directive-revision:sibling-repo-fact-1",
      version: 1,
      kind: "fact",
      title: "Sibling repo must not leak",
      body: "This fact belongs to repo:Warmbly and must not appear under repo:Governance.",
      scope: SIBLING_SCOPE,
      status: "active",
      expires_at: null,
      supersedes: null,
      created_by: FOUNDER,
    }),
    rec({
      id: REPRESENTATIVE_IDS.clientsDomain,
      revision_id: "cc:directive-revision:clients-domain-1",
      version: 1,
      kind: "directive",
      title: "Clients stay scoped",
      body: "Client memory is queried per client slug plus the clients domain and company.",
      scope: "clients",
      status: "active",
      expires_at: null,
      supersedes: null,
      created_by: FOUNDER,
    }),
    rec({
      id: REPRESENTATIVE_IDS.clientFact,
      revision_id: "cc:directive-revision:client-acme-fact-1",
      version: 1,
      kind: "fact",
      title: "Acme is in discovery",
      body: "client:acme is a discovery account. Sibling clients must not leak.",
      scope: CLIENT_SCOPE,
      status: "active",
      expires_at: null,
      supersedes: null,
      created_by: FOUNDER,
    }),
    rec({
      id: REPRESENTATIVE_IDS.siblingClientFact,
      revision_id: "cc:directive-revision:client-other-fact-1",
      version: 1,
      kind: "fact",
      title: "Other client must not leak",
      body: "This fact belongs to client:other.",
      scope: SIBLING_CLIENT_SCOPE,
      status: "active",
      expires_at: null,
      supersedes: null,
      created_by: FOUNDER,
    }),
    rec({
      id: REPRESENTATIVE_IDS.collectionError,
      revision_id: "cc:directive-revision:collection-error-1",
      version: 1,
      kind: "fact",
      title: "Warmbly snapshot last collection failed",
      body: "Last commercial collection failed. Freshness stays ERROR; it is not rewritten to UNKNOWN.",
      scope: "commercial",
      status: "active",
      expires_at: null,
      supersedes: null,
      created_by: FOUNDER,
      provenance: {
        source: { system: "warmbly", kind: "snapshot", locator: "representative-error" },
        observed_at: OBSERVED,
        freshness_status: "ERROR",
        confidence: 0.2,
      },
    }),
  ];
}

export function seedRepresentative(store: PersistencePort): void {
  for (const record of representativeRecords()) {
    store.insertRevision(record);
    store.setCurrent(record.id, record.revision_id);
  }
}
