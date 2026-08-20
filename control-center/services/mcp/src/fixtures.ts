import type {
  ClientContext,
  CompanyState,
  ContextRecord,
  DecisionRecord,
  DirectiveRecord,
  ExceptionRecord,
  PriorityRecord,
} from "./types.js";

/** Distinctive strings used by protocol tests to prove scoping. */
export const MARKERS = {
  companyDump: "COMPANY_WIDE_MEMORY_DUMP_DO_NOT_EXPOSE",
  commercial: "SCOPE_COMMERCIAL_MARKER",
  finance: "SCOPE_FINANCE_MARKER",
  acme: "CLIENT_ACME_MARKER",
  beta: "CLIENT_BETA_MARKER",
} as const;

export const FIXTURE_SCOPES = ["company", "ops.commercial", "ops.finance"] as const;
export const FIXTURE_CLIENTS = ["acme-ltda", "beta-industria"] as const;

const OBSERVED = "2026-08-20T15:00:00.000Z";
const SOURCE = "control-center.stub.fixtures";

function prov(
  extra?: { source?: string; observed_at?: string; freshness_status?: ContextRecord["freshness_status"]; confidence?: number },
) {
  return {
    source: extra?.source ?? SOURCE,
    observed_at: extra?.observed_at ?? OBSERVED,
    freshness_status: extra?.freshness_status ?? ("fresh" as const),
    confidence: extra?.confidence ?? 0.9,
  };
}

export const companyDumpSecret = {
  id: "mem-dump-1",
  body: MARKERS.companyDump,
};

export const priorities: PriorityRecord[] = [
  {
    id: "pri-1",
    rank: 1,
    title: "Unblock ACME onboarding exception",
    body: "ACME legal packet is stale; do not send commercial follow-up until Governance confirms.",
    scope: "ops.commercial",
    kind: "priority",
    ...prov({ confidence: 0.94 }),
  },
  {
    id: "pri-2",
    rank: 2,
    title: "Reconcile overdue Diagnóstico invoice",
    body: "Invoice 150000 BRL cents is past due; observe only — no Asaas mutation from agents.",
    scope: "ops.finance",
    kind: "priority",
    ...prov({ confidence: 0.88 }),
  },
  {
    id: "pri-3",
    rank: 3,
    title: "Keep Control Center read-only toward providers",
    body: "This layer aggregates state. It does not charge, refund, checkout, or cancel.",
    scope: "company",
    kind: "priority",
    ...prov({ confidence: 1 }),
  },
];

export const exceptions: ExceptionRecord[] = [
  {
    id: "exc-1",
    title: "ACME onboarding blocked",
    body: "Missing founder-approved legal packet freshness.",
    scope: "ops.commercial",
    severity: "high",
    ...prov({ freshness_status: "stale", confidence: 0.8 }),
  },
  {
    id: "exc-2",
    title: "Diagnóstico invoice overdue",
    body: "Open amount 150000 cents BRL. Collection systems remain the operational authority.",
    scope: "ops.finance",
    severity: "medium",
    ...prov({ confidence: 0.91 }),
  },
];

export const companyState: CompanyState = {
  company_id: "confenge",
  display_timezone: "America/Sao_Paulo",
  top_three: priorities,
  exceptions,
  ...prov({ confidence: 0.9 }),
};

export const contextRecords: ContextRecord[] = [
  {
    id: "ctx-company-1",
    kind: "fact",
    title: "Control Center is not chat and not ERP",
    body: "Aggregates exceptions, priorities, directives, and agent activity for a single human operator.",
    scope: "company",
    ...prov(),
  },
  {
    id: "ctx-comm-1",
    kind: "fact",
    title: "Commercial pipeline snapshot",
    body: `${MARKERS.commercial}: Warmbly remains CRM authority. Two Diagnóstico conversations need human review; no outbound send from this layer.`,
    scope: "ops.commercial",
    ...prov({ source: "warmbly.crm.read-model", confidence: 0.84 }),
  },
  {
    id: "ctx-fin-1",
    kind: "risk",
    title: "Finance observation only",
    body: `${MARKERS.finance}: Asaas is the payment provider; MCP tools must not charge, refund, checkout, or cancel. Open Diagnóstico receivable is 150000 cents BRL.`,
    scope: "ops.finance",
    ...prov({ source: "finance.ledger.read-model", freshness_status: "stale", confidence: 0.7 }),
  },
];

export const directives: DirectiveRecord[] = [
  {
    id: "dir-comm-1",
    kind: "directive",
    body: "Do not send commercial follow-up to ACME until the legal packet is fresh.",
    scope: "ops.commercial",
    status: "active",
    effective_from: "2026-08-01T00:00:00.000Z",
    expires_at: null,
    supersedes: null,
    created_by: "founder",
    audit: {
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
      events: [{ at: "2026-08-01T00:00:00.000Z", action: "created", by: "founder" }],
    },
    ...prov({ source: "governance.memory", confidence: 1 }),
  },
  {
    id: "dir-fin-1",
    kind: "constraint",
    body: "Agents must not mutate Asaas or any payment provider from Control Center.",
    scope: "ops.finance",
    status: "active",
    effective_from: "2026-07-01T00:00:00.000Z",
    expires_at: null,
    supersedes: null,
    created_by: "founder",
    audit: {
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
      events: [{ at: "2026-07-01T00:00:00.000Z", action: "created", by: "founder" }],
    },
    ...prov({ source: "governance.memory", confidence: 1 }),
  },
  {
    id: "dir-company-1",
    kind: "constraint",
    body: "Human directives of kind decision, constraint, or authoritative directive are founder-owned.",
    scope: "company",
    status: "active",
    effective_from: "2026-06-01T00:00:00.000Z",
    expires_at: null,
    supersedes: null,
    created_by: "founder",
    audit: {
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
      events: [{ at: "2026-06-01T00:00:00.000Z", action: "created", by: "founder" }],
    },
    ...prov({ source: "governance.memory", confidence: 1 }),
  },
  {
    id: "dir-comm-old",
    kind: "directive",
    body: "Superseded commercial cadence experiment.",
    scope: "ops.commercial",
    status: "superseded",
    effective_from: "2026-05-01T00:00:00.000Z",
    expires_at: "2026-08-01T00:00:00.000Z",
    supersedes: null,
    created_by: "founder",
    audit: {
      created_at: "2026-05-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
      events: [
        { at: "2026-05-01T00:00:00.000Z", action: "created", by: "founder" },
        { at: "2026-08-01T00:00:00.000Z", action: "superseded", by: "founder" },
      ],
    },
    ...prov({ source: "governance.memory", confidence: 1 }),
  },
];

export const decisions: DecisionRecord[] = [
  {
    id: "dec-1",
    kind: "decision",
    title: "Governance is strategic authority",
    body: "Warmbly remains operational commercial/CRM authority.",
    scope: "company",
    status: "active",
    decided_at: "2026-07-01T12:00:00.000Z",
    effective_from: "2026-07-01T12:00:00.000Z",
    expires_at: null,
    supersedes: null,
    created_by: "founder",
    audit: {
      created_at: "2026-07-01T12:00:00.000Z",
      updated_at: "2026-07-01T12:00:00.000Z",
      events: [{ at: "2026-07-01T12:00:00.000Z", action: "created", by: "founder" }],
    },
    ...prov({ source: "governance.decisions", observed_at: "2026-07-01T12:00:00.000Z", confidence: 1 }),
  },
  {
    id: "dec-2",
    kind: "decision",
    title: "MCP is the agent interface",
    body: "Agents consume scoped context via MCP; they do not receive the whole-company dump.",
    scope: "company",
    status: "active",
    decided_at: "2026-08-10T09:00:00.000Z",
    effective_from: "2026-08-10T09:00:00.000Z",
    expires_at: null,
    supersedes: null,
    created_by: "founder",
    audit: {
      created_at: "2026-08-10T09:00:00.000Z",
      updated_at: "2026-08-10T09:00:00.000Z",
      events: [{ at: "2026-08-10T09:00:00.000Z", action: "created", by: "founder" }],
    },
    ...prov({ source: "governance.decisions", observed_at: "2026-08-10T09:00:00.000Z", confidence: 1 }),
  },
  {
    id: "dec-3",
    kind: "decision",
    title: "Money is integer cents",
    body: "Aggregated financial figures use amount_cents plus currency. Display tz America/Sao_Paulo; storage UTC.",
    scope: "ops.finance",
    status: "active",
    decided_at: "2026-08-18T14:30:00.000Z",
    effective_from: "2026-08-18T14:30:00.000Z",
    expires_at: null,
    supersedes: null,
    created_by: "founder",
    audit: {
      created_at: "2026-08-18T14:30:00.000Z",
      updated_at: "2026-08-18T14:30:00.000Z",
      events: [{ at: "2026-08-18T14:30:00.000Z", action: "created", by: "founder" }],
    },
    ...prov({ source: "governance.decisions", observed_at: "2026-08-18T14:30:00.000Z", confidence: 1 }),
  },
];

export const clients: Record<string, ClientContext> = {
  "acme-ltda": {
    client: "acme-ltda",
    display_name: "ACME Ltda",
    open_amount: { amount_cents: 0, currency: "BRL" },
    records: [
      {
        id: "cli-acme-1",
        kind: "fact",
        title: "ACME onboarding",
        body: `${MARKERS.acme}: legal packet stale; commercial send blocked by active directive dir-comm-1.`,
        scope: "client.acme-ltda",
        ...prov({ source: "warmbly.crm.read-model", freshness_status: "stale", confidence: 0.81 }),
      },
    ],
    ...prov({ source: "warmbly.crm.read-model", freshness_status: "stale", confidence: 0.81 }),
  },
  "beta-industria": {
    client: "beta-industria",
    display_name: "Beta Indústria",
    open_amount: { amount_cents: 150000, currency: "BRL" },
    records: [
      {
        id: "cli-beta-1",
        kind: "fact",
        title: "Beta receivable",
        body: `${MARKERS.beta}: Diagnóstico invoice 150000 cents BRL overdue. Observation only.`,
        scope: "client.beta-industria",
        ...prov({ source: "finance.ledger.read-model", confidence: 0.91 }),
      },
    ],
    ...prov({ source: "finance.ledger.read-model", confidence: 0.91 }),
  },
};
