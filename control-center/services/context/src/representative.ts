import type { PersistenceAdapter } from "./store/adapter.ts";
import type { DirectiveRecord, Scope } from "./types.ts";

export const REPRESENTATIVE_NOW = "2026-08-20T12:00:00.000Z";

export const REPRESENTATIVE_SCOPE: Scope = {
  company: "confenge",
  domain: "commercial",
  resource: "offer:CFG-DIAG-EXP-v1",
};

export const SIBLING_SCOPE: Scope = {
  company: "confenge",
  domain: "commercial",
  resource: "offer:OTHER-SKU",
};

const OBSERVED = "2026-08-20T00:00:00.000Z";
const EFFECTIVE = "2026-01-01T00:00:00.000Z";
const CREATED = "2026-08-19T12:00:00.000Z";

function rec(
  partial: Omit<DirectiveRecord, "created_at" | "effective_from" | "provenance"> & {
    provenance?: DirectiveRecord["provenance"];
    effective_from?: string;
    created_at?: string;
  },
): DirectiveRecord {
  const provenance = partial.provenance ?? {
    source: "founder",
    observed_at: OBSERVED,
    freshness_status: "fresh",
    confidence: 1,
  };
  return {
    ...partial,
    effective_from: partial.effective_from ?? EFFECTIVE,
    created_at: partial.created_at ?? CREATED,
    provenance,
  };
}

export const REPRESENTATIVE_IDS = {
  companyPriority: "dir-company-priority",
  companyDecision: "dir-company-decision",
  domainDirective: "dir-domain-directive",
  resourceFact: "dir-resource-fact",
  expired: "dir-resource-expired",
  supersededConstraint: "dir-constraint-old",
  activeConstraint: "dir-constraint-now",
  hypothesis: "dir-company-hypothesis",
  siblingFact: "dir-sibling-fact",
} as const;

export function representativeRecords(): DirectiveRecord[] {
  return [
    rec({
      id: REPRESENTATIVE_IDS.companyPriority,
      revision_id: "rev-company-priority-1",
      version: 1,
      kind: "priority",
      title: "Close Diagnostico limited production",
      body: "The three things that matter now start with Diagnostico limited production readiness.",
      scope: { company: "confenge" },
      status: "active",
      expires_at: null,
      supersedes: null,
      created_by: "founder-local",
    }),
    rec({
      id: REPRESENTATIVE_IDS.companyDecision,
      revision_id: "rev-company-decision-1",
      version: 1,
      kind: "decision",
      title: "Governance is strategic authority",
      body: "Governance is the canonical strategic authority. Warmbly remains commercial CRM authority.",
      scope: { company: "confenge" },
      status: "active",
      expires_at: null,
      supersedes: null,
      created_by: "founder-local",
    }),
    rec({
      id: REPRESENTATIVE_IDS.domainDirective,
      revision_id: "rev-domain-directive-1",
      version: 1,
      kind: "directive",
      title: "No financial-provider mutation from Control Center",
      body: "This wave does not charge, refund, cancel, or mutate Asaas.",
      scope: { company: "confenge", domain: "commercial" },
      status: "active",
      expires_at: null,
      supersedes: null,
      created_by: "founder-local",
    }),
    rec({
      id: REPRESENTATIVE_IDS.resourceFact,
      revision_id: "rev-resource-fact-1",
      version: 1,
      kind: "fact",
      title: "Diagnostico SKU list price",
      body: "CFG-DIAG-EXP-v1 list price is 800000 BRL cents, one-time.",
      scope: REPRESENTATIVE_SCOPE,
      status: "active",
      expires_at: null,
      supersedes: null,
      created_by: "founder-local",
    }),
    rec({
      id: REPRESENTATIVE_IDS.expired,
      revision_id: "rev-resource-expired-1",
      version: 1,
      kind: "directive",
      title: "Temporary launch window",
      body: "This directive expired and must not appear in the active set.",
      scope: REPRESENTATIVE_SCOPE,
      status: "active",
      effective_from: "2025-12-01T00:00:00.000Z",
      expires_at: "2026-01-02T00:00:00.000Z",
      supersedes: null,
      created_by: "founder-local",
    }),
    rec({
      id: REPRESENTATIVE_IDS.supersededConstraint,
      revision_id: "rev-constraint-old-1",
      version: 1,
      kind: "constraint",
      title: "Do not publish Extra historical exception",
      body: "Superseded wording of the Extra non-publication constraint.",
      scope: { company: "confenge", domain: "commercial" },
      status: "superseded",
      expires_at: null,
      supersedes: null,
      created_by: "founder-local",
    }),
    rec({
      id: REPRESENTATIVE_IDS.activeConstraint,
      revision_id: "rev-constraint-now-1",
      version: 1,
      kind: "constraint",
      title: "Extra historical exception is not public",
      body: "Extra historical 1000000 cents/month remains non-public.",
      scope: { company: "confenge", domain: "commercial" },
      status: "active",
      expires_at: null,
      supersedes: REPRESENTATIVE_IDS.supersededConstraint,
      created_by: "founder-local",
    }),
    rec({
      id: REPRESENTATIVE_IDS.hypothesis,
      revision_id: "rev-company-hypothesis-1",
      version: 1,
      kind: "hypothesis",
      title: "Extra could become a later SKU",
      body: "Hypothesis only: Extra historical demand might later become a priced SKU. Not a fact or decision.",
      scope: { company: "confenge" },
      status: "active",
      expires_at: null,
      supersedes: null,
      created_by: "founder-local",
      provenance: {
        source: "founder",
        observed_at: OBSERVED,
        freshness_status: "fresh",
        confidence: 0.4,
      },
    }),
    rec({
      id: REPRESENTATIVE_IDS.siblingFact,
      revision_id: "rev-sibling-fact-1",
      version: 1,
      kind: "fact",
      title: "Sibling SKU must not leak",
      body: "This fact belongs to offer:OTHER-SKU and must not appear under CFG-DIAG-EXP-v1.",
      scope: SIBLING_SCOPE,
      status: "active",
      expires_at: null,
      supersedes: null,
      created_by: "founder-local",
    }),
  ];
}

export function seedRepresentative(store: PersistenceAdapter): void {
  for (const record of representativeRecords()) {
    store.insertRevision(record);
    store.setCurrent(record.id, record.revision_id);
  }
}
