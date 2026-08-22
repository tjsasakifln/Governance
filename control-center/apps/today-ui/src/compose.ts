import { formatLocal } from "./datetime.js";
import { combinedTone, coerceFreshness, freshnessTone } from "./freshness.js";
import { SHORTCUT_DECISION_LABEL, SHORTCUT_NOTA_LABEL } from "./registrar.js";
import {
  HOMEPAGE_PRIORITY_LIMIT,
  type FreshnessStatus,
  type HealthStatus,
} from "./taxonomy.js";
import {
  BAND_IDS,
  BAND_LABELS,
  type AgentTimelineItem,
  type AttentionItem,
  type BandId,
  type BandLabel,
  type BandView,
  type ClientStatus,
  type CommercialSnapshot,
  type EngineeringSnapshot,
  type FinanceSnapshot,
  type FounderOverride,
  type HojePayload,
  type HojeRow,
  type HojeView,
  type Provenance,
  type ServiceHealth,
  type SourceRef,
} from "./types.js";
import { validatePayload } from "./validate.js";

export { HOMEPAGE_PRIORITY_LIMIT } from "./taxonomy.js";
export { BAND_IDS, BAND_LABELS } from "./types.js";

const OPEN_ATTENTION = new Set(["open", "acknowledged"]);
const CLIENT_NEEDS_ATTENTION = new Set(["churn_risk", "paused", "churned"]);
const AGENT_NEEDS_FOUNDER = new Set(["BLOCKED", "FAILED", "PARTIAL", "RUNNING", "UNKNOWN"]);

function rowFromProvenance(
  base: {
    id: string;
    title: string;
    summary: string;
    kind?: string;
    severity?: HojeRow["severity"];
    money?: HojeRow["money"];
    health?: HealthStatus;
  },
  provenance: Provenance,
  override: FounderOverride | null,
): HojeRow {
  const freshness_status = coerceFreshness(provenance.freshness_status);
  const founder = overrideFlag(base.id, override);
  const row: HojeRow = {
    id: base.id,
    title: base.title,
    summary: base.summary,
    source: provenance.source,
    observed_at: provenance.observed_at,
    observed_at_local: formatLocal(provenance.observed_at),
    freshness_status,
    freshness_tone: combinedTone(freshness_status, base.health),
    founder_override_visible: founder.visible,
  };
  if (provenance.confidence !== undefined) {
    row.confidence = provenance.confidence;
  }
  if (founder.action) {
    row.founder_override_action = founder.action;
  }
  if (base.money) {
    row.money = base.money;
  }
  if (base.severity) {
    row.severity = base.severity;
  }
  if (base.kind) {
    row.kind = base.kind;
  }
  return row;
}

function overrideFlag(
  id: string,
  override: FounderOverride | null,
): { visible: boolean; action?: FounderOverride["action"] } {
  if (!override) return { visible: false };
  if (!override.target_ids.includes(id)) return { visible: false };
  return { visible: true, action: override.action };
}

function provenanceOf(source: SourceRef, observed_at: string, freshness_status: FreshnessStatus, confidence?: number): Provenance {
  const p: Provenance = { source, observed_at, freshness_status };
  if (confidence !== undefined) p.confidence = confidence;
  return p;
}

function isUntrusted(status: FreshnessStatus): boolean {
  return status !== "FRESH";
}

function anyUntrusted(rows: HojeRow[]): boolean {
  return rows.some((row) => isUntrusted(row.freshness_status) || row.freshness_tone !== "green");
}

function band(
  id: BandId,
  label: BandLabel,
  rows: HojeRow[],
  compressed: boolean,
  compressed_summary: string | null,
  shortcuts: BandView["shortcuts"] = [],
): BandView {
  return { id, label, compressed, compressed_summary, rows, shortcuts };
}

function composeTop3(payload: HojePayload): BandView {
  const actions = payload.recommended_actions
    .slice()
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
    .slice(0, HOMEPAGE_PRIORITY_LIMIT);
  const rows = actions.map((action) =>
    rowFromProvenance(
      {
        id: action.id,
        title: action.title,
        summary: action.rationale,
        kind: `rank-${action.rank}`,
      },
      action.provenance,
      payload.founder_override,
    ),
  );
  const compressed = rows.length === 0;
  return band(
    "top3",
    BAND_LABELS[0],
    rows,
    compressed,
    compressed ? "Nenhuma ação recomendada — não inventar trabalho" : null,
  );
}

function composeIncidents(payload: HojePayload): BandView {
  const items = payload.incidents
    .filter((item) => item.homepage_eligible && OPEN_ATTENTION.has(item.status))
    .slice()
    .sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      const sev = order[a.severity] - order[b.severity];
      if (sev !== 0) return sev;
      return a.id.localeCompare(b.id);
    });
  const rows = items.map((item) =>
    rowFromProvenance(
      {
        id: item.id,
        title: item.title,
        summary: item.summary,
        kind: item.incident_kind ?? "incident",
        severity: item.severity,
      },
      item.provenance,
      payload.founder_override,
    ),
  );
  const compressed = rows.length === 0;
  return band(
    "incidents",
    BAND_LABELS[1],
    rows,
    compressed,
    compressed ? "Nenhum incidente, blocker ou risco aberto — ignorar" : null,
  );
}

function clientNeedsAttention(client: ClientStatus): boolean {
  if (CLIENT_NEEDS_ATTENTION.has(client.lifecycle)) return true;
  if (client.attention_item_ids && client.attention_item_ids.length > 0) return true;
  return isUntrusted(client.provenance.freshness_status);
}

/**
 * Minimum client identity, mirrored from the contracts rule.
 *
 * today-ui deliberately does not import the sibling workstream, so the reserved
 * token list is duplicated and pinned by a drift test in
 * tests/convergence/domain-gates.test.ts. A record without an identity is a
 * data-quality exception; it must not be composed as a client that needs
 * attention on any surface.
 */
const RESERVED_CLIENT_SLUGS = new Set([
  "anonimo", "anonymous", "client", "cliente", "default", "desconhecido", "na", "n-a",
  "nao-identificado", "nao-informado", "no-name", "none", "null", "placeholder",
  "sem-identidade", "sem-nome", "tbd", "undefined", "unidentified", "unknown",
]);

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function isIdentifiedClient(client: ClientStatus): boolean {
  const slug = client.client_slug;
  if (typeof slug !== "string" || slug.length < 2 || RESERVED_CLIENT_SLUGS.has(slug)) return false;
  if (client.scope !== `client:${slug}`) return false;
  const name = client.display_name;
  return typeof name === "string" && name.trim().length >= 2 && !RESERVED_CLIENT_SLUGS.has(normalizeSlug(name));
}

function composeClients(payload: HojePayload): BandView {
  const clients = payload.clients.filter(isIdentifiedClient).filter(clientNeedsAttention);
  const rows = clients.map((client) => {
    const money = client.open_receivables;
    const notes = client.notes ?? client.lifecycle;
    return rowFromProvenance(
      {
        id: client.id,
        title: client.display_name,
        summary: notes,
        kind: client.lifecycle,
        money,
      },
      client.provenance,
      payload.founder_override,
    );
  });
  const compressed = rows.length === 0;
  return band(
    "clients",
    BAND_LABELS[2],
    rows,
    compressed,
    compressed ? "Nenhum cliente exige atenção — ignorar" : null,
  );
}

function commercialInException(snap: CommercialSnapshot): boolean {
  return (
    snap.at_risk_client_count > 0 ||
    snap.inbound_unread_count > 0 ||
    isUntrusted(snap.provenance.freshness_status)
  );
}

function composeCommercial(payload: HojePayload): BandView {
  const snap = payload.commercial;
  if (!snap) {
    return band("commercial", BAND_LABELS[3], [], true, "Sem recorte comercial — ignorar");
  }
  const kpi = `Pipeline ${snap.pipeline_open_count} aberto · inbound ${snap.inbound_unread_count} · em risco ${snap.at_risk_client_count}`;
  if (!commercialInException(snap)) {
    return band("commercial", BAND_LABELS[3], [], true, `${kpi} — ignorar`);
  }
  const rows: HojeRow[] = [];
  if (snap.inbound_unread_count > 0 || isUntrusted(snap.provenance.freshness_status)) {
    rows.push(
      rowFromProvenance(
        {
          id: `${snap.id}:inbound`,
          title: "Inbound sem leitura",
          summary: `${snap.inbound_unread_count} item(ns) no inbound Warmbly (somente leitura)`,
          kind: "inbound",
        },
        snap.provenance,
        payload.founder_override,
      ),
    );
  }
  if (snap.at_risk_client_count > 0) {
    rows.push(
      rowFromProvenance(
        {
          id: `${snap.id}:at-risk`,
          title: "Clientes em risco no recorte comercial",
          summary: `${snap.at_risk_client_count} cliente(s) at-risk (autoridade operacional: Warmbly)`,
          kind: "at-risk",
        },
        snap.provenance,
        payload.founder_override,
      ),
    );
  }
  if (rows.length === 0) {
    rows.push(
      rowFromProvenance(
        {
          id: snap.id,
          title: "Recorte comercial defasado",
          summary: kpi,
          kind: "snapshot",
        },
        snap.provenance,
        payload.founder_override,
      ),
    );
  }
  return band("commercial", BAND_LABELS[3], rows, false, null);
}

function financeInException(snap: FinanceSnapshot): boolean {
  return snap.receivables_overdue.amount_cents > 0 || isUntrusted(snap.provenance.freshness_status);
}

function composeFinance(payload: HojePayload): BandView {
  const snap = payload.finance;
  if (!snap) {
    return band("finance", BAND_LABELS[4], [], true, "Sem recorte financeiro — ignorar");
  }
  const kpi = `Aberto ${snap.receivables_open.currency} ${snap.receivables_open.amount_cents}¢ · vencido ${snap.receivables_overdue.amount_cents}¢`;
  if (!financeInException(snap)) {
    return band("finance", BAND_LABELS[4], [], true, `${kpi} — ignorar (somente leitura; sem cobrança neste cockpit)`);
  }
  const rows: HojeRow[] = [];
  if (snap.receivables_overdue.amount_cents > 0) {
    rows.push(
      rowFromProvenance(
        {
          id: `${snap.id}:overdue`,
          title: "Recebíveis vencidos",
          summary: "Somente leitura. Cobrança, checkout, refund e mutação Asaas são proibidos neste cockpit.",
          kind: "overdue",
          money: snap.receivables_overdue,
        },
        snap.provenance,
        payload.founder_override,
      ),
    );
  } else {
    rows.push(
      rowFromProvenance(
        {
          id: snap.id,
          title: "Recorte financeiro defasado",
          summary: kpi,
          kind: "snapshot",
          money: snap.receivables_open,
        },
        snap.provenance,
        payload.founder_override,
      ),
    );
  }
  return band("finance", BAND_LABELS[4], rows, false, null);
}

function engineeringInException(snap: EngineeringSnapshot): boolean {
  return (
    snap.failing_check_count > 0 ||
    snap.open_incident_count > 0 ||
    isUntrusted(snap.provenance.freshness_status)
  );
}

function infraInException(svc: ServiceHealth): boolean {
  return svc.status !== "healthy" || isUntrusted(svc.provenance.freshness_status);
}

function composeEngineering(payload: HojePayload): BandView {
  const snap = payload.engineering;
  const infra = payload.infra;
  const rows: HojeRow[] = [];
  if (snap && engineeringInException(snap)) {
    if (snap.failing_check_count > 0) {
      rows.push(
        rowFromProvenance(
          {
            id: `${snap.id}:checks`,
            title: "Checks falhando",
            summary: `${snap.failing_check_count} check(s) falhando`,
            kind: "failing-check",
            severity: snap.failing_check_count > 0 ? "high" : "low",
          },
          snap.provenance,
          payload.founder_override,
        ),
      );
    }
    if (snap.open_incident_count > 0) {
      rows.push(
        rowFromProvenance(
          {
            id: `${snap.id}:incidents`,
            title: "Incidentes de engenharia abertos",
            summary: `${snap.open_incident_count} incidente(s) aberto(s)`,
            kind: "eng-incident",
            severity: "critical",
          },
          snap.provenance,
          payload.founder_override,
        ),
      );
    }
    if (rows.length === 0) {
      rows.push(
        rowFromProvenance(
          {
            id: snap.id,
            title: "Recorte de engenharia defasado",
            summary: `PRs ${snap.open_pr_count} · checks falhando ${snap.failing_check_count} · incidentes ${snap.open_incident_count}`,
            kind: "snapshot",
          },
          snap.provenance,
          payload.founder_override,
        ),
      );
    }
  }
  for (const svc of infra) {
    if (!infraInException(svc)) continue;
    rows.push(
      rowFromProvenance(
        {
          id: svc.id,
          title: svc.service_name,
          summary: svc.message ?? `status ${svc.status}`,
          kind: "infra",
          health: svc.status,
        },
        svc.provenance,
        payload.founder_override,
      ),
    );
  }
  const healthyKpi =
    snap && !engineeringInException(snap)
      ? `PRs ${snap.open_pr_count} · checks falhando 0 · incidentes 0`
      : null;
  const infraHealthy = infra.length > 0 && infra.every((s) => !infraInException(s));
  const compressed = rows.length === 0;
  let summary: string | null = null;
  if (compressed) {
    const parts: string[] = [];
    if (healthyKpi) parts.push(healthyKpi);
    if (infraHealthy) parts.push("infra saudável");
    if (!snap && infra.length === 0) parts.push("Sem recorte de engenharia/infra");
    summary = `${parts.join(" · ") || "Sem recorte de engenharia/infra"} — ignorar`;
  }
  return band("engineering", BAND_LABELS[5], rows, compressed, summary);
}

function agentNeedsAttention(item: AgentTimelineItem): boolean {
  if (AGENT_NEEDS_FOUNDER.has(item.status)) return true;
  if (item.blockers.length > 0) return true;
  if (isUntrusted(item.freshness_status)) return true;
  return false;
}

function composeAgents(payload: HojePayload): BandView {
  const items = payload.agent_activity.slice().sort((a, b) => a.correlation_id.localeCompare(b.correlation_id));
  if (items.length === 0) {
    return band(
      "agents",
      BAND_LABELS[6],
      [],
      true,
      "Zero atividade de agentes — não inventar trabalho",
    );
  }
  const actionable = items.filter(agentNeedsAttention);
  const show = actionable.length > 0 ? actionable : [];
  const allDoneIgnorable = actionable.length === 0;
  const rows = (allDoneIgnorable ? items : show).map((item) =>
    rowFromProvenance(
      {
        id: item.correlation_id,
        title: `${item.agent.id} · ${item.status}`,
        summary: item.summary,
        kind: item.status,
      },
      provenanceOf(item.source, item.observed_at, item.freshness_status, item.confidence),
      payload.founder_override,
    ),
  );
  if (allDoneIgnorable) {
    return band(
      "agents",
      BAND_LABELS[6],
      [],
      true,
      `${items.length} sessão(ões) concluída(s) sem leftover — ignorar`,
    );
  }
  return band("agents", BAND_LABELS[6], rows, false, null);
}

function composeShortcuts(): BandView {
  return {
    id: "shortcuts",
    label: BAND_LABELS[7],
    compressed: false,
    compressed_summary: null,
    rows: [],
    shortcuts: [
      {
        kind: "decision",
        label: SHORTCUT_DECISION_LABEL,
        hint: "Intenção local. Não grava diretiva persistida nem muta Warmbly/Asaas/GitHub nesta onda.",
      },
      {
        kind: "nota",
        label: SHORTCUT_NOTA_LABEL,
        hint: "Nota local. Sem POST externo nesta onda.",
      },
    ],
  };
}

/**
 * Pure compose: payload in → ordered HOJE view model out.
 * Does not fetch, does not mutate providers, does not emit charts.
 */
export function composeHoje(input: HojePayload): HojeView {
  const payload = validatePayload(input);
  const bands: BandView[] = [
    composeTop3(payload),
    composeIncidents(payload),
    composeClients(payload),
    composeCommercial(payload),
    composeFinance(payload),
    composeEngineering(payload),
    composeAgents(payload),
    composeShortcuts(),
  ];
  if (bands.length !== BAND_LABELS.length) {
    throw new Error("compose produced the wrong number of bands");
  }
  for (let i = 0; i < BAND_LABELS.length; i += 1) {
    if (bands[i]?.label !== BAND_LABELS[i] || bands[i]?.id !== BAND_IDS[i]) {
      throw new Error("compose produced bands out of order");
    }
  }
  const top3 = bands[0];
  if (top3 && top3.rows.length > HOMEPAGE_PRIORITY_LIMIT) {
    throw new Error("Top 3 exceeded homepage cap");
  }
  return {
    schema_version: "control-center.hoje-view.v1",
    fixture_name: payload.fixture_name,
    generated_at: payload.generated_at,
    headline: payload.headline,
    bands,
    charts_emitted: false,
  };
}

export function bandById(view: HojeView, id: BandId): BandView {
  const found = view.bands.find((b) => b.id === id);
  if (!found) throw new Error(`missing band ${id}`);
  return found;
}

export function allRows(view: HojeView): HojeRow[] {
  return view.bands.flatMap((b) => b.rows);
}

export function assertNoGreenForUntrusted(view: HojeView): void {
  for (const row of allRows(view)) {
    if (row.freshness_status !== "FRESH" && row.freshness_tone === "green") {
      throw new Error(`untrusted ${row.freshness_status} rendered green on ${row.id}`);
    }
    if (freshnessTone(row.freshness_status) === "green" && row.freshness_status !== "FRESH") {
      throw new Error(`tone map leaked green for ${row.freshness_status}`);
    }
  }
}

export function viewHasUntrustedGreen(view: HojeView): boolean {
  return allRows(view).some(
    (row) => row.freshness_status !== "FRESH" && row.freshness_tone === "green",
  );
}

/** Domain exception bands: commercial, finance, engineering. */
export const DOMAIN_EXCEPTION_BANDS: BandId[] = ["commercial", "finance", "engineering"];

export const EXCEPTION_KPI_BANDS: BandId[] = [
  "incidents",
  "clients",
  "commercial",
  "finance",
  "engineering",
];

export { anyUntrusted };
