/**
 * Consolidated per-domain read for the Hoje cockpit (issue #61).
 *
 * The only input is the raw `GET /v1/operational-snapshots` body, i.e. an
 * `control-center.operational-envelope.v1` document. Every state on a card is
 * derived from the envelope slots the contract already guarantees —
 * `presence`, `absence_reason`, `healthy`, `freshness_status`, `confidence`,
 * `observed_at` — so a card can never claim "saudável" for a slot the schema
 * has already forced to `healthy:false`.
 *
 * Absence is never rendered as zero. `presence:"absent"` produces an explicit
 * "faltam dados" card carrying the contract's `absence_reason`; an empty but
 * present slot produces "sem ocorrências". These are different sentences on
 * purpose.
 *
 * The pt-BR state vocabulary and the five-state renderer are being centralised
 * by issues #63 and #62. Until those land, the maps here are deliberately
 * local, small, and confined to this module.
 */
import { formatLocal } from "./datetime";
import { formatMoney } from "./money";
import { sourceKindLabel, sourceSystemLabel } from "./provenance";
import { ownMapValue } from "./own-map";
import {
  projectFounderOperatingTruth,
  type FounderOperatingTruth,
} from "./founder-operating-truth";
import type { FreshnessStatus, Money, SourceRef } from "./types";

export const DOMAIN_CARD_IDS = [
  "comercial",
  "clientes",
  "financeiro",
  "engenharia",
  "infra",
  "warmbly",
] as const;
export type DomainCardId = (typeof DOMAIN_CARD_IDS)[number];

/** Five states the operator must be able to tell apart. */
export const DOMAIN_STATES = [
  "saudavel",
  "atencao",
  "critico",
  "desconhecido",
  "erro_coleta",
] as const;
export type DomainState = (typeof DOMAIN_STATES)[number];

export const ABSENCE_REASONS = ["no_data", "not_configured", "upstream_error"] as const;
export type AbsenceReason = (typeof ABSENCE_REASONS)[number];

const STATE_LABELS: Record<DomainState, string> = {
  saudavel: "saudável",
  atencao: "atenção",
  critico: "crítico",
  desconhecido: "desconhecido",
  erro_coleta: "erro de coleta",
};

const STATE_TONES: Record<DomainState, "green" | "amber" | "red" | "slate"> = {
  saudavel: "green",
  atencao: "amber",
  critico: "red",
  desconhecido: "slate",
  erro_coleta: "red",
};

const ABSENCE_SENTENCES: Record<AbsenceReason, string> = {
  no_data: "Faltam dados: a coleta rodou e não trouxe nenhum registro deste domínio.",
  not_configured: "Faltam dados: a integração deste domínio não está configurada.",
  upstream_error: "Erro de coleta: a origem respondeu com erro e nada foi lido.",
};

export interface DomainPending {
  label: string;
  count: number;
}

export interface HojeDomainCard {
  id: DomainCardId;
  label: string;
  state: DomainState;
  state_label: string;
  /** Never "ignorar": says whether there are no occurrences or data is missing. */
  state_reason: string;
  indicator: string;
  pending: DomainPending[];
  action_count: number;
  observed_at: string | null;
  observed_at_local: string;
  freshness_status: FreshnessStatus;
  confidence: number | null;
  source: SourceRef | null;
  href: string;
  href_label: string;
  presence: "present" | "absent";
  absence_reason: AbsenceReason | null;
  /** Canonical #62 evidential state, carried without reinterpretation. */
  truth?: unknown;
}

export interface HojeIntegration {
  system: string;
  system_label: string;
  source_kind: string;
  source_locator: string;
  state: DomainState;
  state_label: string;
  detail: string;
  observed_at_local: string;
  freshness_status: FreshnessStatus;
  error_code: string | null;
  error_message: string | null;
}

export interface HojeOutbound {
  state: "ACTIVE" | "PAUSED" | "UNKNOWN";
  label: string;
  observed: boolean;
  detail: string;
  href: string;
}

export interface HojeUnmappedAlerts {
  domain: string;
  count: number;
  href: string;
}

export interface HojeDomainSummary {
  envelope_present: boolean;
  generated_at: string | null;
  cards: HojeDomainCard[];
  integrations: HojeIntegration[];
  outbound: HojeOutbound;
  founder_truth: FounderOperatingTruth;
  unmapped: HojeUnmappedAlerts[];
  /** Null when the envelope is absent: lack of a reading is not a measured zero. */
  action_total: number | null;
  /** What the aggregate means and how it was computed. */
  action_total_note: string;
}

export function domainStateLabel(state: DomainState): string {
  return ownMapValue(STATE_LABELS, state) ?? "estado não reconhecido";
}

export function domainStateTone(state: DomainState): "green" | "amber" | "red" | "slate" {
  return ownMapValue(STATE_TONES, state) ?? "slate";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function intOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function strOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function freshnessOf(value: unknown): FreshnessStatus {
  return value === "FRESH" || value === "STALE" || value === "ERROR" ? value : "UNKNOWN";
}

function absenceOf(value: unknown): AbsenceReason | null {
  return value === "no_data" || value === "not_configured" || value === "upstream_error"
    ? value
    : null;
}

function sourceOf(value: unknown): SourceRef | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const system = strOf(rec.system);
  const kind = strOf(rec.kind);
  const locator = strOf(rec.locator);
  if (!system || !kind || !locator) return null;
  return { system, kind, locator };
}

function moneyOf(value: unknown): Money | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const cents = rec.amount_cents;
  const currency = rec.currency;
  if (typeof cents !== "number" || !Number.isInteger(cents)) return null;
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) return null;
  return { amount_cents: cents, currency };
}

/**
 * Money with an unreadable amount or an unreadable currency is reported as
 * missing, never as 0,00.
 */
function moneyText(value: unknown): string | null {
  const money = moneyOf(value);
  return money ? formatMoney(money) : null;
}

interface DomainSlot {
  presence: "present" | "absent";
  absence_reason: AbsenceReason | null;
  healthy: boolean;
  freshness_status: FreshnessStatus;
  confidence: number | null;
  observed_at: string | null;
  source: SourceRef | null;
  snapshot: Record<string, unknown> | null;
  truth?: unknown;
}

function slotOf(value: unknown): DomainSlot | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const presence = rec.presence === "absent" ? "absent" : "present";
  const confidence = typeof rec.confidence === "number" ? rec.confidence : null;
  return {
    presence,
    absence_reason: absenceOf(rec.absence_reason),
    healthy: rec.healthy === true,
    freshness_status: freshnessOf(rec.freshness_status),
    confidence,
    observed_at: strOf(rec.observed_at),
    source: sourceOf(rec.source),
    snapshot: asRecord(rec.snapshot),
    ...(rec.truth === undefined ? {} : { truth: rec.truth }),
  };
}

interface AlertCount {
  open: number;
  critical: number;
}

const ACTIONABLE_ALERT_STATUSES = new Set(["open", "acknowledged"]);

/**
 * `acknowledged` still counts. Reconhecer no Control Center não remove o item
 * do ranking nem da fila, então também não pode zerar a contagem aqui.
 */
function alertsByDomain(envelope: Record<string, unknown>): Map<string, AlertCount> {
  const byDomain = new Map<string, AlertCount>();
  const seen = new Set<string>();
  for (const bucket of [envelope.attention_now, envelope.today]) {
    for (const raw of asArray(bucket)) {
      const row = asRecord(raw);
      if (!row) continue;
      const id = strOf(row.id);
      if (id !== null) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      const status = strOf(row.status) ?? "open";
      if (!ACTIONABLE_ALERT_STATUSES.has(status)) continue;
      const domain = strOf(row.domain) ?? "desconhecido";
      const entry = byDomain.get(domain) ?? { open: 0, critical: 0 };
      entry.open += 1;
      if (row.severity === "critical") entry.critical += 1;
      byDomain.set(domain, entry);
    }
  }
  return byDomain;
}

interface CardSeed {
  id: DomainCardId;
  label: string;
  envelopeDomain: string | null;
  href: string;
  href_label: string;
}

const CARD_SEEDS: readonly CardSeed[] = [
  { id: "comercial", label: "Comercial", envelopeDomain: "commercial", href: "#/comercial", href_label: "Abrir Comercial" },
  { id: "clientes", label: "Clientes", envelopeDomain: "clients", href: "#/clientes", href_label: "Abrir Clientes" },
  { id: "financeiro", label: "Financeiro", envelopeDomain: "finance", href: "#/financeiro", href_label: "Abrir Financeiro" },
  { id: "engenharia", label: "Engenharia", envelopeDomain: "engineering", href: "#/engenharia", href_label: "Abrir Engenharia" },
  { id: "infra", label: "Infra", envelopeDomain: "infrastructure", href: "#/infra", href_label: "Abrir Infra" },
  {
    id: "warmbly",
    label: "Warmbly / disparo de saída",
    envelopeDomain: null,
    href: "#/warmbly",
    href_label: "Abrir controles do disparo",
  },
];

const DOMAIN_TO_CARD = new Map<string, DomainCardId>([
  ["commercial", "comercial"],
  ["clients", "clientes"],
  ["finance", "financeiro"],
  ["engineering", "engenharia"],
  ["infrastructure", "infra"],
]);

const UNMAPPED_HREFS: Record<string, string> = {
  pncp: "#/crescimento",
};

function pendingFromCounts(
  snapshot: Record<string, unknown> | null,
  keys: readonly (readonly [string, string])[],
): DomainPending[] {
  if (!snapshot) return [];
  const out: DomainPending[] = [];
  for (const [key, label] of keys) {
    const count = intOf(snapshot[key]);
    if (count !== null && count > 0) out.push({ label, count });
  }
  return out;
}

const COMMERCIAL_PENDING: readonly (readonly [string, string])[] = [
  ["inbound_unread_count", "inbound sem leitura"],
  ["missing_next_action_count", "oportunidade(s) sem próxima ação"],
  ["stalled_count", "estágio(s) parado(s)"],
  ["aging_count", "negócio(s) envelhecendo"],
  ["at_risk_client_count", "cliente(s) em risco no funil"],
];

const CLIENT_PENDING: readonly (readonly [string, string])[] = [
  ["at_risk_client_count", "cliente(s) em risco"],
  ["open_blocker_count", "blocker(s) aberto(s)"],
];

const ENGINEERING_PENDING: readonly (readonly [string, string])[] = [
  ["failing_check_count", "check(s) de CI falhando"],
  ["open_incident_count", "incidente(s) aberto(s)"],
];

function commercialIndicator(snapshot: Record<string, unknown> | null): string {
  if (!snapshot) return "sem indicador nesta leitura";
  const open = intOf(snapshot.pipeline_open_count);
  if (open !== null) return `${open} negócio(s) em pipeline aberto`;
  const funnel = asRecord(snapshot.funnel);
  if (funnel) {
    const leads = intOf(funnel.new_leads);
    const opps = intOf(funnel.opportunities);
    if (leads !== null || opps !== null) {
      return `leads ${leads ?? "sem dado"} · oportunidades ${opps ?? "sem dado"}`;
    }
  }
  const nominal = moneyText(snapshot.pipeline_nominal);
  if (nominal) return `pipeline nominal ${nominal}`;
  return "indicador principal ausente no recorte";
}

function clientsIndicator(snapshot: Record<string, unknown> | null): string {
  if (!snapshot) return "sem indicador nesta leitura";
  const clients = asArray(snapshot.clients);
  const atRisk = intOf(snapshot.at_risk_client_count);
  if (clients.length > 0) {
    return `${clients.length} cliente(s) observado(s)${atRisk !== null ? ` · ${atRisk} em risco` : ""}`;
  }
  if (atRisk !== null) return `${atRisk} cliente(s) em risco`;
  return "indicador principal ausente no recorte";
}

function financeIndicator(snapshot: Record<string, unknown> | null): string {
  if (!snapshot) return "sem indicador nesta leitura";
  const overdue = moneyText(snapshot.overdue ?? snapshot.receivables_overdue);
  if (overdue) return `vencido ${overdue}`;
  const receivable = moneyText(snapshot.receivable ?? snapshot.receivables_open ?? snapshot.billed);
  if (receivable) return `a receber ${receivable}`;
  const contracted = moneyText(snapshot.contracted);
  if (contracted) return `contratado ${contracted}`;
  return "valores não legíveis nesta leitura — ausência de valor não é zero";
}

function engineeringIndicator(snapshot: Record<string, unknown> | null): string {
  if (!snapshot) return "sem indicador nesta leitura";
  const failing = intOf(snapshot.failing_check_count);
  const prs = intOf(snapshot.open_pr_count);
  if (failing !== null || prs !== null) {
    return `PRs abertos ${prs ?? "sem dado"} · CI falhando ${failing ?? "sem dado"}`;
  }
  return "indicador principal ausente no recorte";
}

function infraServices(snapshot: Record<string, unknown> | null): { total: number; bad: number } {
  const rows = snapshot ? asArray(snapshot.services) : [];
  let bad = 0;
  for (const raw of rows) {
    const row = asRecord(raw);
    const status = row ? strOf(row.status) : null;
    if (status !== null && status !== "healthy") bad += 1;
  }
  return { total: rows.length, bad };
}

function infraIndicator(snapshot: Record<string, unknown> | null): string {
  if (!snapshot) return "sem indicador nesta leitura";
  const { total, bad } = infraServices(snapshot);
  const status = strOf(snapshot.status);
  if (total > 0) return `${total} serviço(s) · ${bad} fora de saudável${status ? ` · status ${status}` : ""}`;
  if (status) return `status ${status}`;
  return "indicador principal ausente no recorte";
}

function dispatchOf(commercial: DomainSlot | null): Record<string, unknown> {
  const operations = commercial?.snapshot ? asRecord(commercial.snapshot.operations) : null;
  return (operations ? asRecord(operations.dispatch) : null) ?? {};
}

function outboundFrom(commercial: DomainSlot | null): HojeOutbound {
  const dispatch = dispatchOf(commercial);
  const raw = strOf(dispatch.state);
  const state: HojeOutbound["state"] = raw === "PAUSED" ? "PAUSED" : raw === "ACTIVE" ? "ACTIVE" : "UNKNOWN";
  const observed = dispatch.observed === true;
  const label = state === "PAUSED" ? "PAUSADO" : state === "ACTIVE" ? "ATIVO" : "DESCONHECIDO";
  let detail: string;
  if (state === "UNKNOWN") {
    detail =
      strOf(dispatch.why) ??
      "Kill switch não lido. Desconhecido não é 'ativo' nem 'pausado'.";
  } else if (state === "PAUSED") {
    detail = `Outbound pausado. Motivo: ${strOf(dispatch.pause_reason) ?? "não informado"}.`;
  } else {
    const sent = intOf(dispatch.sent_last_hour);
    const cap = intOf(dispatch.cap);
    const volume = sent !== null || cap !== null ? ` Enviados na hora/teto: ${sent ?? "sem dado"}/${cap ?? "sem dado"}.` : "";
    detail = `Outbound ativo.${volume}`;
  }
  return { state, label, observed, detail, href: "#/warmbly" };
}

function warmblyCard(
  commercial: DomainSlot | null,
  outbound: HojeOutbound,
  alerts: AlertCount,
  seed: CardSeed,
): HojeDomainCard {
  const pending: DomainPending[] = [];
  if (outbound.state === "PAUSED") pending.push({ label: "disparo pausado", count: 1 });
  if (outbound.state === "UNKNOWN") pending.push({ label: "disparo desconhecido — confirmar no Warmbly", count: 1 });
  const inbound = commercial?.snapshot ? intOf(commercial.snapshot.inbound_unread_count) : null;
  if (inbound !== null && inbound > 0) pending.push({ label: "inbound sem leitura", count: inbound });
  const operations = commercial?.snapshot ? asRecord(commercial.snapshot.operations) : null;
  const overview = operations ? asRecord(operations.overview) : null;
  const exceptions = overview ? intOf(overview.exceptions) : null;
  if (exceptions !== null && exceptions > 0) pending.push({ label: "exceção(ões) comerciais no Warmbly", count: exceptions });

  let state: DomainState;
  let reason: string;
  if (commercial === null) {
    state = "desconhecido";
    reason = "Faltam dados: envelope sem recorte comercial do disparo.";
  } else if (commercial.presence === "absent") {
    const absence = commercial.absence_reason ?? "no_data";
    state = absence === "upstream_error" ? "erro_coleta" : "desconhecido";
    reason = ownMapValue(ABSENCE_SENTENCES, absence) ?? "Faltam dados por motivo não reconhecido.";
  } else if (commercial.freshness_status === "ERROR") {
    state = "erro_coleta";
    reason = "Erro de coleta Warmbly: estado não confiável.";
  } else if (commercial.freshness_status === "UNKNOWN") {
    state = "desconhecido";
    reason = "Faltam dados: recência comercial indeterminada.";
  } else if (outbound.state === "UNKNOWN" || !outbound.observed) {
    state = "desconhecido";
    reason =
      "Faltam dados: Warmbly não reportou o disparo. Ausência não é 'outbound parado'.";
  } else if (commercial.freshness_status !== "FRESH") {
    state = "atencao";
    reason = "Leitura defasada: o disparo abaixo pode ter mudado.";
  } else if (alerts.critical > 0) {
    state = "critico";
    reason = `${alerts.critical} alerta(s) crítico(s) no recorte comercial.`;
  } else if (pending.length > 0) {
    state = "atencao";
    reason = "Há pendências de disparo/inbound listadas abaixo.";
  } else {
    state = "saudavel";
    reason = "Sem ocorrências: sem pendência de disparo nem inbound.";
  }

  return {
    id: seed.id,
    label: seed.label,
    state,
    state_label: domainStateLabel(state),
    state_reason: reason,
    indicator: `disparo ${outbound.label} — ${outbound.detail}`,
    pending,
    action_count: pending.reduce((sum, item) => sum + item.count, 0),
    observed_at: commercial?.observed_at ?? null,
    observed_at_local: commercial?.observed_at ? formatLocal(commercial.observed_at) : "sem leitura registrada",
    freshness_status: commercial?.freshness_status ?? "UNKNOWN",
    confidence: commercial?.confidence ?? null,
    source: commercial?.source ?? null,
    href: seed.href,
    href_label: seed.href_label,
    presence: commercial?.presence ?? "absent",
    absence_reason: commercial?.absence_reason ?? null,
    ...(commercial?.truth === undefined ? {} : { truth: commercial.truth }),
  };
}

function indicatorFor(id: DomainCardId, snapshot: Record<string, unknown> | null): string {
  switch (id) {
    case "comercial":
      return commercialIndicator(snapshot);
    case "clientes":
      return clientsIndicator(snapshot);
    case "financeiro":
      return financeIndicator(snapshot);
    case "engenharia":
      return engineeringIndicator(snapshot);
    case "infra":
      return infraIndicator(snapshot);
    case "warmbly":
      return "";
  }
}

function pendingFor(id: DomainCardId, snapshot: Record<string, unknown> | null): DomainPending[] {
  switch (id) {
    case "comercial":
      return pendingFromCounts(snapshot, COMMERCIAL_PENDING);
    case "clientes":
      return pendingFromCounts(snapshot, CLIENT_PENDING);
    case "engenharia":
      return pendingFromCounts(snapshot, ENGINEERING_PENDING);
    case "financeiro": {
      const overdue = moneyOf(snapshot?.overdue ?? snapshot?.receivables_overdue);
      return overdue && overdue.amount_cents > 0
        ? [{ label: `recebível(is) vencido(s) — ${formatMoney(overdue)}`, count: 1 }]
        : [];
    }
    case "infra": {
      const { bad } = infraServices(snapshot);
      return bad > 0 ? [{ label: "serviço(s) fora de saudável", count: bad }] : [];
    }
    case "warmbly":
      return [];
  }
}

/**
 * `healthy:false` alone cannot mean "down": the envelope schema forces it on
 * every non-FRESH slot, so a merely stale domain would read as critical. Only
 * a status the source itself reports as bad escalates. `unknown` is excluded
 * because `demoteHealthStatus` writes it onto healthy-but-stale readings.
 */
function reportedUnhealthy(slot: DomainSlot): boolean {
  const status = slot.snapshot ? strOf(slot.snapshot.status) : null;
  return status === "down" || status === "unhealthy" || status === "degraded";
}

function standardCard(seed: CardSeed, slot: DomainSlot | null, alerts: AlertCount): HojeDomainCard {
  const pending = pendingFor(seed.id, slot?.snapshot ?? null);
  if (alerts.open > 0) {
    pending.push({ label: "alerta(s) aberto(s) neste domínio", count: alerts.open });
  }
  let state: DomainState;
  let reason: string;
  if (slot === null) {
    state = "desconhecido";
    reason =
      "Faltam dados: o envelope operacional não trouxe este domínio. Não é 'nada a fazer', é leitura ausente.";
  } else if (slot.presence === "absent") {
    const absence = slot.absence_reason ?? "no_data";
    state = absence === "upstream_error" ? "erro_coleta" : "desconhecido";
    reason = ownMapValue(ABSENCE_SENTENCES, absence) ?? "Faltam dados por motivo não reconhecido.";
  } else if (slot.freshness_status === "ERROR") {
    state = "erro_coleta";
    reason = "Erro de coleta: a última tentativa de leitura falhou. Os números abaixo não valem.";
  } else if (slot.freshness_status === "UNKNOWN") {
    state = "desconhecido";
    reason = "Faltam dados: a recência desta leitura não pôde ser determinada.";
  } else if (alerts.critical > 0) {
    state = "critico";
    reason = `${alerts.critical} alerta(s) crítico(s) abertos neste domínio.`;
  } else if (reportedUnhealthy(slot)) {
    state = "critico";
    reason = "A origem reporta este domínio fora de saudável nesta coleta.";
  } else if (slot.freshness_status === "FRESH" && !slot.healthy) {
    state = "critico";
    reason = "A origem reporta este domínio fora de saudável nesta coleta.";
  } else if (slot.freshness_status === "STALE") {
    state = "atencao";
    reason = "Leitura defasada: os números abaixo podem já ter mudado na origem.";
  } else if (pending.length > 0) {
    state = "atencao";
    reason = "Leitura presente e recente, com as pendências listadas abaixo.";
  } else {
    state = "saudavel";
    reason = "Sem ocorrências: a leitura chegou, é recente e não há pendência aberta.";
  }
  return {
    id: seed.id,
    label: seed.label,
    state,
    state_label: domainStateLabel(state),
    state_reason: reason,
    indicator: slot?.presence === "present" ? indicatorFor(seed.id, slot.snapshot) : "sem indicador — leitura ausente",
    pending,
    action_count: pending.reduce((sum, item) => sum + item.count, 0),
    observed_at: slot?.observed_at ?? null,
    observed_at_local: slot?.observed_at ? formatLocal(slot.observed_at) : "sem leitura registrada",
    freshness_status: slot?.freshness_status ?? "UNKNOWN",
    confidence: slot?.confidence ?? null,
    source: slot?.source ?? null,
    href: seed.href,
    href_label: seed.href_label,
    presence: slot?.presence ?? "absent",
    absence_reason: slot?.absence_reason ?? null,
    ...(slot?.truth === undefined ? {} : { truth: slot.truth }),
  };
}

const INTEGRATION_ORDER: readonly DomainState[] = [
  "saudavel",
  "atencao",
  "desconhecido",
  "critico",
  "erro_coleta",
];

function integrationsFrom(envelope: Record<string, unknown>): HojeIntegration[] {
  const bySystem = new Map<string, HojeIntegration>();
  for (const raw of asArray(envelope.source_observations)) {
    const row = asRecord(raw);
    if (!row) continue;
    const source = sourceOf(row.source);
    if (!source) continue;
    const freshness = freshnessOf(row.freshness_status);
    const error = asRecord(row.error);
    const errorCode = error ? strOf(error.code) : null;
    let state: DomainState;
    if (errorCode !== null || freshness === "ERROR") state = "erro_coleta";
    else if (freshness === "UNKNOWN") state = "desconhecido";
    else if (freshness === "STALE") state = "atencao";
    else state = "saudavel";
    const observedAt = strOf(row.observed_at);
    const errorMessage = error ? strOf(error.message) : null;
    const detail = errorCode !== null
      ? "Erro na origem: a leitura falhou."
      : `Leitura recebida: ${sourceKindLabel(source.kind)}.`;
    const previous = bySystem.get(source.system);
    const candidate: HojeIntegration = {
      system: source.system,
      system_label: sourceSystemLabel(source.system),
      source_kind: source.kind,
      source_locator: source.locator,
      state,
      state_label: domainStateLabel(state),
      detail,
      observed_at_local: observedAt ? formatLocal(observedAt) : "sem leitura registrada",
      freshness_status: freshness,
      error_code: errorCode,
      error_message: errorMessage,
    };
    // Worst reading per system wins: one healthy probe must not hide a broken one.
    if (
      !previous ||
      INTEGRATION_ORDER.indexOf(candidate.state) > INTEGRATION_ORDER.indexOf(previous.state)
    ) {
      bySystem.set(source.system, candidate);
    }
  }
  // Worst first: an operator scanning the strip must hit the broken integration
  // before the healthy ones.
  return [...bySystem.values()].sort(
    (a, b) =>
      INTEGRATION_ORDER.indexOf(b.state) - INTEGRATION_ORDER.indexOf(a.state) ||
      a.system.localeCompare(b.system),
  );
}

function emptySummary(): HojeDomainSummary {
  const outbound: HojeOutbound = {
    state: "UNKNOWN",
    label: "DESCONHECIDO",
    observed: false,
    detail:
      "Faltam dados: o envelope operacional não chegou nesta leitura, então o estado do disparo é desconhecido.",
    href: "#/warmbly",
  };
  const cards = CARD_SEEDS.map((seed) =>
    seed.id === "warmbly"
      ? warmblyCard(null, outbound, { open: 0, critical: 0 }, seed)
      : standardCard(seed, null, { open: 0, critical: 0 }),
  );
  return {
    envelope_present: false,
    generated_at: null,
    cards,
    integrations: [],
    outbound,
    founder_truth: projectFounderOperatingTruth(null),
    unmapped: [],
    action_total: null,
    action_total_note:
      "Nenhuma contagem pôde ser feita: o envelope operacional não chegou. Ausência de leitura não significa ausência de trabalho.",
  };
}

/**
 * Builds the per-domain panorama from the raw `/v1/operational-snapshots` body.
 *
 * Anything that is not an `operational-envelope.v1` object yields the explicit
 * "envelope ausente" summary rather than a page full of green cards.
 */
export function summarizeDomains(envelopeRaw: unknown): HojeDomainSummary {
  const envelope = asRecord(envelopeRaw);
  if (!envelope || asRecord(envelope.snapshots) === null) {
    return emptySummary();
  }
  const snapshots = asRecord(envelope.snapshots) ?? {};
  const alerts = alertsByDomain(envelope);
  const slots = new Map<string, DomainSlot | null>();
  for (const seed of CARD_SEEDS) {
    if (seed.envelopeDomain === null) continue;
    slots.set(seed.envelopeDomain, slotOf(snapshots[seed.envelopeDomain]));
  }
  const commercial = slots.get("commercial") ?? null;
  const outbound = outboundFrom(commercial);
  const cards = CARD_SEEDS.map((seed) => {
    const domainAlerts =
      seed.envelopeDomain !== null
        ? (alerts.get(seed.envelopeDomain) ?? { open: 0, critical: 0 })
        : (alerts.get("commercial") ?? { open: 0, critical: 0 });
    if (seed.id === "warmbly") {
      // Commercial alerts escalate this card's state but are counted once, on
      // the Comercial card, so the visible parcels still add up to the total.
      return warmblyCard(commercial, outbound, domainAlerts, seed);
    }
    return standardCard(seed, slots.get(seed.envelopeDomain ?? "") ?? null, domainAlerts);
  });
  const unmapped: HojeUnmappedAlerts[] = [];
  for (const [domain, count] of alerts) {
    if (DOMAIN_TO_CARD.has(domain)) continue;
    unmapped.push({ domain, count: count.open, href: ownMapValue(UNMAPPED_HREFS, domain) ?? "#/hoje" });
  }
  unmapped.sort((a, b) => a.domain.localeCompare(b.domain));
  const cardTotal = cards.reduce((sum, card) => sum + card.action_count, 0);
  const unmappedTotal = unmapped.reduce((sum, row) => sum + row.count, 0);
  return {
    envelope_present: true,
    generated_at: strOf(envelope.generated_at),
    cards,
    integrations: integrationsFrom(envelope),
    outbound,
    founder_truth: projectFounderOperatingTruth(envelopeRaw),
    unmapped,
    action_total: cardTotal + unmappedTotal,
    action_total_note:
      "Soma bruta dos sinais listados nos cards abaixo. Uma mesma entidade pode aparecer em mais de um sinal agregado; portanto este número mede sinais para triagem, não itens únicos.",
  };
}

/**
 * Sentence explaining why a domain slice is missing, or `null` when the slice
 * was actually read. Callers use `null` to say "sem ocorrências" and the
 * sentence to say "faltam dados" — the distinction issue #61 asks for, and the
 * reason no section on Hoje says "ignorar" any more.
 */
export function absenceNoteFor(envelopeRaw: unknown, domain: string): string | null {
  const envelope = asRecord(envelopeRaw);
  const snapshots = envelope ? asRecord(envelope.snapshots) : null;
  if (!snapshots) {
    return "Faltam dados: o envelope operacional não chegou nesta leitura.";
  }
  const slot = slotOf(snapshots[domain]);
  if (slot === null) {
    return "Faltam dados: este domínio não veio no envelope operacional.";
  }
  if (slot.presence === "absent") {
    return ownMapValue(ABSENCE_SENTENCES, slot.absence_reason ?? "no_data") ?? "Faltam dados por motivo não reconhecido.";
  }
  if (slot.freshness_status === "ERROR") {
    return "Erro de coleta: a última leitura deste domínio falhou.";
  }
  if (slot.freshness_status === "UNKNOWN") {
    return "Faltam dados: a recência desta leitura não pôde ser determinada.";
  }
  return null;
}

/** Contract guard: no card may claim "saudável" on an untrusted reading. */
export function assertNoHealthyOnUntrusted(summary: HojeDomainSummary): void {
  for (const card of summary.cards) {
    if (card.state === "saudavel" && card.freshness_status !== "FRESH") {
      throw new Error(`domain ${card.id} painted saudável on ${card.freshness_status}`);
    }
    if (card.state === "saudavel" && card.presence === "absent") {
      throw new Error(`domain ${card.id} painted saudável while absent`);
    }
  }
  for (const integration of summary.integrations) {
    if (integration.state === "saudavel" && integration.freshness_status !== "FRESH") {
      throw new Error(`integration ${integration.system} painted saudável on ${integration.freshness_status}`);
    }
  }
}
