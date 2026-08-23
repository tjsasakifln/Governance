import { attentionAlert, priorityAlert, type AlertPresentation } from "./alerts";
import { isOperationalClient } from "./client-identity";
import { formatLocal } from "./datetime";
import { ownMapValue } from "./own-map";
import { combinedTone, freshnessTone, type FreshnessTone } from "./freshness-tone";
import { selectHomepageAttention, selectHomepagePriorities } from "./homepage";
import type {
  AgentActivity,
  AttentionItem,
  ClientStatus,
  CommercialSnapshot,
  EngineeringSnapshot,
  FinanceSnapshot,
  FreshnessStatus,
  HealthStatus,
  PriorityRecommendation,
  Provenance,
  ServiceHealth,
  SourceRef,
} from "./types";
import {
  WRITE_SHORTCUT_KINDS,
  WRITE_SHORTCUT_LABELS,
  type WriteShortcutKind,
} from "./adapters/paths";
import { agentStatusLabel, healthLabel } from "./ui/labels";
import {
  absenceNoteFor,
  assertNoHealthyOnUntrusted,
  summarizeDomains,
  type HojeDomainSummary,
} from "./hoje-domains";

export const HOJE_SECTION_IDS = [
  "domains",
  "top3",
  "incidents",
  "clients",
  "commercial",
  "finance",
  "engineering",
  "agents",
  "shortcuts",
] as const;
export type HojeSectionId = (typeof HOJE_SECTION_IDS)[number];

export const HOJE_SECTION_TITLES = [
  "Panorama por domínio.",
  "Se eu só puder fazer 3 coisas hoje.",
  "Incidentes, blockers e riscos.",
  "Clientes que exigem atenção.",
  "Comercial em exceção.",
  "Financeiro em exceção.",
  "Engenharia e infraestrutura em exceção.",
  "Atividade recente dos agentes.",
  "Atalhos para decisão, nota, risco e hipótese.",
] as const;
export type HojeSectionTitle = (typeof HOJE_SECTION_TITLES)[number];

export interface HojeRow {
  id: string;
  title: string;
  summary: string;
  source: SourceRef;
  observed_at: string;
  observed_at_local: string;
  freshness_status: FreshnessStatus;
  freshness_tone: FreshnessTone;
  confidence?: number;
  kind?: string;
  severity?: string;
  money?: { amount_cents: number; currency: string };
  health?: string;
  /**
   * Actionable presentation for the alert bands (top 3 and incidents).
   * Absent on rows that are a domain roll-up rather than an alert.
   */
  alert?: AlertPresentation;
}

export interface HojeShortcut {
  kind: WriteShortcutKind;
  label: string;
  hint: string;
}

export interface HojeSection {
  id: HojeSectionId;
  title: HojeSectionTitle;
  compressed: boolean;
  compressed_summary: string | null;
  rows: HojeRow[];
  shortcuts: HojeShortcut[];
  /** Only the "domains" section carries the consolidated per-domain read. */
  summary?: HojeDomainSummary;
}

export interface HojeViewModel {
  schema_version: "control-center.hoje-view.v1";
  generated_at: string;
  headline: string;
  sections: HojeSection[];
  charts_emitted: false;
}

export interface HojeComposeInput {
  generated_at: string;
  headline: string;
  priorities: readonly PriorityRecommendation[];
  incidents: readonly AttentionItem[];
  clients: readonly ClientStatus[];
  commercial: CommercialSnapshot | null;
  finance: FinanceSnapshot | null;
  engineering: EngineeringSnapshot | null;
  infra: readonly ServiceHealth[];
  activities: readonly AgentActivity[];
  /**
   * Raw `GET /v1/operational-snapshots` body (an
   * `control-center.operational-envelope.v1` document). Left out only by
   * fixture callers that predate the per-domain panorama; when it is missing
   * the panorama says so instead of painting six healthy cards.
   */
  operational_envelope?: unknown;
}

const CLIENT_NEEDS = new Set(["churn_risk", "paused", "churned"]);
const AGENT_NEEDS = new Set(["RUNNING", "PARTIAL", "BLOCKED", "FAILED", "UNKNOWN"]);

function isUntrusted(status: FreshnessStatus): boolean {
  return status !== "FRESH";
}

function isHealth(value: string | undefined): value is HealthStatus {
  return value === "healthy" || value === "degraded" || value === "down" || value === "unknown";
}

function rowFrom(
  base: {
    id: string;
    title: string;
    summary: string;
    kind?: string;
    severity?: string;
    money?: HojeRow["money"];
    health?: string;
    alert?: AlertPresentation;
  },
  provenance: Provenance,
): HojeRow {
  const row: HojeRow = {
    id: base.id,
    title: base.title,
    summary: base.summary,
    source: provenance.source,
    observed_at: provenance.observed_at,
    observed_at_local: formatLocal(provenance.observed_at),
    freshness_status: provenance.freshness_status,
    freshness_tone: combinedTone(
      provenance.freshness_status,
      isHealth(base.health) ? base.health : undefined,
    ),
    confidence: provenance.confidence,
  };
  if (base.kind) row.kind = base.kind;
  if (base.severity) row.severity = base.severity;
  if (base.money) row.money = base.money;
  if (base.health) row.health = base.health;
  if (base.alert) row.alert = base.alert;
  return row;
}

function section(
  id: HojeSectionId,
  rows: HojeRow[],
  compressed: boolean,
  compressed_summary: string | null,
  shortcuts: HojeShortcut[] = [],
): HojeSection {
  const index = HOJE_SECTION_IDS.indexOf(id);
  return {
    id,
    title: HOJE_SECTION_TITLES[index]!,
    compressed,
    compressed_summary,
    rows,
    shortcuts,
  };
}

/**
 * "Ignorar" is not a state. Every compressed band has to say which of the two
 * it is: the slice was read and had nothing (`sem ocorrências`), or the slice
 * never arrived (`faltam dados`, with the contract's absence reason). The
 * envelope is what knows the difference.
 */
const DOMAIN_BAND_LABELS: Record<string, string> = {
  commercial: "Comercial",
  finance: "Financeiro",
  clients: "Clientes",
  engineering: "Engenharia",
  infrastructure: "Infra",
};

function emptyNote(
  input: HojeComposeInput,
  domains: readonly string[],
  noOccurrences: string,
): string {
  for (const domain of domains) {
    const missing = absenceNoteFor(input.operational_envelope, domain);
    if (missing !== null) return `${ownMapValue(DOMAIN_BAND_LABELS, domain) ?? "Domínio operacional"}: ${missing}`;
  }
  return noOccurrences;
}

/**
 * The detailed bands below are still fed by the legacy per-resource mapping.
 * When that mapping produces nothing, the honest thing to say is that this
 * band was not assembled — and to point at the panorama, which reads the
 * envelope and does know the domain's state.
 */
function bandNotAssembled(input: HojeComposeInput, domain: string, label: string): string {
  const missing = absenceNoteFor(input.operational_envelope, domain);
  if (missing !== null) return missing;
  return `Faltam dados nesta faixa: o recorte ${label} detalhado não foi montado. O estado do domínio está no panorama por domínio, acima.`;
}

/**
 * Consolidated per-domain read (issue #61). This is the only section that is
 * built straight from the operational envelope, because `presence`,
 * `absence_reason` and `healthy` live there and nowhere else in the payloads
 * the Hoje page reads.
 */
function composeDomains(input: HojeComposeInput): HojeSection {
  const summary = summarizeDomains(input.operational_envelope);
  assertNoHealthyOnUntrusted(summary);
  const base = section("domains", [], false, null);
  return { ...base, summary };
}

function composeTop3(input: HojeComposeInput): HojeSection {
  const priorities = selectHomepagePriorities(input.priorities);
  const rows = priorities.map((item) => {
    // `rationale` is the attention engine's `reason`: it carries the scoring
    // arithmetic. It belongs behind "Como foi priorizado", never in the body.
    const alert = priorityAlert(item, input.generated_at);
    return rowFrom(
      {
        id: item.id,
        title: item.title,
        summary: alert.description.length > 0 ? alert.description : alert.impact,
        kind: `rank-${item.rank}`,
        severity: alert.severity,
        alert,
      },
      item.provenance,
    );
  });
  const compressed = rows.length === 0;
  return section(
    "top3",
    rows,
    compressed,
    compressed
      ? "A leitura de prioridades chegou e não recomendou nenhuma ação. Não é trabalho a inventar."
      : null,
  );
}

function composeIncidents(input: HojeComposeInput): HojeSection {
  const items = selectHomepageAttention(input.incidents);
  const rows = items.map((item) => {
    const alert = attentionAlert(item, input.generated_at);
    return rowFrom(
      {
        id: item.id,
        title: item.title,
        summary: alert.description.length > 0 ? alert.description : alert.impact,
        kind: "incident",
        severity: item.severity,
        alert,
      },
      item.provenance,
    );
  });
  const compressed = rows.length === 0;
  return section(
    "incidents",
    rows,
    compressed,
    compressed
      ? "Sem ocorrências: a leitura de atenção chegou e não trouxe incidente, blocker ou risco aberto."
      : null,
  );
}

function clientNeedsAttention(client: ClientStatus): boolean {
  if (CLIENT_NEEDS.has(client.lifecycle)) return true;
  if (client.attention_item_ids && client.attention_item_ids.length > 0) return true;
  if (client.blockers && client.blockers.length > 0) return true;
  return isUntrusted(client.provenance.freshness_status);
}

function composeClients(input: HojeComposeInput): HojeSection {
  // A record without a usable identity is a data-quality exception, not a client
  // that needs attention. It must not raise a client alert on Hoje.
  const rows = input.clients.filter(isOperationalClient).filter(clientNeedsAttention).map((client) =>
    rowFrom(
      {
        id: client.id,
        title: client.display_name,
        summary: client.next_action ?? client.notes ?? client.lifecycle,
        kind: client.lifecycle,
        money: client.open_receivables,
      },
      client.provenance,
    ),
  );
  const compressed = rows.length === 0;
  return section(
    "clients",
    rows,
    compressed,
    compressed
      ? emptyNote(
          input,
          ["clients"],
          "Sem ocorrências: o recorte de clientes foi lido e nenhum cliente exige atenção.",
        )
      : null,
  );
}

function commercialInException(snap: CommercialSnapshot): boolean {
  return (
    (snap.at_risk_client_count ?? 0) > 0 ||
    (snap.inbound_unread_count ?? 0) > 0 ||
    (snap.missing_next_action_count ?? 0) > 0 ||
    (snap.stalled_count ?? 0) > 0 ||
    (snap.aging_count ?? 0) > 0 ||
    (snap.offer_version_drift?.count ?? 0) > 0 ||
    isUntrusted(snap.provenance.freshness_status)
  );
}

function composeCommercial(input: HojeComposeInput): HojeSection {
  const snap = input.commercial;
  if (!snap) {
    return section(
      "commercial",
      [],
      true,
      bandNotAssembled(input, "commercial", "comercial"),
    );
  }
  const funnel = snap.funnel
    ? `leads ${snap.funnel.new_leads ?? "ausente"} · qualificados ${snap.funnel.qualified ?? "ausente"} · oportunidades ${snap.funnel.opportunities ?? "ausente"}`
    : typeof snap.pipeline_open_count === "number"
      ? `pipeline ${snap.pipeline_open_count} aberto`
      : "funil ausente";
  if (!commercialInException(snap)) {
    return section(
      "commercial",
      [],
      true,
      `${funnel} — ${emptyNote(input, ["commercial"], "sem exceção comercial nesta coleta; a leitura chegou e veio limpa")}`,
    );
  }
  const rows: HojeRow[] = [];
  if ((snap.inbound_unread_count ?? 0) > 0) {
    rows.push(
      rowFrom(
        {
          id: `${snap.id}:inbound`,
          title: "Mensagens recebidas sem leitura",
          summary: `${snap.inbound_unread_count} item(ns) no inbound Warmbly (somente leitura)`,
          kind: "inbound",
        },
        snap.provenance,
      ),
    );
  }
  if ((snap.at_risk_client_count ?? 0) > 0) {
    rows.push(
      rowFrom(
        {
          id: `${snap.id}:at-risk`,
          title: "Clientes em risco no recorte comercial",
          // Declared by the commercial source. It is not identity-resolved and
          // is not the Clientes roll-up: saying so keeps it from reading as a
          // count of identified clients at risk.
          summary: `${snap.at_risk_client_count} cliente(s) at-risk declarados pelo comercial (identidade não resolvida; ver Clientes)`,
          kind: "at-risk",
        },
        snap.provenance,
      ),
    );
  }
  if ((snap.missing_next_action_count ?? 0) > 0) {
    rows.push(
      rowFrom(
        {
          id: `${snap.id}:missing-next`,
          title: "Sem próxima ação",
          summary: `${snap.missing_next_action_count} oportunidade(s) sem próxima ação`,
          kind: "missing-next-action",
        },
        snap.provenance,
      ),
    );
  }
  if ((snap.stalled_count ?? 0) > 0) {
    rows.push(
      rowFrom(
        {
          id: `${snap.id}:stalled`,
          title: "Estágio parado",
          summary: `${snap.stalled_count} estágio(s) parado(s)`,
          kind: "stalled-stage",
        },
        snap.provenance,
      ),
    );
  }
  if ((snap.offer_version_drift?.count ?? 0) > 0) {
    rows.push(
      rowFrom(
        {
          id: `${snap.id}:drift`,
          title: "Divergência de oferta/versão",
          summary: snap.offer_version_drift?.detail ?? `${snap.offer_version_drift?.count} desvio(s)`,
          kind: "offer-version-drift",
        },
        snap.provenance,
      ),
    );
  }
  if (rows.length === 0) {
    rows.push(
      rowFrom(
        {
          id: snap.id,
          title: "Recorte comercial em exceção",
          summary: funnel,
          kind: "snapshot",
        },
        snap.provenance,
      ),
    );
  }
  return section("commercial", rows, false, null);
}

function financeInException(snap: FinanceSnapshot): boolean {
  const overdue = snap.overdue ?? snap.receivables_overdue;
  return (
    (overdue?.amount_cents ?? 0) > 0 ||
    (snap.chargebacks?.amount_cents ?? 0) > 0 ||
    isUntrusted(snap.provenance.freshness_status)
  );
}

function composeFinance(input: HojeComposeInput): HojeSection {
  const snap = input.finance;
  if (!snap) {
    return section(
      "finance",
      [],
      true,
      bandNotAssembled(input, "finance", "financeiro"),
    );
  }
  const overdue = snap.overdue ?? snap.receivables_overdue;
  const receivable = snap.receivable ?? snap.receivables_open;
  const kpi = `a receber ${receivable ? `${receivable.currency} ${receivable.amount_cents}¢` : "ausente"} · vencido ${overdue ? `${overdue.amount_cents}¢` : "ausente"}`;
  if (!financeInException(snap)) {
    return section(
      "finance",
      [],
      true,
      `${kpi} — ${emptyNote(input, ["finance"], "sem exceção financeira nesta coleta; a leitura chegou e veio limpa")} (somente leitura; sem cobrança neste cockpit)`,
    );
  }
  const rows: HojeRow[] = [];
  if (overdue && overdue.amount_cents > 0) {
    rows.push(
      rowFrom(
        {
          id: `${snap.id}:overdue`,
          title: "Financeiro em exceção — vencido",
          summary: "Somente leitura. Cobrança, checkout, refund e mutação Asaas são proibidos neste cockpit.",
          kind: "overdue",
          money: overdue,
        },
        snap.provenance,
      ),
    );
  }
  if ((snap.chargebacks?.amount_cents ?? 0) > 0 && snap.chargebacks) {
    rows.push(
      rowFrom(
        {
          id: `${snap.id}:chargebacks`,
          title: "Contestações de pagamento",
          summary: "Contestações de pagamento observadas no recorte somente leitura.",
          kind: "chargebacks",
          money: snap.chargebacks,
        },
        snap.provenance,
      ),
    );
  }
  if (rows.length === 0) {
    rows.push(
      rowFrom(
        {
          id: snap.id,
          title: "Recorte financeiro defasado",
          summary: kpi,
          kind: "snapshot",
          money: receivable,
        },
        snap.provenance,
      ),
    );
  }
  return section("finance", rows, false, null);
}

function engineeringInException(snap: EngineeringSnapshot): boolean {
  return (
    snap.failing_check_count > 0 ||
    snap.open_incident_count > 0 ||
    (snap.p0_count ?? 0) > 0 ||
    (snap.p1_count ?? 0) > 0 ||
    (snap.blockers?.length ?? 0) > 0 ||
    isUntrusted(snap.provenance.freshness_status)
  );
}

function infraInException(svc: ServiceHealth): boolean {
  return svc.status !== "healthy" || svc.partial_outage === true || isUntrusted(svc.provenance.freshness_status);
}

function composeEngineering(input: HojeComposeInput): HojeSection {
  const snap = input.engineering;
  const infra = input.infra;
  const rows: HojeRow[] = [];
  if (snap && engineeringInException(snap)) {
    if (snap.failing_check_count > 0) {
      rows.push(
        rowFrom(
          {
            id: `${snap.id}:checks`,
            title: "CI falhando",
            summary: `${snap.failing_check_count} check(s) falhando`,
            kind: "failing-check",
            severity: "high",
          },
          snap.provenance,
        ),
      );
    }
    if ((snap.p0_count ?? 0) > 0 || (snap.p1_count ?? 0) > 0) {
      rows.push(
        rowFrom(
          {
            id: `${snap.id}:p0p1`,
            title: "P0/P1 abertos",
            summary: `P0 ${snap.p0_count ?? 0} · P1 ${snap.p1_count ?? 0}`,
            kind: "p0-p1",
            severity: (snap.p0_count ?? 0) > 0 ? "critical" : "high",
          },
          snap.provenance,
        ),
      );
    }
    if (snap.open_incident_count > 0) {
      rows.push(
        rowFrom(
          {
            id: `${snap.id}:incidents`,
            title: "Incidentes de engenharia abertos",
            summary: `${snap.open_incident_count} incidente(s) aberto(s)`,
            kind: "eng-incident",
            severity: "critical",
          },
          snap.provenance,
        ),
      );
    }
    if (snap.active_work_without_evidence) {
      rows.push(
        rowFrom(
          {
            id: `${snap.id}:hypothesis`,
            title: "Trabalho ativo sem evidência",
            summary: snap.active_work_without_evidence.detail ?? "Permanece hipótese até haver evidência.",
            kind: "hypothesis",
          },
          snap.provenance,
        ),
      );
    }
    if (rows.length === 0) {
      rows.push(
        rowFrom(
          {
            id: snap.id,
            title: "Recorte de engenharia em exceção",
            summary: `PRs ${snap.open_pr_count} · CI falhando ${snap.failing_check_count} · incidentes ${snap.open_incident_count}`,
            kind: "snapshot",
          },
          snap.provenance,
        ),
      );
    }
  }
  for (const svc of infra) {
    if (!infraInException(svc)) continue;
    rows.push(
      rowFrom(
        {
          id: svc.id,
          title: svc.service_name,
          summary:
            svc.message ??
            `estado ${healthLabel(svc.status)}${svc.partial_outage ? " · indisponibilidade parcial" : ""}`,
          kind: "infra",
          health: svc.status,
        },
        svc.provenance,
      ),
    );
  }
  const compressed = rows.length === 0;
  if (!compressed) return section("engineering", rows, false, null);
  const parts: string[] = [];
  if (snap && !engineeringInException(snap)) {
    parts.push(`${snap.open_pr_count} pull request(s) · integração contínua ok · 0 incidente(s)`);
  }
  if (infra.length > 0 && infra.every((s) => !infraInException(s))) {
    parts.push("infra saudável");
  }
  if (!snap && infra.length === 0) parts.push("Sem recorte de engenharia/infra");
  const engineeringNote = emptyNote(
    input,
    ["engineering", "infrastructure"],
    "sem exceção de engenharia/infra nesta coleta; as leituras chegaram e vieram limpas",
  );
  return section(
    "engineering",
    [],
    true,
    `${parts.join(" · ") || "Sem recorte de engenharia/infra"} — ${engineeringNote}`,
  );
}

function agentNeedsAttention(item: AgentActivity): boolean {
  if (AGENT_NEEDS.has(item.presentation_status)) return true;
  if (item.blockers && item.blockers.length > 0) return true;
  if (item.residual_work && item.residual_work.length > 0) return true;
  if (isUntrusted(item.provenance.freshness_status)) return true;
  return false;
}

function composeAgents(input: HojeComposeInput): HojeSection {
  const items = input.activities.slice();
  if (items.length === 0) {
    return section(
      "agents",
      [],
      true,
      "A leitura de atividades chegou e veio vazia: nenhuma sessão de agente observada. Não é trabalho a inventar.",
    );
  }
  const actionable = items.filter(agentNeedsAttention);
  if (actionable.length === 0) {
    return section(
      "agents",
      [],
      true,
      `${items.length} sessão(ões) concluída(s) sem trabalho residual — leitura presente, nenhuma pendência.`,
    );
  }
  const rows = actionable.map((item) =>
    rowFrom(
      {
        id: item.id,
        title: `${item.agent_id}${item.provider ? ` · ${item.provider}` : ""} · ${agentStatusLabel(item.presentation_status)}`,
        summary: item.summary,
        kind: item.presentation_status,
      },
      item.provenance,
    ),
  );
  return section("agents", rows, false, null);
}

function composeShortcuts(): HojeSection {
  const shortcuts: HojeShortcut[] = WRITE_SHORTCUT_KINDS.map((kind) => ({
    kind,
    label: ownMapValue(WRITE_SHORTCUT_LABELS, kind) ?? "Atalho operacional",
    hint: "Grava no serviço de contexto do Control Center. Não altera Warmbly, Asaas nem GitHub.",
  }));
  return {
    id: "shortcuts",
    title: HOJE_SECTION_TITLES[HOJE_SECTION_IDS.indexOf("shortcuts")]!,
    compressed: false,
    compressed_summary: null,
    rows: [],
    shortcuts,
  };
}

export function composeHoje(input: HojeComposeInput): HojeViewModel {
  const sections = [
    composeDomains(input),
    composeTop3(input),
    composeIncidents(input),
    composeClients(input),
    composeCommercial(input),
    composeFinance(input),
    composeEngineering(input),
    composeAgents(input),
    composeShortcuts(),
  ];
  if (sections.length !== HOJE_SECTION_TITLES.length) {
    throw new Error("compose produced the wrong number of sections");
  }
  for (let i = 0; i < HOJE_SECTION_TITLES.length; i += 1) {
    if (sections[i]?.title !== HOJE_SECTION_TITLES[i] || sections[i]?.id !== HOJE_SECTION_IDS[i]) {
      throw new Error("compose produced sections out of order");
    }
  }
  const top3 = sections.find((candidate) => candidate.id === "top3");
  if (top3 && top3.rows.length > 3) {
    throw new Error("Top 3 exceeded homepage cap");
  }
  return {
    schema_version: "control-center.hoje-view.v1",
    generated_at: input.generated_at,
    headline: input.headline,
    sections,
    charts_emitted: false,
  };
}

export function hojeHasUntrustedGreen(view: HojeViewModel): boolean {
  return view.sections.some((section) =>
    section.rows.some(
      (row) => row.freshness_status !== "FRESH" && row.freshness_tone === "green",
    ),
  );
}

export function assertNoGreenForUntrusted(view: HojeViewModel): void {
  for (const section of view.sections) {
    for (const row of section.rows) {
      if (row.freshness_status !== "FRESH" && row.freshness_tone === "green") {
        throw new Error(`untrusted ${row.freshness_status} rendered green on ${row.id}`);
      }
      if (freshnessTone(row.freshness_status) === "green" && row.freshness_status !== "FRESH") {
        throw new Error(`tone map leaked green for ${row.freshness_status}`);
      }
    }
  }
}
