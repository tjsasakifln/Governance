export const FIXED_NOW = new Date("2026-08-20T15:00:00.000Z");

export const NEEDY_SLUG = "norte-engenharia";
export const HEALTHY_SLUG = "sul-consultoria";
export const RESOLVED_SLUG = "leste-obras";
export const WEEK_DUE_SLUG = "oeste-projeto";

const MANUAL = {
  source: "manual",
  observed_at: "2026-08-20T14:00:00.000Z",
  freshness_status: "fresh",
  confidence: 1,
} as const;

const GOVERNANCE = {
  source: "governance",
  observed_at: "2026-08-19T10:00:00.000Z",
  freshness_status: "fresh",
  confidence: 1,
} as const;

const ADAPTER = {
  source: "adapter:delivery",
  observed_at: "2026-08-20T09:00:00.000Z",
  freshness_status: "stale",
  confidence: 0.7,
} as const;

/** Mixed-source client that needs the operator now. */
export function norteEngenhariaPayload(): Record<string, unknown> {
  return {
    client_slug: NEEDY_SLUG,
    display_name: "Norte Engenharia",
    source: MANUAL.source,
    observed_at: MANUAL.observed_at,
    freshness_status: MANUAL.freshness_status,
    confidence: MANUAL.confidence,
    commitments: [
      {
        id: "c-relatorio-mensal",
        title: "Entrega do relatório mensal de obra",
        owner: "founder",
        due_at: "2026-08-18T12:00:00.000Z",
        evidence_ref: "governance:decision/relatorio-mensal-2026-08",
        status: "open",
        provenance: { ...GOVERNANCE },
      },
    ],
    blockers: [
      {
        id: "b-acesso-homolog",
        title: "Acesso ao ambiente de homologação pendente",
        owner: "founder",
        evidence_ref: "manual:note/homolog-access",
        status: "open",
        provenance: {
          source: "manual",
          observed_at: "2026-08-20T12:00:00.000Z",
          freshness_status: "fresh",
          confidence: 1,
        },
      },
    ],
    deliverables: [
      {
        id: "d-relatorio",
        title: "Relatório mensal de obra",
        status: "blocked",
        due_at: "2026-08-18T12:00:00.000Z",
        evidence_ref: "governance:deliverable/relatorio-mensal",
        provenance: { ...GOVERNANCE },
      },
    ],
    risk: [
      {
        id: "r-escopo",
        title: "Escopo da fase 2 ainda não fechado",
        severity: "medium",
        status: "open",
        evidence_ref: "adapter:delivery/risk-escopo",
        provenance: { ...ADAPTER },
      },
    ],
    next_action: {
      summary: "Destravar acesso de homologação e reconfirmar prazo da entrega",
      due_at: "2026-08-20T18:00:00.000Z",
      owner: "founder",
      provenance: { ...MANUAL },
    },
  };
}

/** Healthy in-scope client: far-future commitment, no blocker, no risk. */
export function sulConsultoriaPayload(): Record<string, unknown> {
  return {
    client_slug: HEALTHY_SLUG,
    display_name: "Sul Consultoria",
    source: "manual",
    observed_at: "2026-08-20T13:00:00.000Z",
    freshness_status: "fresh",
    confidence: 1,
    commitments: [
      {
        id: "c-revisao-trimestral",
        title: "Revisão trimestral de entregas",
        owner: "founder",
        due_at: "2026-12-01T12:00:00.000Z",
        evidence_ref: "manual:note/revisao-trimestral",
        status: "open",
        provenance: {
          source: "manual",
          observed_at: "2026-08-20T13:00:00.000Z",
          freshness_status: "fresh",
          confidence: 1,
        },
      },
    ],
    blockers: [],
    deliverables: [
      {
        id: "d-pacote-q4",
        title: "Pacote de entregas Q4",
        status: "in_progress",
        due_at: "2026-12-01T12:00:00.000Z",
        evidence_ref: "manual:note/pacote-q4",
        provenance: {
          source: "manual",
          observed_at: "2026-08-20T13:00:00.000Z",
          freshness_status: "fresh",
          confidence: 1,
        },
      },
    ],
    risk: [],
    next_action: {
      summary: "Acompanhar cronograma trimestral",
      due_at: "2026-11-15T12:00:00.000Z",
      owner: "founder",
      provenance: {
        source: "manual",
        observed_at: "2026-08-20T13:00:00.000Z",
        freshness_status: "fresh",
        confidence: 1,
      },
    },
  };
}

/** Resolved blocker + done commitment: must not surface as attention/due/blocker. */
export function lesteObrasPayload(): Record<string, unknown> {
  return {
    client_slug: RESOLVED_SLUG,
    display_name: "Leste Obras",
    source: "governance",
    observed_at: "2026-08-19T16:00:00.000Z",
    freshness_status: "fresh",
    confidence: 1,
    commitments: [
      {
        id: "c-kickoff",
        title: "Kickoff da obra leste",
        owner: "founder",
        due_at: "2026-08-01T12:00:00.000Z",
        evidence_ref: "governance:decision/kickoff-leste",
        status: "done",
        provenance: {
          source: "governance",
          observed_at: "2026-08-02T12:00:00.000Z",
          freshness_status: "fresh",
          confidence: 1,
        },
      },
    ],
    blockers: [
      {
        id: "b-vpn-antiga",
        title: "VPN antiga indisponível",
        owner: "founder",
        evidence_ref: "manual:note/vpn-antiga",
        status: "resolved",
        provenance: {
          source: "manual",
          observed_at: "2026-08-10T12:00:00.000Z",
          freshness_status: "fresh",
          confidence: 1,
        },
      },
    ],
    deliverables: [
      {
        id: "d-kickoff-ata",
        title: "Ata de kickoff",
        status: "delivered",
        due_at: "2026-08-01T12:00:00.000Z",
        evidence_ref: "governance:deliverable/kickoff-ata",
        provenance: {
          source: "governance",
          observed_at: "2026-08-02T12:00:00.000Z",
          freshness_status: "fresh",
          confidence: 1,
        },
      },
    ],
    risk: [
      {
        id: "r-atraso-kickoff",
        title: "Atraso de kickoff",
        severity: "high",
        status: "closed",
        evidence_ref: "governance:risk/atraso-kickoff",
        provenance: {
          source: "governance",
          observed_at: "2026-08-02T12:00:00.000Z",
          freshness_status: "fresh",
          confidence: 1,
        },
      },
    ],
  };
}

/** Commitment due inside 7 days but not overdue / not within 48h. */
export function oesteProjetoPayload(): Record<string, unknown> {
  return {
    client_slug: WEEK_DUE_SLUG,
    display_name: "Oeste Projeto",
    source: "adapter:delivery",
    observed_at: "2026-08-20T11:00:00.000Z",
    freshness_status: "fresh",
    confidence: 0.8,
    commitments: [
      {
        id: "c-parecer-tecnico",
        title: "Parecer técnico da etapa 3",
        owner: "delivery",
        due_at: "2026-08-25T12:00:00.000Z",
        evidence_ref: "adapter:delivery/parecer-etapa-3",
        status: "open",
        provenance: {
          source: "adapter:delivery",
          observed_at: "2026-08-20T11:00:00.000Z",
          freshness_status: "fresh",
          confidence: 0.8,
        },
      },
    ],
    blockers: [],
    deliverables: [],
    risk: [],
  };
}

export function fixturePayloads(): unknown[] {
  return [
    norteEngenhariaPayload(),
    sulConsultoriaPayload(),
    lesteObrasPayload(),
    oesteProjetoPayload(),
  ];
}
