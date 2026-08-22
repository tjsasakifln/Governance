import type { DestinationId } from "../destinations";
import { DESTINATIONS, getDestination } from "../destinations";
import { selectHomepageAttention, selectHomepagePriorities } from "../homepage";
import type { DestinationPage } from "../adapters/contract";
import { composeHoje } from "../hoje-compose";
import type {
  ActorRef,
  AgentActivity,
  AgentSession,
  AttentionItem,
  ClientStatus,
  CommercialSnapshot,
  Directive,
  EngineeringSnapshot,
  FinanceSnapshot,
  PriorityRecommendation,
  Provenance,
  ServiceHealth,
} from "../types";

export const MOCK_OPERATOR: ActorRef = {
  kind: "human",
  id: "human:operator",
  display_name: "Operador",
};

const GENERATED_AT = "2026-08-20T18:00:00Z";

function provenance(
  system: string,
  kind: string,
  locator: string,
  observed_at: string,
  freshness_status: Provenance["freshness_status"],
  confidence: number,
  extras: Partial<Pick<Provenance, "freshness_window_seconds" | "source">> = {},
): Provenance {
  return {
    source: extras.source ?? { system, kind, locator },
    observed_at,
    freshness_status,
    confidence,
    ...(extras.freshness_window_seconds !== undefined
      ? { freshness_window_seconds: extras.freshness_window_seconds }
      : {}),
  };
}

export const ATTENTION_FIXTURES: AttentionItem[] = [
  {
    schema_version: "control-center.attention-item.v1",
    id: "cc:attention-item:01K3CC-COLLECTOR-ERROR",
    scope: "infrastructure",
    severity: "critical",
    status: "open",
    title: "Coleta de saúde da infra falhou",
    summary:
      "A última corrida do coletor de saúde retornou ERROR. Não há observação utilizável para o serviço de contexto.",
    provenance: provenance(
      "collector",
      "health-probe",
      "health/context-service",
      "2026-08-20T17:12:00Z",
      "ERROR",
      0.21,
      { freshness_window_seconds: 60 },
    ),
    detected_at: "2026-08-20T17:12:00Z",
    homepage_eligible: true,
    recommended_action: "Inspecionar o coletor no workstream de infra. Não reabrir túneis ad hoc.",
  },
  {
    schema_version: "control-center.attention-item.v1",
    id: "cc:attention-item:01K3CC-OVERDUE-INVOICE",
    scope: "client:acme-industria",
    severity: "high",
    status: "open",
    title: "Fatura em atraso — Acme Indústria",
    summary:
      "Recebível aberto fora da janela acordada. Origem Asaas via observação somente leitura; não cobrar a partir deste cockpit.",
    provenance: provenance(
      "asaas",
      "receivable-read",
      "finance/receivables/open",
      "2026-08-20T17:00:00Z",
      "STALE",
      0.74,
      { freshness_window_seconds: 1800 },
    ),
    detected_at: "2026-08-20T17:00:00Z",
    homepage_eligible: true,
    recommended_action: "Revisar em Warmbly/Asaas de origem. Não mutar daqui.",
  },
  {
    schema_version: "control-center.attention-item.v1",
    id: "cc:attention-item:01K3CC-FAILING-CHECK",
    scope: "repo:tjsasakifln/Governance",
    severity: "high",
    status: "open",
    title: "Check de CI falhando em Governance",
    summary: "Há um check vermelho no repositório canônico. Control Center apenas observa.",
    provenance: provenance(
      "github",
      "repo-read",
      "repos/tjsasakifln/Governance/checks",
      "2026-08-20T17:54:00Z",
      "FRESH",
      0.95,
    ),
    detected_at: "2026-08-20T17:54:00Z",
    homepage_eligible: true,
    recommended_action: "Tratar no workstream dono do check. Não absorver o PR #8.",
  },
  {
    schema_version: "control-center.attention-item.v1",
    id: "cc:attention-item:01K3CC-INBOUND-UNREAD",
    scope: "inbound",
    severity: "medium",
    status: "open",
    title: "Inbound sem leitura há mais de quatro horas",
    summary: "Fila Warmbly com itens não lidos. Autoridade operacional comercial permanece no Warmbly.",
    provenance: provenance(
      "warmbly",
      "inbound-queue",
      "inbound/unread",
      "2026-08-20T17:45:00Z",
      "FRESH",
      0.88,
    ),
    detected_at: "2026-08-20T17:45:00Z",
    homepage_eligible: true,
    recommended_action: "Triagem no Warmbly. Este cockpit não envia mensagem comercial.",
  },
  {
    schema_version: "control-center.attention-item.v1",
    id: "cc:attention-item:01K3CC-CLIENT-NOTE-UNKNOWN",
    scope: "client:beta-logistica",
    severity: "low",
    status: "acknowledged",
    title: "Nota de cliente sem observação recente",
    summary: "Não há observação utilizável do ciclo de vida deste cliente desde a última sincronização.",
    provenance: provenance(
      "unknown",
      "client-record",
      "clients/beta-logistica",
      "2026-08-19T12:00:00Z",
      "UNKNOWN",
      0.4,
    ),
    detected_at: "2026-08-19T12:00:00Z",
    homepage_eligible: true,
    recommended_action: "Confirmar o recorte no Warmbly quando a coleta voltar.",
  },
  {
    schema_version: "control-center.attention-item.v1",
    id: "cc:attention-item:01K3CC-RESOLVED-OLD",
    scope: "commercial",
    severity: "medium",
    status: "resolved",
    title: "Lead duplicado (já resolvido)",
    summary: "Item resolvido; não deve aparecer no cockpit de Hoje.",
    provenance: provenance(
      "warmbly",
      "crm-read-model",
      "commercial/leads/dup",
      "2026-08-18T10:00:00Z",
      "FRESH",
      0.9,
    ),
    detected_at: "2026-08-18T10:00:00Z",
    homepage_eligible: false,
  },
];

export const PRIORITY_FIXTURES: PriorityRecommendation[] = [
  {
    schema_version: "control-center.priority-recommendation.v1",
    id: "cc:priority-recommendation:01K3CC-RANK-1-INBOUND",
    scope: "company",
    rank: 1,
    title: "Destravar os três inbound sem leitura",
    rationale:
      "A fila de inbound tem itens com mais de quatro horas. Esta é a primeira das no máximo três prioridades atuais.",
    provenance: provenance(
      "warmbly",
      "inbound-queue",
      "inbound/unread",
      "2026-08-20T17:45:00Z",
      "FRESH",
      0.88,
    ),
    generated_at: "2026-08-20T17:46:00Z",
    horizon: "now",
    attention_item_ids: ["cc:attention-item:01K3CC-INBOUND-UNREAD"],
  },
  {
    schema_version: "control-center.priority-recommendation.v1",
    id: "cc:priority-recommendation:01K3CC-RANK-2-OVERDUE",
    scope: "company",
    rank: 2,
    title: "Revisar o recebível em atraso da Acme",
    rationale: "Exceção financeira de alta severidade, observação defasada. Origem Asaas; sem mutação daqui.",
    provenance: provenance(
      "asaas",
      "receivable-read",
      "finance/receivables/open",
      "2026-08-20T17:00:00Z",
      "STALE",
      0.74,
    ),
    generated_at: "2026-08-20T17:46:00Z",
    horizon: "today",
    attention_item_ids: ["cc:attention-item:01K3CC-OVERDUE-INVOICE"],
  },
  {
    schema_version: "control-center.priority-recommendation.v1",
    id: "cc:priority-recommendation:01K3CC-RANK-3-CI",
    scope: "company",
    rank: 3,
    title: "Tratar o check vermelho de Governance",
    rationale: "Falha de CI no repositório canônico. Terceira e última prioridade do recorte de Hoje.",
    provenance: provenance(
      "github",
      "repo-read",
      "repos/tjsasakifln/Governance/checks",
      "2026-08-20T17:54:00Z",
      "FRESH",
      0.95,
    ),
    generated_at: "2026-08-20T17:55:00Z",
    horizon: "today",
    attention_item_ids: ["cc:attention-item:01K3CC-FAILING-CHECK"],
  },
  {
    schema_version: "control-center.priority-recommendation.v1",
    id: "cc:priority-recommendation:01K3CC-RANK-4-EXCLUDED",
    scope: "company",
    rank: 4,
    title: "Backlog de documentação (fora do recorte de Hoje)",
    rationale: "Rank 4 não entra nas três coisas mais importantes agora.",
    provenance: provenance(
      "governance",
      "manual",
      "docs/ops",
      "2026-08-20T16:00:00Z",
      "FRESH",
      0.6,
    ),
    generated_at: "2026-08-20T16:00:00Z",
    horizon: "this_week",
  },
];

export const COMMERCIAL_SNAPSHOT: CommercialSnapshot = {
  schema_version: "control-center.commercial-snapshot.v1",
  id: "cc:commercial-snapshot:01K3CC-WARMBLY-OPS",
  scope: "commercial",
  generated_at: "2026-08-20T17:40:00Z",
  provenance: provenance(
    "warmbly",
    "crm-read-model",
    "commercial/pipeline",
    "2026-08-20T17:39:00Z",
    "FRESH",
    0.84,
  ),
  authority: {
    catalog_authority: "governance",
    commercial_runtime: "warmbly",
    this_document: "read_model",
  },
  offer_pin: {
    catalog_authority: "governance",
    catalog_id: "CFG-OFFER-CATALOG-v1",
    known_offer_ids: ["CFG-DIAG-EXP-v1", "CFG-DIRB2G-FLEX-v1"],
  },
  funnel: {
    new_leads: 6,
    qualified: 4,
    opportunities: 3,
    proposals: 2,
    clients: 1,
  },
  pipeline_nominal: { amount_cents: 4800000, currency: "BRL" },
  pipeline_weighted: {
    amount_cents: 2100000,
    currency: "BRL",
    probability_reliable: true,
  },
  aging_count: 1,
  stalled_count: 1,
  missing_next_action_count: 2,
  pipeline_open_count: 4,
  inbound_unread_count: 3,
  at_risk_client_count: 1,
  extra_historical: {
    treated_as_public_offer: false,
    label: "Extra histórica",
    note: "Nunca tratada como oferta pública.",
  },
  offer_version_drift: { count: 1, detail: "proposta com versão de catálogo defasada" },
  attention_item_ids: ["cc:attention-item:01K3CC-INBOUND-UNREAD"],
};

export const FINANCE_SNAPSHOT: FinanceSnapshot = {
  schema_version: "control-center.finance-snapshot.v1",
  id: "cc:finance-snapshot:01K3CC-RO-RECEIVABLES",
  scope: "finance",
  generated_at: "2026-08-20T17:20:00Z",
  provenance: provenance(
    "asaas",
    "receivable-read",
    "finance/receivables",
    "2026-08-20T17:10:00Z",
    "STALE",
    0.7,
  ),
  read_model_only: true,
  provider_mutations: "forbidden",
  contracted: { amount_cents: 5000000, currency: "BRL" },
  billed: { amount_cents: 4000000, currency: "BRL" },
  paid: { amount_cents: 2500000, currency: "BRL" },
  effectively_received: { amount_cents: 2300000, currency: "BRL" },
  overdue: { amount_cents: 1500000, currency: "BRL" },
  receivable: { amount_cents: 2500000, currency: "BRL" },
  refunds: { amount_cents: 100000, currency: "BRL" },
  chargebacks: { amount_cents: 100000, currency: "BRL" },
  receivables_open: { amount_cents: 2500000, currency: "BRL" },
  receivables_overdue: { amount_cents: 1500000, currency: "BRL" },
  attention_item_ids: ["cc:attention-item:01K3CC-OVERDUE-INVOICE"],
};

export const ENGINEERING_SNAPSHOT: EngineeringSnapshot = {
  schema_version: "control-center.engineering-snapshot.v1",
  id: "cc:engineering-snapshot:01K3CC-GOVERNANCE-REPO",
  scope: "repo:tjsasakifln/Governance",
  generated_at: "2026-08-20T17:55:00Z",
  provenance: provenance(
    "github",
    "repo-read",
    "repos/tjsasakifln/Governance",
    "2026-08-20T17:54:00Z",
    "FRESH",
    0.95,
  ),
  open_pr_count: 2,
  failing_check_count: 1,
  open_incident_count: 0,
  repo_scopes: ["repo:tjsasakifln/Governance"],
  repository: "tjsasakifln/Governance",
  default_branch: "main",
  p0_count: 0,
  p1_count: 1,
  aging: { count: 1, oldest_days: 4 },
  blockers: ["CI vermelho no default"],
  last_evidence: "check suite 2026-08-20T17:54:00Z",
  active_work_without_evidence: {
    remains: "hypothesis",
    detail: "Trabalho ativo sem evidência permanece hipótese.",
  },
  attention_item_ids: ["cc:attention-item:01K3CC-FAILING-CHECK"],
};

export const CLIENT_FIXTURES: ClientStatus[] = [
  {
    schema_version: "control-center.client-status.v1",
    id: "cc:client-status:acme-industria",
    scope: "client:acme-industria",
    client_slug: "acme-industria",
    display_name: "Acme Indústria",
    lifecycle: "churn_risk",
    provenance: provenance(
      "warmbly",
      "client-record",
      "clients/acme-industria",
      "2026-08-20T16:30:00Z",
      "FRESH",
      0.8,
    ),
    open_receivables: { amount_cents: 1500000, currency: "BRL" },
    attention_item_ids: ["cc:attention-item:01K3CC-OVERDUE-INVOICE"],
    notes: "Recebível em atraso. Origem Warmbly/Asaas; sem cobrança daqui.",
    health: "churn_risk",
    commitments: ["Diagnóstico v1.1"],
    owner: "founder",
    due_date: "2026-08-22T15:00:00Z",
    deliverables: ["relatório Diagnóstico"],
    blockers: ["fatura vencida"],
    next_action: "Revisar no Warmbly; não cobrar daqui",
    evidence: "asaas/receivables/open",
    sources: {
      warmbly: "FRESH",
      asaas: "UNKNOWN",
      governance: "UNKNOWN",
    },
  },
  {
    schema_version: "control-center.client-status.v1",
    id: "cc:client-status:beta-logistica",
    scope: "client:beta-logistica",
    client_slug: "beta-logistica",
    display_name: "Beta Logística",
    lifecycle: "paused",
    provenance: provenance(
      "unknown",
      "client-record",
      "clients/beta-logistica",
      "2026-08-19T12:00:00Z",
      "UNKNOWN",
      0.4,
    ),
    attention_item_ids: ["cc:attention-item:01K3CC-CLIENT-NOTE-UNKNOWN"],
    notes: "Ciclo de vida sem observação recente.",
  },
  {
    schema_version: "control-center.client-status.v1",
    id: "cc:client-status:gama-saude",
    scope: "client:gama-saude",
    client_slug: "gama-saude",
    display_name: "Gama Saúde",
    lifecycle: "active",
    provenance: provenance(
      "warmbly",
      "client-record",
      "clients/gama-saude",
      "2026-08-20T17:20:00Z",
      "FRESH",
      0.86,
    ),
  },
];

/**
 * The operator runbook for infrastructure. A real document, on https, with no
 * credentials in the URL — the catalog supplies it per service and the shell
 * only renders links it can vouch for.
 */
const RUNBOOK_URL =
  "https://github.com/tjsasakifln/Governance/blob/main/control-center/deploy/RUNBOOK.md";

export const HEALTH_FIXTURES: ServiceHealth[] = [
  {
    schema_version: "control-center.service-health.v1",
    id: "cc:service-health:01K3CC-CONTEXT-API",
    scope: "infrastructure",
    service_name: "context-service",
    status: "unknown",
    provenance: provenance(
      "collector",
      "health-probe",
      "health/context-service",
      "2026-08-20T17:12:00Z",
      "ERROR",
      0.21,
      { freshness_window_seconds: 60 },
    ),
    checked_at: "2026-08-20T17:12:00Z",
    service_id: "context-service",
    role: "API de contexto operacional (somente leitura)",
    endpoint: "https://api.confenge.com.br/v1/context",
    last_error: "http: sonda de saúde retornou erro de transporte",
    runbook_url: RUNBOOK_URL,
    message: "Última sonda falhou. Sem chute de saúde.",
    checks: [{ name: "ready", status: "unknown", detail: "probe error" }],
    http: { status: "unknown", detail: "probe error" },
    tls: { status: "unknown" },
    docker: { status: "unknown" },
    backup: { status: "unknown" },
    disk: { used_pct: 91, detail: "91%" },
    memory: { used_pct: 82, detail: "82%" },
    pncp_freshness: { freshness_status: "ERROR", observed_at: "2026-08-20T17:12:00Z" },
    partial_outage: true,
  },
  {
    schema_version: "control-center.service-health.v1",
    id: "cc:service-health:01K3CC-WEB-CFG",
    scope: "infrastructure",
    service_name: "web-cfg",
    status: "degraded",
    provenance: provenance(
      "collector",
      "health-probe",
      "health/web-cfg",
      "2026-08-20T16:00:00Z",
      "STALE",
      0.55,
      { freshness_window_seconds: 60 },
    ),
    checked_at: "2026-08-20T16:00:00Z",
    latency_ms: 820,
    service_id: "web-cfg",
    role: "Painel de configuração web (edge)",
    endpoint: "https://cfg.confenge.com.br/health",
    last_error: "reachability: observação mais antiga que a janela de frescor",
    duplicate_count: 2,
    checks: [{ name: "ready", status: "degraded", detail: "observation older than window" }],
  },
  {
    schema_version: "control-center.service-health.v1",
    id: "cc:service-health:01K3CC-GITHUB-COLLECTOR",
    scope: "infrastructure",
    service_name: "github-collector",
    status: "healthy",
    provenance: provenance(
      "collector",
      "health-probe",
      "health/github-collector",
      "2026-08-20T17:58:00Z",
      "FRESH",
      0.99,
      { freshness_window_seconds: 60 },
    ),
    checked_at: "2026-08-20T17:58:00Z",
    latency_ms: 42,
    service_id: "github-collector",
    role: "Coletor GitHub (execuções agendadas)",
    endpoint: "https://api.confenge.com.br/collectors/github/health",
    checks: [{ name: "ready", status: "healthy" }],
  },
];

export const DIRECTIVE_FIXTURES: Directive[] = [
  {
    schema_version: "control-center.directive.v1",
    id: "cc:directive:01K3CC-NO-PROVIDER-MUTATION",
    kind: "constraint",
    scope: "finance",
    status: "active",
    title: "Sem mutações financeiras de provedor no Control Center",
    body: "Coletores e agentes NÃO executam cobrança, checkout, refund, cancelamento, escritas Asaas ou envio comercial. Isso permanece nos sistemas de origem.",
    effective_from: "2026-08-20T00:00:00Z",
    expires_at: null,
    supersedes: null,
    created_by: MOCK_OPERATOR,
    created_at: "2026-08-20T12:00:00Z",
    updated_at: "2026-08-20T12:00:00Z",
    audit: [
      {
        at: "2026-08-20T12:00:00Z",
        actor: MOCK_OPERATOR,
        action: "created",
        to_status: "active",
      },
    ],
    tags: ["fail-closed", "finance"],
  },
  {
    schema_version: "control-center.directive.v1",
    id: "cc:directive:01K3CC-GOVERNANCE-AUTHORITY",
    kind: "decision",
    scope: "company",
    status: "active",
    title: "Governance é a autoridade estratégica; Warmbly a operacional comercial",
    body: "Catálogo e decisões canônicas vivem em Governance. CRM/pipeline executam no Warmbly. Este cockpit agrega estado, não substitui origem.",
    effective_from: "2026-08-17T00:00:00Z",
    expires_at: null,
    supersedes: null,
    created_by: MOCK_OPERATOR,
    created_at: "2026-08-17T12:00:00Z",
    updated_at: "2026-08-17T12:00:00Z",
    audit: [
      {
        at: "2026-08-17T12:00:00Z",
        actor: MOCK_OPERATOR,
        action: "created",
        to_status: "active",
      },
    ],
  },
  {
    schema_version: "control-center.directive.v1",
    id: "cc:directive:01K3CC-SCOPE-CONTEXT",
    kind: "directive",
    scope: "company",
    status: "active",
    title: "Agentes consultam contexto por escopo",
    body: "Nenhum agente recebe a memória inteira da empresa. Contexto é recortado pelos escopos concedidos na sessão.",
    effective_from: "2026-08-20T00:00:00Z",
    expires_at: null,
    supersedes: null,
    created_by: MOCK_OPERATOR,
    created_at: "2026-08-20T12:10:00Z",
    updated_at: "2026-08-20T12:10:00Z",
    audit: [
      {
        at: "2026-08-20T12:10:00Z",
        actor: MOCK_OPERATOR,
        action: "created",
        to_status: "active",
      },
    ],
  },
  {
    schema_version: "control-center.directive.v1",
    id: "cc:directive:01K3CC-MONEY-CENTS",
    kind: "fact",
    scope: "finance",
    status: "active",
    title: "Valores financeiros são inteiros em centavos mais currency",
    body: "Floats são inválidos. Apresentação pode formatar; o modelo permanece amount_cents + currency.",
    effective_from: "2026-08-20T00:00:00Z",
    expires_at: null,
    supersedes: null,
    created_by: MOCK_OPERATOR,
    created_at: "2026-08-20T12:20:00Z",
    updated_at: "2026-08-20T12:20:00Z",
    audit: [
      {
        at: "2026-08-20T12:20:00Z",
        actor: MOCK_OPERATOR,
        action: "created",
        to_status: "active",
      },
    ],
  },
  {
    schema_version: "control-center.directive.v1",
    id: "cc:directive:01K3CC-HOJE-THREE",
    kind: "priority",
    scope: "company",
    status: "active",
    title: "Hoje privilegia exceções e no máximo três prioridades",
    body: "Homepage não é parede de KPIs e não é chat.",
    effective_from: "2026-08-20T00:00:00Z",
    expires_at: null,
    supersedes: null,
    created_by: MOCK_OPERATOR,
    created_at: "2026-08-20T12:30:00Z",
    updated_at: "2026-08-20T12:30:00Z",
    audit: [
      {
        at: "2026-08-20T12:30:00Z",
        actor: MOCK_OPERATOR,
        action: "created",
        to_status: "active",
      },
    ],
  },
  {
    schema_version: "control-center.directive.v1",
    id: "cc:directive:01K3CC-STALE-RISK",
    kind: "risk",
    scope: "finance",
    status: "active",
    title: "Observação financeira defasada não deve ser tratada como saldo ao vivo",
    body: "Freshness STALE no recorte Asaas. Confiança e recência são eixos distintos.",
    effective_from: "2026-08-20T17:00:00Z",
    expires_at: "2026-08-27T00:00:00Z",
    supersedes: null,
    created_by: MOCK_OPERATOR,
    created_at: "2026-08-20T17:05:00Z",
    updated_at: "2026-08-20T17:05:00Z",
    audit: [
      {
        at: "2026-08-20T17:05:00Z",
        actor: MOCK_OPERATOR,
        action: "created",
        to_status: "active",
      },
    ],
  },
  {
    schema_version: "control-center.directive.v1",
    id: "cc:directive:01K3CC-COLLECTOR-HYPOTHESIS",
    kind: "hypothesis",
    scope: "infrastructure",
    status: "active",
    title: "A falha da sonda pode ser janela de freshness, não queda do serviço",
    body: "Hipótese a confirmar no coletor. Não promover a incidente sem evidência.",
    effective_from: "2026-08-20T17:12:00Z",
    expires_at: "2026-08-21T17:12:00Z",
    supersedes: null,
    created_by: { kind: "agent", id: "agent:cc-context", display_name: "Agente de contexto" },
    created_at: "2026-08-20T17:15:00Z",
    updated_at: "2026-08-20T17:15:00Z",
    audit: [
      {
        at: "2026-08-20T17:15:00Z",
        actor: { kind: "agent", id: "agent:cc-context" },
        action: "created",
        to_status: "active",
      },
    ],
  },
];

export const AGENT_ACTIVITY_FIXTURES: AgentActivity[] = [
  {
    schema_version: "control-center.agent-activity.v1",
    id: "cc:agent-activity:01K3CC-LEDGER-RUNNING",
    agent_id: "agent:cc-context",
    provider: "grok",
    scope: "finance",
    repo: "tjsasakifln/Governance",
    status: "running",
    presentation_status: "RUNNING",
    started_at: "2026-08-20T17:50:00Z",
    finished_at: null,
    goal: "Preparar briefing de recebíveis",
    campaign: "CONFENGE-CC-LIVE-FOUNDER-COCKPIT-01",
    summary: "RUNNING defasado: ainda em execução. Não promover a DONE.",
    provenance: provenance(
      "collector",
      "report",
      "agent-activity/running",
      "2026-08-20T16:00:00Z",
      "STALE",
      0.5,
    ),
    evidence_refs: [],
    residual_work: ["confirmar evidência de settlement"],
    blockers: ["snapshot financeiro STALE"],
  },
  {
    schema_version: "control-center.agent-activity.v1",
    id: "cc:agent-activity:01K3CC-LEDGER-PARTIAL",
    agent_id: "agent:cc-context",
    provider: "grok",
    scope: "finance",
    status: "partial",
    presentation_status: "PARTIAL",
    started_at: "2026-08-20T17:50:00Z",
    finished_at: "2026-08-20T18:10:00Z",
    goal: "Prepare a scoped finance briefing for overdue receivables.",
    summary: "Read finance snapshot; leftover: confirm settlement evidence.",
    provenance: provenance(
      "collector",
      "report",
      "agent-activity/01K3CC-LEDGER-PARTIAL",
      "2026-08-20T18:10:00Z",
      "FRESH",
      0.9,
    ),
    evidence_refs: ["cc:finance-snapshot:01K3CC-RO-RECEIVABLES"],
    residual_work: ["Confirm settlement evidence for invoice overdue more than 30 days"],
  },
  {
    schema_version: "control-center.agent-activity.v1",
    id: "cc:agent-activity:01K3CC-LEDGER-UNKNOWN",
    agent_id: "agent:cc-context",
    scope: "company",
    status: "not-a-status",
    presentation_status: "UNKNOWN",
    started_at: "2026-08-20T17:00:00Z",
    finished_at: null,
    goal: "status não reconhecido",
    summary: "Status ausente no enum v1; apresentado como UNKNOWN.",
    provenance: provenance(
      "collector",
      "report",
      "agent-activity/unknown",
      "2026-08-20T17:00:00Z",
      "UNKNOWN",
      0.2,
    ),
  },
];

export const AGENT_SESSION_FIXTURES: AgentSession[] = [
  {
    schema_version: "control-center.agent-session.v1",
    id: "cc:agent-session:01K3CC-CTX-FINANCE",
    agent_id: "agent:cc-context",
    requested_scopes: ["finance", "client:acme-industria"],
    granted_scopes: ["finance", "client:acme-industria"],
    purpose:
      "Preparar briefing recortado de recebíveis em atraso. Não despejar a memória da empresa.",
    started_at: "2026-08-20T17:50:00Z",
    ended_at: null,
    status: "open",
    created_by: { kind: "agent", id: "agent:cc-context" },
    include_directives: true,
    include_snapshots: true,
    include_attention: true,
  },
  {
    schema_version: "control-center.agent-session.v1",
    id: "cc:agent-session:01K3CC-CTX-DENIED-COMPANY",
    agent_id: "agent:cc-context",
    requested_scopes: ["company"],
    granted_scopes: [],
    purpose: "Pedido de dump company-wide. Negado: agentes consultam por escopo.",
    started_at: "2026-08-20T17:10:00Z",
    ended_at: "2026-08-20T17:10:02Z",
    status: "denied",
    created_by: { kind: "system", id: "system:mcp-guard" },
    include_directives: false,
    include_snapshots: false,
    include_attention: false,
  },
];

export const FRESHNESS_SAMPLES: Record<Provenance["freshness_status"], Provenance> = {
  FRESH: ATTENTION_FIXTURES[2]!.provenance,
  STALE: ATTENTION_FIXTURES[1]!.provenance,
  UNKNOWN: ATTENTION_FIXTURES[4]!.provenance,
  ERROR: ATTENTION_FIXTURES[0]!.provenance,
};

function pageFor(
  id: DestinationId,
  extras: Omit<DestinationPage, "id" | "label" | "scope" | "generated_at" | "operator">,
): DestinationPage {
  const dest = getDestination(id);
  return {
    id,
    label: dest.label,
    scope: dest.scope,
    generated_at: GENERATED_AT,
    operator: MOCK_OPERATOR,
    ...extras,
  };
}

function attentionByScope(predicate: (item: AttentionItem) => boolean): AttentionItem[] {
  return ATTENTION_FIXTURES.filter(predicate);
}

export function defaultPages(): Record<DestinationId, DestinationPage> {
  const hojeAttention = selectHomepageAttention(ATTENTION_FIXTURES);
  const hojePriorities = selectHomepagePriorities(PRIORITY_FIXTURES);
  return {
    hoje: pageFor("hoje", {
      headline: "O que exige atenção agora. Não é chat e não é parede de KPIs.",
      attention: hojeAttention,
      priorities: hojePriorities,
      commercial: COMMERCIAL_SNAPSHOT,
      finance: FINANCE_SNAPSHOT,
      engineering: ENGINEERING_SNAPSHOT,
      clients: CLIENT_FIXTURES,
      health: HEALTH_FIXTURES,
      activities: AGENT_ACTIVITY_FIXTURES,
      hoje: composeHoje({
        generated_at: GENERATED_AT,
        headline: "O que exige atenção agora. Não é chat e não é parede de KPIs.",
        priorities: hojePriorities,
        incidents: hojeAttention,
        clients: CLIENT_FIXTURES,
        commercial: COMMERCIAL_SNAPSHOT,
        finance: FINANCE_SNAPSHOT,
        engineering: ENGINEERING_SNAPSHOT,
        infra: HEALTH_FIXTURES,
        activities: AGENT_ACTIVITY_FIXTURES,
      }),
    }),
    comercial: pageFor("comercial", {
      headline: "Recorte comercial somente leitura. Origem Warmbly; catálogo canônico em Governance.",
      attention: attentionByScope(
        (item) => item.scope === "inbound" || item.scope === "commercial" || item.scope === "clients",
      ).filter((item) => item.status === "open" || item.status === "acknowledged"),
      priorities: PRIORITY_FIXTURES.filter((item) => item.rank === 1),
      commercial: COMMERCIAL_SNAPSHOT,
    }),
    clientes: pageFor("clientes", {
      headline: "Estado agregado por cliente. Exceções primeiro.",
      attention: attentionByScope((item) => item.scope.startsWith("client:")),
      priorities: PRIORITY_FIXTURES.filter((item) => item.rank === 2),
      clients: CLIENT_FIXTURES,
    }),
    financeiro: pageFor("financeiro", {
      headline:
        "Somente leitura. Cobrança, checkout, refund, cancelamento e escritas Asaas são proibidas neste cockpit.",
      attention: attentionByScope((item) => item.scope.startsWith("client:") || item.scope === "finance"),
      priorities: PRIORITY_FIXTURES.filter((item) => item.rank === 2),
      finance: FINANCE_SNAPSHOT,
    }),
    engenharia: pageFor("engenharia", {
      headline: "Sinais de repositório. Sem mutar origem e sem absorver o PR Governance #8.",
      attention: attentionByScope((item) => item.scope.startsWith("repo:")),
      priorities: PRIORITY_FIXTURES.filter((item) => item.rank === 3),
      engineering: ENGINEERING_SNAPSHOT,
    }),
    infra: pageFor("infra", {
      headline: "Saúde observada. Freshness e confiança são eixos distintos.",
      attention: attentionByScope((item) => item.scope === "infrastructure"),
      priorities: [],
      health: HEALTH_FIXTURES,
    }),
    crescimento: pageFor("crescimento", {
      headline: "Inbound e visibilidade. Sem atribuição inventada entre sistemas.",
      attention: attentionByScope((item) => item.scope === "inbound"),
      priorities: [],
      commercial: COMMERCIAL_SNAPSHOT,
      health: HEALTH_FIXTURES,
    }),
    memoria: pageFor("memoria", {
      headline: "Diretivas humanas por kind, escopo, vigência e trilha de auditoria.",
      attention: [],
      priorities: [],
      directives: DIRECTIVE_FIXTURES,
    }),
    agentes: pageFor("agentes", {
      headline: "Sessões com escopos concedidos. Pedido company-wide é negado.",
      attention: [],
      priorities: [],
      sessions: AGENT_SESSION_FIXTURES,
      activities: AGENT_ACTIVITY_FIXTURES,
    }),
  };
}

export function emptyPages(): Record<DestinationId, DestinationPage> {
  const empty: Record<DestinationId, DestinationPage> = {} as Record<DestinationId, DestinationPage>;
  for (const dest of DESTINATIONS) {
    empty[dest.id] = pageFor(dest.id, {
      headline: dest.description,
      attention: [],
      priorities: [],
    });
  }
  return empty;
}

export function stalePages(): Record<DestinationId, DestinationPage> {
  const pages = defaultPages();
  const stamp = (item: Provenance): Provenance => ({
    ...item,
    freshness_status: "STALE",
  });
  for (const id of Object.keys(pages) as DestinationId[]) {
    const page = pages[id];
    page.attention = page.attention.map((item) => ({
      ...item,
      provenance: stamp(item.provenance),
    }));
    page.priorities = page.priorities.map((item) => ({
      ...item,
      provenance: stamp(item.provenance),
    }));
    if (page.finance) page.finance = { ...page.finance, provenance: stamp(page.finance.provenance) };
    if (page.commercial) {
      page.commercial = { ...page.commercial, provenance: stamp(page.commercial.provenance) };
    }
    if (page.engineering) {
      page.engineering = { ...page.engineering, provenance: stamp(page.engineering.provenance) };
    }
    if (page.health) {
      page.health = page.health.map((item) => ({ ...item, provenance: stamp(item.provenance) }));
    }
    if (page.clients) {
      page.clients = page.clients.map((item) => ({ ...item, provenance: stamp(item.provenance) }));
    }
    if (page.activities) {
      page.activities = page.activities.map((item) => ({
        ...item,
        provenance: stamp(item.provenance),
        presentation_status:
          item.presentation_status === "RUNNING" ? "RUNNING" : item.presentation_status,
      }));
    }
    page.hoje = composeHoje({
      generated_at: page.generated_at,
      headline: page.headline,
      priorities: page.priorities,
      incidents: page.attention,
      clients: page.clients ?? [],
      commercial: page.commercial ?? null,
      finance: page.finance ?? null,
      engineering: page.engineering ?? null,
      infra: page.health ?? [],
      activities: page.activities ?? [],
    });
  }
  return pages;
}
