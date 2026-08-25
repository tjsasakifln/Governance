import { escapeHtml } from "../escape";
import { formatLocal, isUtcDateTime } from "../datetime";
import { withQueryParams } from "../destinations";
import { ACTIVITY_LIST, EXCEPTION_LIST } from "../filter";
import { formatMoney } from "../money";
import { ownMapValue } from "../own-map";
import { sourceSystemLabel } from "../provenance";
import type {
  AgentActivity,
  ClientIdentityException,
  ClientStatus,
  CommercialSnapshot,
  Directive,
  EngineeringSnapshot,
  FinanceSnapshot,
  InfraCatalogSummary,
  ServiceHealth,
} from "../types";
import {
  leadDetailBlock,
  leadDetailHash,
  leadTitleOf,
  queueFocusDomId,
  queueFocusToken,
} from "./lead-detail";
import { editorialReasonLabel, readEditorialState } from "./editorial-state";
import { renderFilteredList } from "./list";
import { provenanceBlock } from "./provenance";
import {
  ABSENT_HELP,
  BLOCKED_HELP,
  agentStatusLabel,
  authorizationStateLabel,
  authorityLabel,
  availabilityLabel,
  clientLifecycleLabel,
  commercialEventLabel,
  commercialStateLabel,
  directiveKindLabel,
  directiveStatusLabel,
  dispatchStateLabel,
  exceptionKindLabel,
  freshnessLabel,
  healthLabel,
  helpTerm,
  hopStatusLabel,
  MEMORY_GROUP_TITLES,
  pipelineStageLabel,
  providerLabel,
  providerMutationLabel,
  scopeLabel,
  routeClassLabel,
  goReviewVerdictLabel,
  severityLabel,
  statusPill,
  technicalDetails,
} from "./labels";

function fact(label: string, value: string, extra = ""): string {
  return `<div${extra}><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`;
}

function optionalCount(label: string, value: number | undefined): string {
  return typeof value === "number"
    ? fact(label, String(value))
    : fact(label, helpTerm("ausente", ABSENT_HELP), ` data-absent="true"`);
}

function optionalMoney(label: string, money: { amount_cents: number; currency: string } | undefined): string {
  return money ? moneyFact(label, money) : fact(label, helpTerm("ausente", ABSENT_HELP), ` data-absent="true"`);
}

function moneyFact(label: string, money: { amount_cents: number; currency: string }): string {
  return `
    <div class="money" data-amount-cents="${money.amount_cents}" data-currency="${escapeHtml(money.currency)}">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(formatMoney(money))}</dd>
    </div>
  `;
}

const ISO_4217 = /^[A-Z]{3}$/;

/**
 * A value the read model could not denominate is unknown, and an unknown reads
 * "sem dados". It must never be painted as `0,00`, which looks measured.
 */
function noDataFact(label: string): string {
  return fact(label, "sem dados", ` data-absent="true" data-no-data="true"`);
}

function readableMoney(value: unknown): { amount_cents: number; currency: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rec = value as { amount_cents?: unknown; currency?: unknown };
  if (!Number.isInteger(rec.amount_cents)) return undefined;
  if (typeof rec.currency !== "string" || !ISO_4217.test(rec.currency)) return undefined;
  return { amount_cents: rec.amount_cents as number, currency: rec.currency };
}

/**
 * Pipeline nominal. Multi-currency pipelines are shown as separate totals per
 * currency — never added together, because the Control Center has no rate
 * source with a date to convert with.
 */
function pipelineNominalFact(snapshot: CommercialSnapshot): string {
  const split = (snapshot.pipeline_nominal_by_currency ?? [])
    .map((money) => readableMoney(money))
    .filter((money): money is { amount_cents: number; currency: string } => money !== undefined);
  if (split.length > 1) {
    return fact(
      "Pipeline nominal",
      split.map((money) => escapeHtml(formatMoney(money))).join(" · "),
      ` data-currency-split="${split.length}"`,
    );
  }
  const single = readableMoney(snapshot.pipeline_nominal) ?? split[0];
  return single ? moneyFact("Pipeline nominal", single) : noDataFact("Pipeline nominal");
}

/**
 * A deal amount is only shown in a currency the read model actually stated.
 * It no longer borrows BRL from the catalog, which used to make an
 * undenominated figure look confirmed. An amount that cannot be read shows no
 * money line; giving absence a visible word here belongs to the zero/ausente
 * vocabulary in #62, not to this fix.
 */
function dealMoneyLine(value: unknown): string {
  const money = readableMoney(value);
  return money
    ? `<p class="money" data-currency="${escapeHtml(money.currency)}">${escapeHtml(formatMoney(money))}</p>`
    : "";
}

const WEEKLY_CHAIN_SCHEMA = "control-center.weekly-revenue-chain.v1";
const WEEKLY_SOURCE_CONTRACT = "confenge.commercial_intel.v1";
const WEEKLY_SOURCE_SURFACE = "GET /v1/confenge/intel/executive?include_synthetic=0";
const OPAQUE_WEEKLY_ID = /^[A-Za-z0-9._:-]{1,160}$/;
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/;

const WEEKLY_DECISION_LABELS = new Map<string, string>([
  ["GO", "prosseguir"],
  ["NO-GO", "não prosseguir"],
  ["WAIT", "aguardando decisão humana"],
]);
const WEEKLY_ROLE_LABELS = new Map<string, string>([
  ["role_commercial_owner", "responsável comercial"],
]);
const WEEKLY_ACTION_LABELS = new Map<string, string>([
  ["human_review_commercial_terms", "revisar os termos comerciais manualmente"],
]);
const WEEKLY_MONEY_STATUS_LABELS = new Map<string, string>([
  ["pending", "pendente"],
  ["confirmed", "confirmada"],
  ["received", "recebido"],
  ["overdue", "vencida"],
  ["refunded", "estornada"],
  ["cancelled", "cancelada"],
]);

function own(value: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
}

function ownRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function ownString(value: Record<string, unknown>, key: string): string | null {
  const candidate = own(value, key);
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function observedWeeklyValue(value: unknown): string | null {
  const row = ownRecord(value);
  const candidate = row && own(row, "availability") === "OBSERVED" ? ownString(row, "value") : null;
  return candidate && OPAQUE_WEEKLY_ID.test(candidate) ? candidate : null;
}

function translatedWeeklyToken(raw: string | null, labels: ReadonlyMap<string, string>): string {
  if (!raw) return "sem dados";
  return labels.get(raw) ?? "estado não reconhecido";
}

function validWeeklyInstant(value: string): boolean {
  if (!isUtcDateTime(value)) return false;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  const inputSecond = value.replace(/\.\d{1,9}Z$/, "Z");
  const parsedSecond = new Date(parsed).toISOString().replace(/\.\d{3}Z$/, "Z");
  return inputSecond === parsedSecond;
}

function weeklyMoney(value: unknown, expectedId: string | null, collectedAt: string): {
  available: boolean;
  id: string | null;
  rawStatus: string | null;
  observedAt: string | null;
  label: string;
  money?: { amount_cents: number; currency: string };
} {
  const row = ownRecord(value);
  if (!row || own(row, "availability") !== "OBSERVED") {
    return { available: false, id: null, rawStatus: null, observedAt: null, label: "sem dados" };
  }
  const hasObservedAt = Object.prototype.hasOwnProperty.call(row, "observed_at");
  const observedAtCandidate = ownString(row, "observed_at");
  const observedAtValid = !hasObservedAt || (observedAtCandidate !== null &&
    validWeeklyInstant(collectedAt) &&
    validWeeklyInstant(observedAtCandidate) &&
    Date.parse(observedAtCandidate) <= Date.parse(collectedAt)
  );
  if (!observedAtValid) {
    return { available: false, id: null, rawStatus: null, observedAt: null, label: "sem dados" };
  }
  const idCandidate = ownString(row, "id");
  const id = idCandidate && OPAQUE_WEEKLY_ID.test(idCandidate) ? idCandidate : null;
  const statusCandidate = ownString(row, "status");
  const rawStatus = statusCandidate && OPAQUE_WEEKLY_ID.test(statusCandidate) ? statusCandidate : null;
  const observedAt = observedAtCandidate;
  const amount = own(row, "amount_cents");
  const currency = own(row, "currency");
  const linked = id !== null && OPAQUE_WEEKLY_ID.test(id) && expectedId !== null && expectedId !== "UNKNOWN" && id === expectedId;
  const money = linked && Number.isSafeInteger(amount) && Number(amount) >= 0 && typeof currency === "string" && ISO_4217.test(currency)
    ? { amount_cents: Number(amount), currency }
    : undefined;
  const state = translatedWeeklyToken(rawStatus?.toLowerCase() ?? null, WEEKLY_MONEY_STATUS_LABELS);
  return {
    available: linked,
    id,
    rawStatus,
    observedAt,
    label: !linked ? "sem dados" : money ? `${state} · ${formatMoney(money)}` : `${state} · valor sem dados`,
    ...(money ? { money } : {}),
  };
}

type WeeklyRevenueRow = {
  row: Record<string, unknown>;
  identity: Record<string, unknown>;
  source: Record<string, unknown>;
  authority: Record<string, unknown>;
  correlation: string;
};

function weeklyRevenueRows(value: unknown, presentedAt: string): { rows: WeeklyRevenueRow[]; rejected: number } {
  const input = Array.isArray(value) ? value : [];
  const presentationInstantValid = validWeeklyInstant(presentedAt) && Date.parse(presentedAt) <= Date.now();
  const byCorrelation = new Map<string, WeeklyRevenueRow>();
  const duplicates = new Set<string>();
  for (const item of input) {
    const row = ownRecord(item);
    const identity = ownRecord(row ? own(row, "canonical_identity") : null);
    const source = ownRecord(row ? own(row, "source") : null);
    const authority = ownRecord(row ? own(row, "authority") : null);
    const correlation = identity ? ownString(identity, "correlation_id") : null;
    const identityIdsValid = identity !== null && [
      "correlation_id",
      "account_id",
      "opportunity_id",
      "offer_id",
      "proposal_id",
      "charge_id",
      "payment_id",
    ].every((key) => {
      const id = ownString(identity, key);
      return id !== null && (id === "UNKNOWN" || OPAQUE_WEEKLY_ID.test(id));
    });
    const valid =
      row !== null &&
      identity !== null &&
      source !== null &&
      authority !== null &&
      own(row, "schema_version") === WEEKLY_CHAIN_SCHEMA &&
      typeof own(row, "held") === "boolean" &&
      own(row, "synthetic") === false &&
      correlation !== null &&
      correlation !== "UNKNOWN" &&
      OPAQUE_WEEKLY_ID.test(correlation) &&
      identityIdsValid &&
      own(source, "system") === "warmbly" &&
      own(source, "surface") === WEEKLY_SOURCE_SURFACE &&
      own(source, "contract") === WEEKLY_SOURCE_CONTRACT &&
      typeof own(source, "month") === "string" &&
      MONTH.test(String(own(source, "month"))) &&
      typeof own(source, "observed_at") === "string" &&
      validWeeklyInstant(String(own(source, "observed_at"))) &&
      presentationInstantValid &&
      Date.parse(String(own(source, "observed_at"))) <= Date.parse(presentedAt) &&
      own(source, "include_synthetic") === false &&
      own(authority, "operation_and_visualization") === "governance-control-center" &&
      own(authority, "action_and_outcome") === "warmbly" &&
      own(authority, "financial_facts") === "asaas";
    if (!valid || !correlation) continue;
    if (byCorrelation.has(correlation) || duplicates.has(correlation)) {
      byCorrelation.delete(correlation);
      duplicates.add(correlation);
      continue;
    }
    byCorrelation.set(correlation, { row, identity, source, authority, correlation });
  }
  const rows = [...byCorrelation.values()]
    .sort((a, b) => a.correlation.localeCompare(b.correlation))
    .slice(0, 50);
  return { rows, rejected: Math.max(0, input.length - rows.length) };
}

function technicalWeeklyFacts(item: WeeklyRevenueRow): string {
  const { row, identity, source, correlation } = item;
  const collectedAt = ownString(source, "observed_at") as string;
  const charge = weeklyMoney(own(row, "charge"), ownString(identity, "charge_id"), collectedAt);
  const receipt = weeklyMoney(own(row, "receipt"), ownString(identity, "payment_id"), collectedAt);
  const rawFacts = [
    ["Correlação", correlation],
    ["Conta", ownString(identity, "account_id") ?? "UNKNOWN"],
    ["Oportunidade", ownString(identity, "opportunity_id") ?? "UNKNOWN"],
    ["Oferta", ownString(identity, "offer_id") ?? "UNKNOWN"],
    ["Proposta", ownString(identity, "proposal_id") ?? "UNKNOWN"],
    ["Cobrança", ownString(identity, "charge_id") ?? "UNKNOWN"],
    ["Pagamento", ownString(identity, "payment_id") ?? "UNKNOWN"],
    ["Entregável", observedWeeklyValue(own(row, "latest_deliverable")) ?? "UNKNOWN"],
    ["Evidência", observedWeeklyValue(own(row, "latest_evidence")) ?? "UNKNOWN"],
    ["Decisão bruta", observedWeeklyValue(own(row, "decision")) ?? "UNKNOWN"],
    ["Responsável bruto", observedWeeklyValue(own(row, "responsible")) ?? "UNKNOWN"],
    ["Próxima ação bruta", observedWeeklyValue(own(row, "next_action")) ?? "UNKNOWN"],
    ["Estado bruto da cobrança", charge.rawStatus ?? "UNKNOWN"],
    ["ID financeiro da cobrança", charge.id ?? "UNKNOWN"],
    ["Cobrança observada em", charge.observedAt ?? "UNKNOWN"],
    ["Estado bruto do recebimento", receipt.rawStatus ?? "UNKNOWN"],
    ["ID financeiro do recebimento", receipt.id ?? "UNKNOWN"],
    ["Recebimento observado em", receipt.observedAt ?? "UNKNOWN"],
    ["Contrato de origem", ownString(source, "contract") ?? "UNKNOWN"],
    ["Rota de origem", ownString(source, "surface") ?? "UNKNOWN"],
  ] as const;
  return `<details class="lead-technical" data-technical-detail="weekly-revenue">
    <summary>Identificadores e proveniência técnica</summary>
    <dl class="facts">${rawFacts.map(([label, value]) => fact(label, `<span class="wrap-any">${escapeHtml(value)}</span>`)).join("")}</dl>
  </details>`;
}

function weeklyRevenueBlock(operations: Record<string, unknown>, presentedAt: string): string {
  const result = weeklyRevenueRows(own(operations, "weekly_revenue_chains"), presentedAt);
  return `<section class="stack" aria-labelledby="weekly-revenue-title" data-weekly-revenue-chain-count="${result.rows.length}" data-weekly-revenue-rejected="${result.rejected}">
    <h2 id="weekly-revenue-title">Cadeia semanal até receita observável</h2>
    <p class="constraint">O Control Center opera e apresenta os dados. O Warmbly responde pelas ações e pelos resultados comerciais. O Asaas é a autoridade dos fatos financeiros. Esta tela é somente leitura.</p>
    ${result.rejected > 0 ? `<p class="banner" role="status">${result.rejected} registro(s) não foram exibidos por contrato inválido, correlação ambígua ou limite da tela.</p>` : ""}
    <div class="cards">${result.rows.length === 0
      ? `<p class="banner empty">Nenhuma cadeia real comprovada neste recorte. Ausência não é zero.</p>`
      : result.rows.map((item, index) => {
          const { row, identity, source, correlation } = item;
          const decision = observedWeeklyValue(own(row, "decision"));
          const decisionLabel = translatedWeeklyToken(decision, WEEKLY_DECISION_LABELS);
          const responsible = observedWeeklyValue(own(row, "responsible"));
          const nextAction = observedWeeklyValue(own(row, "next_action"));
          const rawDeadline = observedWeeklyValue(own(row, "deadline"));
          const deadline = rawDeadline && validWeeklyInstant(rawDeadline) ? rawDeadline : null;
          const month = ownString(source, "month") as string;
          const observedAt = ownString(source, "observed_at") as string;
          const charge = weeklyMoney(own(row, "charge"), ownString(identity, "charge_id"), observedAt);
          const receipt = weeklyMoney(own(row, "receipt"), ownString(identity, "payment_id"), observedAt);
          const deliverableObserved = observedWeeklyValue(own(row, "latest_deliverable")) !== null;
          const evidenceObserved = observedWeeklyValue(own(row, "latest_evidence")) !== null;
          const proposalId = ownString(identity, "proposal_id");
          const proposalObserved = proposalId !== null && proposalId !== "UNKNOWN" && observedWeeklyValue(own(row, "proposal")) === proposalId;
          return `<article class="card" data-correlation-id="${escapeHtml(correlation)}" data-commercial-decision="${escapeHtml(decision ?? "UNKNOWN")}" data-synthetic="false">
            <p class="kicker">Cadeia comercial ${index + 1}</p>
            <h3>${escapeHtml(decisionLabel)}</h3>
            ${decision === "WAIT" ? `<p class="banner" data-human-gate="WAIT">Aguardando decisão humana. Nenhuma conclusão comercial foi inferida.</p>` : ""}
            <dl class="facts">
              ${fact("Decisão comercial", escapeHtml(decisionLabel), decision ? "" : ` data-absent="true"`)}
              ${fact("Responsável", escapeHtml(translatedWeeklyToken(responsible, WEEKLY_ROLE_LABELS)), responsible ? "" : ` data-absent="true"`)}
              ${fact("Prazo", deadline ? escapeHtml(formatLocal(deadline)) : "sem dados", deadline ? "" : ` data-absent="true"`)}
              ${fact("Próxima ação", escapeHtml(translatedWeeklyToken(nextAction, WEEKLY_ACTION_LABELS)), nextAction ? "" : ` data-absent="true"`)}
              ${fact("Entregável mais recente", deliverableObserved ? "observado" : "sem dados", deliverableObserved ? "" : ` data-absent="true"`)}
              ${fact("Evidência mais recente", evidenceObserved ? "observada" : "sem dados", evidenceObserved ? "" : ` data-absent="true"`)}
              ${fact("Proposta", proposalObserved ? "observada" : "sem dados", proposalObserved ? "" : ` data-absent="true"`)}
              ${fact("Retenção", own(row, "held") === true ? "retida para revisão" : "sem retenção observada")}
              ${fact("Cobrança", escapeHtml(charge.label), charge.available ? "" : ` data-absent="true"`)}
              ${fact("Recebimento", escapeHtml(receipt.label), receipt.available ? "" : ` data-absent="true"`)}
              ${fact("Período da origem", escapeHtml(`${month.slice(5, 7)}/${month.slice(0, 4)}`))}
              ${fact("Coletado em", escapeHtml(formatLocal(observedAt)))}
              ${fact("Autoridade financeira", "Asaas")}
            </dl>
            ${technicalWeeklyFacts({ row, identity, source, authority: item.authority, correlation })}
          </article>`;
        }).join("")}
    </div>
  </section>`;
}
function listFact(label: string, items: string[] | undefined): string {
  if (!items || items.length === 0) return "";
  return fact(label, escapeHtml(items.join(", ")));
}

function operationsOf(snapshot: CommercialSnapshot | undefined): Record<string, unknown> {
  return snapshot?.operations && typeof snapshot.operations === "object" ? snapshot.operations : {};
}

export const GROWTH_FUNNEL_HOPS = [
  "search_visibility",
  "click_session",
  "cta",
  "inbound_event",
  "lead",
  "qualified_lead",
  "opportunity",
  "commercial_proposal",
  "client_revenue",
] as const;

const GROWTH_HOP_LABELS: Record<(typeof GROWTH_FUNNEL_HOPS)[number], string> = {
  search_visibility: "Visibilidade de busca",
  click_session: "Clique/sessão",
  cta: "CTA",
  inbound_event: "Evento inbound",
  lead: "Lead",
  qualified_lead: "Lead qualificado",
  opportunity: "Oportunidade",
  commercial_proposal: "Proposta comercial",
  client_revenue: "Cliente/receita",
};

function hopStatusFor(hop: string, row: Record<string, unknown> | undefined): string {
  if (row && typeof row.status === "string" && row.status.length > 0) return row.status;
  if (hop === "search_visibility" || hop === "click_session") return "BLOCKED";
  return "UNKNOWN";
}

export function growthFunnelBlock(snapshot: CommercialSnapshot | undefined): string {
  const ops = operationsOf(snapshot);
  const growth = ops.growth && typeof ops.growth === "object" ? (ops.growth as Record<string, unknown>) : {};
  const fromContract = Array.isArray(growth.funnel_contract)
    ? growth.funnel_contract.map(String).filter((hop) => hop.length > 0)
    : [];
  const hops = fromContract.length > 0 ? fromContract : [...GROWTH_FUNNEL_HOPS];
  const scoreboard = growth.scoreboard && typeof growth.scoreboard === "object" ? (growth.scoreboard as Record<string, unknown>) : {};
  const stages = Array.isArray(scoreboard.stages) ? scoreboard.stages : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const item of stages) {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const id = String(row.id ?? row.stage ?? "");
    if (id) byId.set(id, row);
  }
  const attribution =
    growth.attribution && typeof growth.attribution === "object" ? (growth.attribution as Record<string, unknown>) : {};
  const attributionNote = typeof attribution.note === "string" ? attribution.note : "";
  const note = growthAttributionLabel(attributionNote);
  const organic =
    growth.organic_scoreboard && typeof growth.organic_scoreboard === "object"
      ? (growth.organic_scoreboard as Record<string, unknown>)
      : {};
  const organicNote = typeof organic.note === "string" ? organic.note : "";
  const organicConfigured = organic.configured === true;
  const organicWindows = Array.isArray(organic.windows) ? organic.windows : [];
  const organicBlock = organicConfigured
      ? `<article class="card" data-organic-scoreboard="true">
        <h3>Placar de crescimento orgânico (Warmbly)</h3>
        <p>${escapeHtml(organicNoteLabel(organicNote))}</p>
        ${technicalDetails(
          [
            { term: "schema", value: String(organic.schema ?? "") },
            { term: "real_empty", value: organic.real_empty === undefined ? "" : String(organic.real_empty) },
            { term: "availability", value: String(organic.availability ?? "") },
            { term: "note", value: organicNote },
            { term: "attribution_note", value: attributionNote },
          ],
          "organic-scoreboard",
        )}
        <div class="stack">${
          organicWindows.length === 0
            ? `<p class="banner empty">Placar orgânico presente e vazio.</p>`
            : organicWindows
                .slice(0, 4)
                .map((item) => {
                  const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
                  const slices = Array.isArray(row.by_source)
                    ? row.by_source
                    : Array.isArray(row.slices)
                      ? row.slices
                      : [];
                  const first = slices[0] && typeof slices[0] === "object" ? (slices[0] as Record<string, unknown>) : {};
                  const layers = Array.isArray(first.layers) ? first.layers : [];
                  return `<article class="card" data-organic-window="${escapeHtml(String(row.id ?? ""))}">
                    <h4>Janela ${escapeHtml(organicWindowLabel(String(row.id ?? "")))}</h4>
                    <ul>${layers
                      .map((layer) => {
                        const ly = layer && typeof layer === "object" ? (layer as Record<string, unknown>) : {};
                        const layerStatus = String(ly.status ?? "UNKNOWN");
                        const layerId = String(ly.id ?? "");
                        const layerLabel = layerId === "LEAD_VALID" ? "Leads válidos" : "camada não reconhecida";
                        const observation = typeof ly.observation === "string" ? ly.observation : "";
                        return `<li data-organic-layer="${escapeHtml(layerId)}" data-layer-status="${escapeHtml(layerStatus)}">${escapeHtml(layerLabel)}: ${escapeHtml(availabilityLabel(layerStatus))} (${escapeHtml(String(ly.count ?? "—"))}/${escapeHtml(String(ly.denominator ?? "—"))})${observation ? ` · ${escapeHtml(organicObservationLabel(observation))}` : ""}${technicalDetails(
                          [
                            { term: "layer_id", value: layerId },
                            { term: "layer_status", value: layerStatus },
                            { term: "observation", value: observation },
                            { term: "window_id", value: String(row.id ?? "") },
                          ],
                          "organic-layer",
                        )}</li>`;
                      })
                      .join("")}</ul>
                  </article>`;
                })
                .join("")
        }</div>
      </article>`
    : `<p class="banner empty" data-organic-scoreboard="false" data-availability="${escapeHtml(String(organic.availability ?? "NO_DATA"))}">Placar orgânico do Warmbly ausente nesta observação (${escapeHtml(availabilityLabel(String(organic.availability ?? "NO_DATA")))}).</p>`;
  return `
    <section class="stack domain-crescimento" aria-labelledby="crescimento-funil" data-domain="growth">
      <h2 id="crescimento-funil">Funil de crescimento</h2>
      <p class="constraint">${escapeHtml(note)}</p>
      ${technicalDetails([{ term: "attribution_note", value: attributionNote }], "growth-attribution")}
      ${organicBlock}
      <ol class="growth-hops">
        ${hops
          .map((hop) => {
            const row = byId.get(hop);
            const status = hopStatusFor(hop, row);
            const absent = !row;
            const detail = row && row.observation ? String(row.observation) : absent ? "etapa ausente nesta observação" : "";
            const label = ownMapValue(GROWTH_HOP_LABELS, hop) ?? "Etapa não reconhecida";
            const shown =
              status === "BLOCKED"
                ? helpTerm(hopStatusLabel(status), BLOCKED_HELP)
                : escapeHtml(hopStatusLabel(status));
            return `<li class="card" data-growth-hop="${escapeHtml(hop)}" data-hop-status="${escapeHtml(status)}"${absent ? ` data-absent="true"` : ""}>
              <h3>${escapeHtml(label)}</h3>
              <div class="help-line">${shown}${detail ? ` · ${escapeHtml(detail)}` : ""}</div>
              ${technicalDetails(
                [
                  { term: "hop", value: hop },
                  { term: "status", value: status },
                ],
                "growth-hop",
              )}
            </li>`;
          })
          .join("")}
      </ol>
    </section>
  `;
}

function metricRate(value: unknown): string {
  const rec = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!rec) return "—";
  if (rec.availability === "JOIN_UNPROVEN" || rec.omitted_reason === "durable_contact_to_deal_join_unavailable") {
    const den = typeof rec.denominator === "number" ? rec.denominator : "—";
    return `${helpTerm("cruzamento entre sistemas não comprovado", BLOCKED_HELP)} (base de ${den})`;
  }
  const num = rec.numerator;
  const den = rec.denominator;
  if (typeof num !== "number" || typeof den !== "number") return "—";
  if (den === 0) return `${num}/${den} (sem denominador)`;
  const pct = rec.ratio === null || rec.ratio === undefined ? "—" : `${Math.round(Number(rec.ratio) * 1000) / 10}%`;
  const tiny = rec.tiny_denominator === true ? " · amostra pequena, não é evidência estatística" : "";
  return `${pct} (${num}/${den})${tiny}`;
}

function observedCount(value: unknown): string {
  return typeof value === "number" && Number.isInteger(value)
    ? String(value)
    : "desconhecido / dados ainda incompletos";
}

function growthAttributionLabel(value: string): string {
  if (
    value ===
    "Hops without a durable ID stay UNKNOWN/BLOCKED. Scoreboard stages 1-2 stay BLOCKED without GSC/URL-index ingest. OrganicScoreboard is Warmbly-owned."
  ) {
    return "Etapas sem identificador durável permanecem desconhecidas ou bloqueadas. Busca e clique dependem de ingestão própria; o placar orgânico pertence ao Warmbly.";
  }
  return value === ""
    ? "Etapa sem identificador durável fica como desconhecida ou bloqueada. Nenhum cruzamento entre sistemas é inventado."
    : "Nota de atribuição não reconhecida; consulte o detalhe técnico.";
}

function organicNoteLabel(value: string): string {
  if (value === "Warmbly-owned organic/growth intelligence. Control Center does not recompute it.") {
    return "Inteligência de crescimento orgânico mantida pelo Warmbly; o Control Center não a recalcula.";
  }
  if (value === "Warmbly OrganicScoreboard was not present on this observation.") {
    return "O placar orgânico do Warmbly não estava presente nesta observação.";
  }
  return value === ""
    ? "Inteligência de crescimento orgânico mantida pelo Warmbly."
    : "Nota do placar orgânico não reconhecida; consulte o detalhe técnico.";
}

function organicWindowLabel(value: string): string {
  const days = /^(\d+)d$/.exec(value);
  if (days) return `${days[1]} dias`;
  if (value === "open") return "aberta";
  return "não reconhecida";
}

function organicObservationLabel(value: string): string {
  if (value === "no ingest") return "sem ingestão observada";
  return "observação não reconhecida";
}

const COHORT_MIXING_LABELS: Record<string, string> = {
  acquisition_cohorts_and_event_period_metrics_are_labeled_separately:
    "Coortes de aquisição e métricas por período são apresentadas separadamente.",
};

const COHORT_KIND_LABELS: Record<string, string> = {
  acquisition_cohort: "coorte de aquisição",
  event_period_funnel: "funil por período do evento",
};

const COHORT_ANCHOR_LABELS: Record<string, string> = {
  "Acquisition cohort: contact created_at. Not an event-period metric.":
    "Coorte de aquisição ancorada na criação do contato; não é uma métrica por período do evento.",
  "Warmbly inbound-truth scoreboard. Not an acquisition cohort.":
    "Placar de mensagens recebidas do Warmbly; não é uma coorte de aquisição.",
};

function cohortMixingLabel(value: string): string {
  return ownMapValue(COHORT_MIXING_LABELS, value) ?? "Regra de separação não reconhecida.";
}

function cohortKindLabel(value: string): string {
  return ownMapValue(COHORT_KIND_LABELS, value) ?? "tipo de coorte não reconhecido";
}

function cohortWindowLabel(value: string): string {
  const days = /^(\d+)d$/.exec(value);
  if (days) return `${days[1]} dias`;
  if (value === "open") return "aberta";
  return "não reconhecida";
}

function cohortAnchorLabel(value: string): string {
  return ownMapValue(COHORT_ANCHOR_LABELS, value) ?? "Referência da métrica não reconhecida.";
}

function controlledEmailCohort(ops: Record<string, unknown>): string {
  const root = ops.controlled_outbound && typeof ops.controlled_outbound === "object"
    ? (ops.controlled_outbound as Record<string, unknown>)
    : {};
  const current = root.current && typeof root.current === "object"
    ? (root.current as Record<string, unknown>)
    : null;
  const telemetryObserved = root.availability === "OBSERVED";
  const rows = telemetryObserved && Array.isArray(root.rows) ? root.rows : [];
  if (!current) {
    return `<article class="card" data-controlled-email="unknown">
      <h3>Cohort controlado de e-mail</h3>
      <p class="constraint">Nenhuma autorização limitada foi observada. Ausência não é autorização.</p>
      ${fact("Telemetria", escapeHtml(availabilityLabel(String(root.availability ?? "UNKNOWN"))))}
      ${fact("Instante de coleta/observação", escapeHtml(String(root.last_update_at ?? "desconhecido")))}
    </article>`;
  }
  const dispatch = current.dispatch && typeof current.dispatch === "object"
    ? (current.dispatch as Record<string, unknown>)
    : {};
  const outcomes = telemetryObserved && current.outcomes && typeof current.outcomes === "object"
    ? (current.outcomes as Record<string, unknown>)
    : {};
  const distribution = current.route_class_distribution && typeof current.route_class_distribution === "object"
    ? (current.route_class_distribution as Record<string, unknown>)
    : {};
  const routeFacts = Object.entries(distribution)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([route, count]) => fact(`Rota ${routeClassLabel(route)}`, observedCount(count)))
    .join("");
  const window = dispatch.window_start && dispatch.window_end
    ? `${String(dispatch.window_start)}–${String(dispatch.window_end)} ${String(dispatch.timezone ?? "")}`.trim()
    : "desconhecida";
  const integrityLabels: Record<string, string> = {
    grant_revoked: "autorização observada como revogada",
    grant_expired: "autorização expirada no instante desta coleta",
    authorized_quantity_exceeded: "enviados + reservados excedem a quantidade autorizada",
    daily_cap_unexpected: "cap diário diverge do limite esperado de 10",
  };
  const integrityFlags = Array.isArray(current.integrity_flags)
    ? current.integrity_flags.filter((flag): flag is string => typeof flag === "string")
    : [];
  const integrityWarning = integrityFlags.length > 0
    ? `<p class="banner" data-controlled-email-integrity="${escapeHtml(integrityFlags.join(" "))}">Sinais de integridade observados: ${escapeHtml(integrityFlags.map((flag) => ownMapValue(integrityLabels, flag) ?? "verificação não reconhecida").join("; "))}.</p>`
    : "";
  const telemetryWarning = telemetryObserved
    ? ""
    : `<p class="banner" data-controlled-email-telemetry="unproven">A autorização foi observada, mas o relatório não comprovou telemetria real sem dados sintéticos. Os resultados permanecem desconhecidos.</p>`;
  const outcomeRows = rows
    .filter((item) => item && typeof item === "object")
    .map((item) => item as Record<string, unknown>)
    .map((row) => {
      const route = String(row.route_class ?? "UNKNOWN");
      const provider = String(row.provider ?? "UNKNOWN");
      return `<article class="card" data-controlled-email-route="${escapeHtml(route)}">
      <h3>${escapeHtml(routeClassLabel(route))}</h3>
      <dl class="facts">
        ${fact("Provedor", escapeHtml(providerLabel(provider)))}
        ${fact("Tentativas", observedCount(row.attempted))}
        ${fact("Aceitos pelo SMTP", observedCount(row.provider_accepted))}
        ${fact("Entregues", observedCount(row.delivered))}
        ${fact("Rejeições permanentes", observedCount(row.hard_bounce))}
        ${fact("Rejeições temporárias", observedCount(row.soft_bounce))}
        ${fact("Respostas", observedCount(row.reply))}
        ${fact("Respostas positivas", observedCount(row.positive_reply))}
        ${fact("Pedidos de descadastro", observedCount(row.opt_out))}
        ${fact("Denúncias de spam", observedCount(row.spam_complaint))}
      </dl>
      ${technicalDetails(
        [
          { term: "route_class", value: route },
          { term: "provider", value: provider },
        ],
        "controlled-email-row",
      )}
    </article>`;
    })
    .join("");
  return `<section class="stack" aria-labelledby="controlled-email-title" data-controlled-email="${telemetryObserved ? "observed" : "unknown"}">
    <h2 id="controlled-email-title">${telemetryObserved ? "Primeira coorte real de e-mail" : "Coorte controlada — telemetria real não comprovada"}</h2>
    ${telemetryWarning}
    ${integrityWarning}
    <article class="card">
      <h3>${current.cohort_id ? "Coorte autorizada" : "Coorte não identificada"}</h3>
      <dl class="facts">
        ${fact("Hash da coorte", escapeHtml(String(current.cohort_hash ?? "desconhecido")))}
        ${fact("Versão da política", escapeHtml(String(current.policy_version ?? "desconhecida")))}
        ${fact("Mês do relatório", escapeHtml(String(root.report_month ?? "desconhecido")))}
        ${fact("Quantidade autorizada", observedCount(current.authorized_quantity))}
        ${fact("Enviados", observedCount(current.sent))}
        ${fact("Reservados", observedCount(current.reserved))}
        ${fact("Aceitos pelo SMTP", observedCount(outcomes.provider_accepted))}
        ${fact("Rejeições permanentes", observedCount(outcomes.hard_bounce))}
        ${fact("Rejeições temporárias", observedCount(outcomes.soft_bounce))}
        ${fact("Respostas", observedCount(outcomes.reply))}
        ${fact("Respostas positivas", observedCount(outcomes.positive_reply))}
        ${fact("Pedidos de descadastro", observedCount(outcomes.opt_out))}
        ${fact("Estado da autorização", escapeHtml(authorizationStateLabel(String(current.authorization_state ?? "UNKNOWN"))))}
        ${fact("Autorizado em", escapeHtml(String(current.authorized_at ?? "desconhecido")))}
        ${fact("Expira em", escapeHtml(String(current.expires_at ?? "desconhecido")))}
        ${fact("Revisão para prosseguir", escapeHtml(goReviewVerdictLabel(String(current.go_review_verdict ?? "UNKNOWN"))))}
        ${fact("Estado do disparo", escapeHtml(dispatchStateLabel(String(dispatch.state ?? "UNKNOWN"))))}
        ${fact("Cap diário", observedCount(current.max_daily_volume))}
        ${fact("Janela", escapeHtml(window))}
        ${fact("Instante de coleta/observação", escapeHtml(String(root.last_update_at ?? "desconhecido")))}
        ${routeFacts}
      </dl>
      <p class="constraint">Aceite pelo SMTP não comprova entrega. Métricas sem evento reconciliado permanecem desconhecidas.</p>
      ${technicalDetails(
        [
          { term: "cohort_id", value: String(current.cohort_id ?? "") },
          { term: "integrity_flags", value: integrityFlags.join(",") },
          { term: "authorization_state", value: String(current.authorization_state ?? "") },
          { term: "go_review_verdict", value: String(current.go_review_verdict ?? "") },
          { term: "dispatch_state", value: String(dispatch.state ?? "") },
        ],
        "controlled-email-grant",
      )}
    </article>
    <div class="cards">${outcomeRows || `<p class="banner empty">Nenhum evento comercial real observado para esta coorte. Ausência não é zero.</p>`}</div>
  </section>`;
}

export function commercialSubnav(surface: string | null): string {
  const items = [
    ["visao", "Visão"],
    ["rascunhos", "Rascunhos"],
    ["cohorts", "Coortes"],
    ["atividade", "Atividade"],
    ["pipeline", "Pipeline"],
    ["excecoes", "Exceções"],
  ] as const;
  const current = surface && surface.length > 0 ? surface : "visao";
  return `<nav class="subnav" aria-label="Superfícies comerciais">${items
    .map(
      ([id, label]) =>
        `<a href="#/comercial/${id}" data-surface="${id}" aria-current="${current === id ? "page" : "false"}">${label}</a>`,
    )
    .join("")}</nav>`;
}

export function commercialBlock(
  snapshot: CommercialSnapshot,
  surface: string | null = "visao",
  resource: string | null = null,
  query: string | null = null,
  hash = "#/comercial",
): string {
  const funnel = snapshot.funnel;
  const weighted =
    snapshot.pipeline_weighted && snapshot.pipeline_weighted.probability_reliable
      ? moneyFact("Pipeline ponderado (probabilidade confiável)", snapshot.pipeline_weighted)
      : fact("Pipeline ponderado", "omitido — sem base confiável para ponderar");
  const extra = snapshot.extra_historical
    ? fact(
        snapshot.extra_historical.label ?? "Extra histórica",
        escapeHtml(
          snapshot.extra_historical.note ??
            "Nunca tratada como oferta pública. Catálogo canônico permanece em Governance.",
        ),
        ` data-extra-historical="true" data-public-offer="false"`,
      )
    : fact("Extra histórica", "não é oferta pública", ` data-extra-historical="true" data-public-offer="false"`);
  const drift = snapshot.offer_version_drift
    ? fact(
        "Divergência de oferta/versão",
        escapeHtml(snapshot.offer_version_drift.detail ?? String(snapshot.offer_version_drift.count)),
      )
    : "";
  const current = surface && surface.length > 0 ? surface : "visao";
  const recorte = `
    <section class="compact domain-comercial" aria-labelledby="comercial-recorte" data-domain="commercial">
      <h2 id="comercial-recorte">Recorte comercial (somente leitura)</h2>
      <p class="authority">Autoridade do catálogo: ${escapeHtml(authorityLabel(snapshot.authority.catalog_authority))}. Operação comercial: ${escapeHtml(authorityLabel(snapshot.authority.commercial_runtime))}. Este recorte: ${escapeHtml(authorityLabel(snapshot.authority.this_document))}.</p>
      <dl class="facts">
        ${optionalCount("Novos leads", funnel?.new_leads)}
        ${optionalCount("Qualificados", funnel?.qualified)}
        ${optionalCount("Oportunidades", funnel?.opportunities)}
        ${optionalCount("Propostas", funnel?.proposals)}
        ${optionalCount("Clientes", funnel?.clients)}
        ${pipelineNominalFact(snapshot)}
        ${weighted}
        ${typeof snapshot.aging_count === "number" ? fact("Negócios envelhecidos", String(snapshot.aging_count)) : ""}
        ${typeof snapshot.missing_next_action_count === "number" ? fact("Sem próxima ação", String(snapshot.missing_next_action_count)) : ""}
        ${typeof snapshot.stalled_count === "number" ? fact("Estágio parado", String(snapshot.stalled_count)) : ""}
        ${drift}
        ${extra}
        ${optionalCount("Pipeline aberto", snapshot.pipeline_open_count)}
        ${optionalCount("Mensagens recebidas sem leitura", snapshot.inbound_unread_count)}
        ${optionalCount("Clientes em risco (declarado pelo comercial; identidade não resolvida)", snapshot.at_risk_client_count)}
      </dl>
      ${provenanceBlock(snapshot.provenance)}
    </section>`;
  return `
    ${commercialSubnav(current)}
    ${current === "visao" ? recorte : ""}
    ${commercialOps(snapshot, current, resource, query, hash)}
  `;
}

/**
 * Read-model rows arrive as `unknown[]` because `operations` is passed through
 * from the Warmbly projector without a schema of its own.
 */
function rowsOf(items: readonly unknown[]): Record<string, unknown>[] {
  return items.map((item) =>
    item && typeof item === "object" ? (item as Record<string, unknown>) : {},
  );
}

function activityOpsCard(
  row: Record<string, unknown>,
  query: string | null,
  position: { index: number; total: number; writesAllowed: boolean },
): string {
  const rowId = String(row.source_id ?? row.id ?? "");
  const title = escapeHtml(leadTitleOf(row) ?? "Organização não identificada pela origem");
  const heading = rowId
    ? `<a href="${escapeHtml(leadDetailHash("atividade", query, rowId, position))}" data-lead-detail-link="${escapeHtml(rowId)}">${title}</a>`
    : title;
  const focusToken = queueFocusToken(rowId, position);
  const focusAttributes = rowId
    ? ` id="${queueFocusDomId(focusToken)}" data-queue-focus="${focusToken}" tabindex="-1"`
    : "";
  const triage = String(row.triage_state ?? row.state ?? "new");
  const event = String(row.event ?? "activity");
  const state = String(row.state ?? "");
  const age = typeof row.age_seconds === "number" ? `${Math.max(0, Math.floor(row.age_seconds / 3600))} h` : "não informada";
  const owner = typeof row.owner === "string" && row.owner ? row.owner : "sem responsável";
  const sync = String(row.sync_status ?? "observed");
  const syncLabels: Record<string, string> = { observed: "observado na origem", synced: "sincronizado", pending: "sincronização pendente", failed: "falha de sincronização", unknown: "sincronização desconhecida" };
  const canonical = String(row.canonical_id ?? rowId);
  return `<article class="card"${focusAttributes} data-activity-id="${escapeHtml(rowId)}" data-activity-event="${escapeHtml(event)}" data-activity-state="${escapeHtml(state)}" data-triage-state="${escapeHtml(triage)}">
    <p class="kicker">${statusPill(triage, commercialStateLabel(triage))} · ${statusPill(event, commercialEventLabel(event))}${state && state !== triage ? ` · ${statusPill(state, commercialStateLabel(state))}` : ""}</p>
    <h3>${heading}</h3>
    <p>${escapeHtml(String(row.evidence ?? "Sem descrição adicional da origem."))}</p>
    <dl class="facts">
      ${fact("Idade", escapeHtml(age))}
      ${fact("Origem", escapeHtml(sourceSystemLabel(String(row.source ?? "warmbly"))))}
      ${fact("Responsável", escapeHtml(owner), owner === "sem responsável" ? ` data-absent="true"` : "")}
      ${fact("Prioridade", row.priority ? escapeHtml(severityLabel(String(row.priority))) : "não informada")}
      ${fact("Próximo passo", escapeHtml(String(row.next_action ?? "abrir o detalhe e definir a próxima ação")))}
      ${fact("Sincronização", escapeHtml(ownMapValue(syncLabels, sync) ?? "estado de sincronização não reconhecido"))}
    </dl>
    ${row.sync_detail ? `<p class="banner error" role="alert">Falha de sincronização: ${escapeHtml(String(row.sync_detail))}. Próxima ação: confirme no Warmbly antes de repetir.</p>` : ""}
    ${technicalDetails([
      { term: "source_id", value: rowId },
      { term: "event", value: event },
      { term: "state", value: state },
      { term: "triage_state", value: triage },
      { term: "sync_status", value: sync },
    ], "daily-triage")}
    ${position.writesAllowed ? `<div class="lead-actions" data-write-boundary="control-center">
    <form data-operator-form="ASSIGN_TRIAGE" data-writes-to="control-center" class="operator-form">
      <input type="hidden" name="target_canonical_id" value="${escapeHtml(canonical)}" />
      <input type="hidden" name="target_source_id" value="${escapeHtml(rowId)}" />
      <label>Nota de atribuição <textarea name="note" required minlength="2" maxlength="500"></textarea></label>
      <button type="submit">Atribuir a mim</button>
    </form>
    <form data-operator-form="MARK_TRIAGED" data-writes-to="control-center" class="operator-form">
      <input type="hidden" name="target_canonical_id" value="${escapeHtml(canonical)}" />
      <input type="hidden" name="target_source_id" value="${escapeHtml(rowId)}" />
      <label>Nota de triagem <textarea name="note" required minlength="2" maxlength="500"></textarea></label>
      <label class="confirm"><input type="checkbox" required name="ciencia" /> Entendo que isto registra a triagem no Control Center e não altera o Warmbly.</label>
      <button type="submit">Marcar como triado</button>
    </form>
    </div>` : ""}
  </article>`;
}

function exceptionOpsCard(row: Record<string, unknown>, writesAllowed: boolean): string {
  const id = String(row.id ?? "");
  const canonical = String(row.canonical_id ?? id);
  const sourceId = String(row.source_id ?? id);
  const workflow = String(row.workflow_state ?? "new");
  const owner = typeof row.owner === "string" && row.owner ? row.owner : "sem responsável";
  const age = typeof row.age_seconds === "number" ? `${Math.max(0, Math.floor(row.age_seconds / 3600))} h` : "não informada";
  const count = typeof row.occurrence_count === "number" ? row.occurrence_count : 1;
  const resolutionKind = String(row.resolution_kind ?? "unsupported");
  let resolution: string;
  if (resolutionKind === "warmbly_action") {
    resolution = `<a class="alert-open" href="${escapeHtml(leadDetailHash("excecoes", null, id))}">Abrir detalhe e corrigir no Warmbly</a>`;
  } else {
    resolution = `<p class="constraint">Correção upstream não suportada pelo allowlist atual. Próxima ação: use a orientação abaixo e registre o desfecho; não marque como resolvida só por reconhecer.</p>`;
  }
  const open = workflow !== "resolved" && workflow !== "discarded";
  return `<article class="card" data-exception-id="${escapeHtml(id)}" data-exception-status="${escapeHtml(String(row.status ?? ""))}" data-workflow-state="${escapeHtml(workflow)}" data-occurrence-count="${count}">
    <p class="kicker">${statusPill(workflow, commercialStateLabel(workflow))} · ${statusPill(String(row.kind ?? "exception"), exceptionKindLabel(String(row.kind ?? "exception")))}</p>
    <h3>${escapeHtml(String(row.why ?? row.id ?? "exceção"))}</h3>
    <dl class="facts">
      ${fact("Responsável", escapeHtml(owner), owner === "sem responsável" ? ` data-absent="true"` : "")}
      ${fact("Idade", escapeHtml(age))}
      ${fact("Impacto", escapeHtml(String(row.impact ?? "impacto não informado pela origem")))}
      ${fact("Ação recomendada", escapeHtml(String(row.recommended_next_action ?? "investigar a evidência e definir correção")))}
      ${fact("Ocorrências agrupadas", String(count))}
      ${fact("Sincronização", escapeHtml(String(row.sync_status ?? "observada na origem")))}
    </dl>
    ${row.sync_detail ? `<p class="banner error" role="alert">Erro de sincronização: ${escapeHtml(String(row.sync_detail))}. Próxima ação: releia a origem antes de repetir.</p>` : ""}
    ${resolution}
    ${technicalDetails([
      { term: "id", value: id },
      { term: "canonical_id", value: canonical },
      { term: "source_id", value: sourceId },
      { term: "workflow_state", value: workflow },
      { term: "group_key", value: String(row.group_key ?? "") },
      { term: "occurrence_ids", value: Array.isArray(row.occurrence_ids) ? row.occurrence_ids.join(",") : "" },
    ], "resolvable-exception")}
    ${open && writesAllowed ? `<div class="lead-actions" data-write-boundary="control-center">
      <form data-operator-form="ACKNOWLEDGE_EXCEPTION" data-writes-to="control-center" class="operator-form">
        <input type="hidden" name="target_canonical_id" value="${escapeHtml(canonical)}" />
        <input type="hidden" name="target_source_id" value="${escapeHtml(sourceId)}" />
        <label>Nota <textarea name="note" required minlength="2" maxlength="500"></textarea></label>
        <label class="confirm"><input type="checkbox" required name="ciencia" /> Entendo que reconhecer não resolve nem remove a exceção.</label>
        <button type="submit">Reconhecer sem resolver</button>
      </form>
      <form data-operator-form="START_EXCEPTION_WORK" data-writes-to="control-center" class="operator-form">
        <input type="hidden" name="target_canonical_id" value="${escapeHtml(canonical)}" />
        <input type="hidden" name="target_source_id" value="${escapeHtml(sourceId)}" />
        <label>Plano de tratamento <textarea name="note" required minlength="2" maxlength="500"></textarea></label>
        <button type="submit">Iniciar tratamento</button>
      </form>
    </div>` : !open ? `<p class="banner ok">Desfecho observado na origem: ${escapeHtml(commercialStateLabel(workflow))}.</p>` : ""}
  </article>`;
}

/* ------------------------------------------------------------------ */
/* Revisão editorial (Comercial -> Rascunhos)                          */
/* ------------------------------------------------------------------ */

/** Dado que não chegou. Não é vazio nem zero. */
const REVIEW_ABSENT = "ausente";
/** Campo que o servidor desta versão simplesmente não reporta. */
const REVIEW_UNREPORTED = "não informado";

const EDITORIAL_STATE_LABELS: Record<string, string> = {
  CURRENT: "atual",
  LEGACY_SUPERSEDED: "histórico, substituído",
};

const EDITORIAL_LEGACY_NOTICE =
  "Rascunho histórico: uma versão mais recente o substituiu. Fica visível para auditoria e não aceita decisão.";

function reviewText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function reviewList(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const parts = value
    .map((entry) => reviewText(entry))
    .filter((entry): entry is string => entry !== null);
  return parts.length === 0 ? null : parts.join(", ");
}

/** Valor cru para o bloco técnico. Ausente é "", e o bloco descarta "". */
function reviewTech(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    return value
      .filter((entry) => typeof entry === "string" || typeof entry === "number")
      .map(String)
      .join(",");
  }
  return String(value);
}

/**
 * Fato de leitura.
 *
 * Ausência vira palavra explícita nas linhas em que a ausência muda a decisão.
 * Onde ela não muda nada, a linha simplesmente não é emitida: uma pilha de
 * "ausente" sob uma mensagem de quatro linhas esconde a mensagem.
 */
function reviewFact(label: string, value: string | null, absentWord = REVIEW_ABSENT, extra = ""): string {
  return value === null
    ? fact(label, escapeHtml(absentWord), ` data-absent="true"`)
    : fact(label, escapeHtml(value), extra);
}

/** Rótulo em português com o token cru ao lado. Código sem tradução sai uma vez só. */
function reviewCode(raw: string, label: string): string {
  return label === raw ? raw : `${label} (${raw})`;
}

function reviewRouteClass(raw: string | null): string | null {
  return raw === null ? null : reviewCode(raw, routeClassLabel(raw));
}

/** Motivos do estado editorial em português, sem perder o código original. */
function reviewReasonCodes(codes: readonly string[]): string {
  if (codes.length === 0) return "nenhum";
  return codes.map((code) => reviewCode(code, editorialReasonLabel(code))).join("; ");
}

function reviewProvenance(row: Record<string, unknown>): string | null {
  const evidence = reviewList(row.evidence_ids);
  const source = reviewText(row.fact_source);
  if (evidence === null && source === null) return null;
  return `${evidence ?? "sem identificador de evidência"} (origem: ${source ?? REVIEW_UNREPORTED})`;
}

function reviewTargetFit(value: unknown): string | null {
  const fit = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!fit) return null;
  const state = reviewText(fit.state);
  const reason = reviewText(fit.reason);
  const asOf = reviewText(fit.as_of);
  const knownFresh = typeof fit.fresh === "boolean";
  if (state === null && asOf === null && reason === null && !knownFresh) return null;
  const freshness = knownFresh
    ? (fit.fresh === true ? "leitura atual" : "leitura desatualizada")
    : "frescor não informado";
  const parts = [freshness, `apurado em ${asOf ?? REVIEW_UNREPORTED}`];
  if (reason !== null) parts.push(reason);
  return `${state ?? REVIEW_UNREPORTED} (${parts.join("; ")})`;
}

/**
 * Altura pelo conteúdo: o fundador lê assunto e corpo inteiros na lista, sem
 * abrir nada. Os campos continuam editáveis quando a decisão é permitida.
 */
function reviewRows(text: string, min: number, max: number): number {
  const lines = text
    .split("\n")
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / 78)), 0);
  return Math.min(max, Math.max(min, lines + 1));
}

type ReviewInspectorMode = "inspect" | "edit" | "reject";

interface ReviewPageView {
  limit: number;
  offset: number;
  loadedCount: number;
  coverageStatus: "TOTAL_KNOWN" | "PAGE_ONLY" | "UNPROVEN";
  totalCount?: number;
  remainingCount?: number;
  hasMore?: boolean;
  nextOffset?: number;
}

function reviewInspectorMode(query: string | null): ReviewInspectorMode {
  const mode = new URLSearchParams(query ?? "").get("mode");
  return mode === "edit" || mode === "reject" ? mode : "inspect";
}

function reviewDraftRow(item: unknown): Record<string, unknown> {
  return item && typeof item === "object" ? (item as Record<string, unknown>) : {};
}

function reviewDraftId(item: unknown): string {
  return String(reviewDraftRow(item).id ?? "");
}

function reviewDraftActionable(item: unknown): boolean {
  const row = reviewDraftRow(item);
  return readEditorialState({ ...row, actionable: row.editorial_actionable }).actionable;
}

function reviewRouteHash(hash: string): string {
  const query = hash.split("?")[1];
  return query ? `#/comercial/rascunhos?${query}` : "#/comercial/rascunhos";
}

function reviewDraftHref(
  id: string,
  mode: ReviewInspectorMode = "inspect",
  hash = "#/comercial/rascunhos",
): string {
  return withQueryParams(reviewRouteHash(hash), {
    resource: id,
    mode: mode === "inspect" ? null : mode,
    focus: null,
  });
}

function reviewPageView(value: unknown, loadedCount: number): ReviewPageView {
  const row = reviewDraftRow(value);
  const limit = typeof row.limit === "number" && Number.isSafeInteger(row.limit) && row.limit > 0 && row.limit <= 200
    ? row.limit
    : 100;
  const offset = typeof row.offset === "number" && Number.isSafeInteger(row.offset) && row.offset >= 0
    ? row.offset
    : 0;
  const fallback: ReviewPageView = { limit, offset, loadedCount, coverageStatus: "UNPROVEN" };
  if (row.loaded_count !== loadedCount) return fallback;
  const pageEnd = offset + loadedCount;
  if (
    row.coverage_status === "TOTAL_KNOWN" &&
    typeof row.total_count === "number" && Number.isSafeInteger(row.total_count) && row.total_count >= pageEnd &&
    typeof row.remaining_count === "number" && row.remaining_count === row.total_count - pageEnd &&
    typeof row.has_more === "boolean" && row.has_more === (pageEnd < row.total_count) &&
    (!row.has_more || (loadedCount === limit && row.next_offset === pageEnd)) &&
    (row.has_more || row.next_offset === undefined)
  ) {
    return {
      ...fallback,
      coverageStatus: "TOTAL_KNOWN",
      totalCount: row.total_count,
      remainingCount: row.remaining_count,
      hasMore: row.has_more,
      ...(row.has_more ? { nextOffset: pageEnd } : {}),
    };
  }
  if (
    row.coverage_status === "PAGE_ONLY" &&
    typeof row.has_more === "boolean" &&
    (!row.has_more || (loadedCount === limit && row.next_offset === pageEnd)) &&
    (row.has_more || row.next_offset === undefined)
  ) {
    return {
      ...fallback,
      coverageStatus: "PAGE_ONLY",
      hasMore: row.has_more,
      ...(row.has_more ? { nextOffset: pageEnd } : {}),
    };
  }
  return fallback;
}

function reviewCoverage(page: ReviewPageView): string {
  if (page.coverageStatus === "TOTAL_KNOWN") {
    return `<p data-review-coverage="TOTAL_KNOWN"><strong>${page.loadedCount}</strong> carregados de <strong>${page.totalCount}</strong> no servidor; <strong>${page.remainingCount}</strong> restantes após este recorte.</p>`;
  }
  if (page.coverageStatus === "PAGE_ONLY") {
    const continuation = page.hasMore
      ? "O servidor confirmou outra página, mas não informou o total."
      : "O servidor confirmou o fim da lista, mas não informou o total.";
    return `<p data-review-coverage="PAGE_ONLY"><strong>${page.loadedCount}</strong> carregados neste recorte. ${continuation}</p>`;
  }
  return `<p data-review-coverage="UNPROVEN"><strong>${page.loadedCount}</strong> carregados neste recorte; total do servidor não informado.</p>`;
}

function reviewPagination(page: ReviewPageView, hash: string): string {
  const previousOffset = page.offset > 0 ? Math.max(0, page.offset - page.limit) : null;
  const previous = previousOffset === null
    ? `<span class="page-step" aria-disabled="true">Página anterior</span>`
    : `<a class="page-step" data-review-page="previous" href="${escapeHtml(withQueryParams(reviewRouteHash(hash), {
        offset: previousOffset === 0 ? null : String(previousOffset),
        resource: null,
        mode: null,
        focus: null,
      }))}">Página anterior</a>`;
  const next = page.hasMore === true && page.nextOffset !== undefined
    ? `<a class="page-step" data-review-page="next" href="${escapeHtml(withQueryParams(reviewRouteHash(hash), {
        offset: String(page.nextOffset),
        resource: null,
        mode: null,
        focus: null,
      }))}">Próxima página</a>`
    : `<span class="page-step" aria-disabled="true">Próxima página não provada</span>`;
  const first = page.loadedCount === 0 ? 0 : page.offset + 1;
  const last = page.offset + page.loadedCount;
  return `<nav class="pagination review-pagination" aria-label="Paginação da fila de revisão" data-review-pagination="${escapeHtml(page.coverageStatus)}">
      ${previous}<span class="page-position">Itens ${first}–${last}</span>${next}
    </nav>`;
}

function selectedReviewIndex(items: readonly unknown[], resource: string | null): number {
  const requested = resource === null ? -1 : items.findIndex((item) => reviewDraftId(item) === resource);
  if (requested >= 0) return requested;
  const actionable = items.findIndex((item) => reviewDraftActionable(item));
  return actionable >= 0 ? actionable : 0;
}

function nextActionableReviewId(items: readonly unknown[], selected: number): string | null {
  for (let offset = 1; offset < items.length; offset += 1) {
    const item = items[(selected + offset) % items.length];
    if (item !== undefined && reviewDraftActionable(item)) return reviewDraftId(item);
  }
  return null;
}

function reviewDraftListItem(item: unknown, selected: boolean, hash: string): string {
  const row = reviewDraftRow(item);
  const account = reviewDraftRow(row.account);
  const id = reviewDraftId(item);
  const routeClass = reviewText(row.route_class);
  const factUsed = reviewText(row.fact_used);
  const editorial = readEditorialState({ ...row, actionable: row.editorial_actionable });
  const company = String(account.nome_fantasia ?? account.razao_social ?? row.account_id ?? "Lead");
  const recipient = String(row.recipient ?? "destinatário ausente");
  const route = reviewRouteClass(routeClass) ?? REVIEW_UNREPORTED;
  return `<li class="review-queue-item" data-review-list-item="${escapeHtml(id)}" data-editorial-actionable="${editorial.actionable ? "true" : "false"}">
            <a data-review-row="${escapeHtml(id)}" href="${escapeHtml(reviewDraftHref(id, "inspect", hash))}" aria-current="${selected ? "page" : "false"}">
              <strong>${escapeHtml(company)}</strong>
              <span>${escapeHtml(recipient)}</span>
              <span>${escapeHtml(route)}</span>
              <span>${escapeHtml(factUsed ?? "fato observado ausente")}</span>
              ${editorial.actionable ? "" : `<span>${escapeHtml(ownMapValue(EDITORIAL_STATE_LABELS, editorial.state) ?? editorial.state)}</span>`}
            </a>
          </li>`;
}

function reviewDraftInspector(
  item: unknown,
  nextReviewId: string | null,
  mode: ReviewInspectorMode,
  hash: string,
): string {
  const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
  const account = row.account && typeof row.account === "object" ? (row.account as Record<string, unknown>) : {};
  const id = String(row.id ?? "");
  const contentHash = String(row.content_hash ?? "");
  const subject = String(row.subject ?? "");
  const bodyText = String(row.body_text ?? "");
  const rawEditorialState = reviewText(row.editorial_state);
  // Estado e acionabilidade vêm da leitura compartilhada; a regra não se repete aqui.
  const editorial = readEditorialState({ ...row, actionable: row.editorial_actionable });
  const actionable = editorial.actionable;
  const editorialReading = rawEditorialState === null
    ? "atual (não informado pelo servidor, tratado como atual)"
    : ownMapValue(EDITORIAL_STATE_LABELS, rawEditorialState) ?? rawEditorialState;
  const composerVersion = reviewText(row.composer_version);
  const notice = reviewText(editorial.notice) ?? EDITORIAL_LEGACY_NOTICE;
  const routeClass = reviewText(row.route_class);
  const routeClassAttr = routeClass === null ? "" : ` data-route-class="${escapeHtml(routeClass)}"`;
  const reasonAttr = editorial.reasonCodes.length === 0
    ? ""
    : ` data-reason-codes="${escapeHtml(editorial.reasonCodes.join(" "))}"`;
  const subjectRows = reviewRows(subject, 2, 4);
  const bodyRows = reviewRows(bodyText, 12, 40);
  const factUsed = reviewText(row.fact_used);
  const provenance = reviewProvenance(row);
  const targetFit = reviewTargetFit(row.target_fit);
  // Um corpo escrito afirma uma observação específica ao destinatário. Se o
  // fato ou a origem dele não vieram, isso não some do card: é o motivo para
  // não aprovar.
  const factGap =
    reviewText(bodyText) === null || (factUsed !== null && provenance !== null)
      ? null
      : factUsed === null && provenance === null
        ? "nem o fato observado nem a proveniência dele"
        : factUsed === null
          ? "o fato observado"
          : "a proveniência do fato";
  const factGapBanner =
    factGap === null
      ? ""
      : `<p class="banner error" role="alert" data-fact-missing="true">O rascunho afirma uma observação específica sobre este lead, mas o servidor não enviou ${escapeHtml(factGap)}. Não dá para conferir o que a mensagem diz ao destinatário: recupere a evidência antes de aprovar.</p>`;
  const contextFacts = `<dl class="facts" data-review-context="${escapeHtml(id)}">
                ${reviewFact("Fato observado", factUsed)}
                ${reviewFact("Proveniência", provenance)}
                ${reviewFact("Classe de rota", reviewRouteClass(routeClass), REVIEW_UNREPORTED, routeClassAttr)}
                ${reviewFact("Estado editorial", editorialReading)}
                ${targetFit === null ? "" : fact("Target fit", escapeHtml(targetFit))}
                ${editorial.reasonCodes.length === 0 ? "" : fact("Reason codes", escapeHtml(reviewReasonCodes(editorial.reasonCodes)), reasonAttr)}
              </dl>`;
  // Hashes, versões e códigos são prova de auditoria, não entrada da decisão.
  const auditFacts = technicalDetails(
    [
      { term: "draft_id", value: id },
      { term: "account_id", value: reviewTech(row.account_id) },
      { term: "content_hash", value: reviewTech(row.content_hash) },
      { term: "composer_version", value: reviewTech(row.composer_version) },
      { term: "prompt_version", value: reviewTech(row.prompt_version) },
      { term: "policy_version", value: reviewTech(row.policy_version) },
      { term: "route_class", value: reviewTech(row.route_class) },
      { term: "fact_source", value: reviewTech(row.fact_source) },
      { term: "evidence_ids", value: reviewTech(row.evidence_ids) },
      { term: "editorial_state", value: reviewTech(rawEditorialState) },
      { term: "editorial_reason_codes", value: editorial.reasonCodes.join(",") },
    ],
    "review-draft",
  );
  const commonHidden = `<input type="hidden" name="expected_content_hash" value="${escapeHtml(contentHash)}" />
                <input type="hidden" name="next_review_id" value="${escapeHtml(nextReviewId ?? "")}" />
                <textarea name="original_subject" hidden>${escapeHtml(subject)}</textarea>
                <textarea name="original_body_text" hidden>${escapeHtml(bodyText)}</textarea>`;
  const readOnlyMessage = `<section class="review-message" aria-labelledby="review-subject-${escapeHtml(id)}">
                <h4 id="review-subject-${escapeHtml(id)}">${escapeHtml(subject || "Assunto ausente")}</h4>
                <p data-exact-body="true">${escapeHtml(bodyText || "Corpo ausente")}</p>
              </section>`;
  const decision = !actionable
    ? `<div class="review-readonly" data-review-readonly="${escapeHtml(id)}">${readOnlyMessage}</div>`
    : mode === "edit"
      ? `<form data-review-form="${escapeHtml(id)}" data-review-mode="edit" class="operator-form review-decision-form">
                ${commonHidden}
                <input type="hidden" name="action" value="SAVE_ADJUSTMENT" />
                <label>Assunto <textarea name="subject" rows="${subjectRows}">${escapeHtml(subject)}</textarea></label>
                <label>Corpo <textarea name="body_text" rows="${bodyRows}">${escapeHtml(bodyText)}</textarea></label>
                <div class="review-actions">
                  <button type="submit" data-review-save="true">Salvar ajuste</button>
                  <a class="button" href="${escapeHtml(reviewDraftHref(id, "inspect", hash))}">Cancelar edição</a>
                </div>
              </form>`
      : mode === "reject"
        ? `${readOnlyMessage}<form data-review-form="${escapeHtml(id)}" data-review-mode="reject" class="operator-form review-decision-form">
                ${commonHidden}
                <input type="hidden" name="action" value="REJECT" />
                <textarea name="subject" hidden>${escapeHtml(subject)}</textarea>
                <textarea name="body_text" hidden>${escapeHtml(bodyText)}</textarea>
                <label>Motivo para reescrita <textarea name="reason" rows="4" required></textarea></label>
                <div class="review-actions">
                  <button type="submit" data-review-reject="true">Rejeitar e solicitar reescrita</button>
                  <a class="button" href="${escapeHtml(reviewDraftHref(id, "inspect", hash))}">Cancelar rejeição</a>
                </div>
              </form>`
        : `${readOnlyMessage}<form data-review-form="${escapeHtml(id)}" data-review-mode="approve" class="operator-form review-decision-form approve-form">
                ${commonHidden}
                <input type="hidden" name="action" value="APPROVE" />
                <textarea name="subject" hidden>${escapeHtml(subject)}</textarea>
                <textarea name="body_text" hidden>${escapeHtml(bodyText)}</textarea>
                <div class="review-actions">
                  <button type="submit" data-approve-submit="true">Aprovar e agendar para ${escapeHtml(String(row.recipient ?? "destinatário ausente"))}</button>
                  <a class="button" data-review-edit="true" href="${escapeHtml(reviewDraftHref(id, "edit", hash))}">Editar</a>
                  <a class="button" data-review-reject="true" href="${escapeHtml(reviewDraftHref(id, "reject", hash))}">Rejeitar/segurar</a>
                </div>
              </form>`;
  return `<article class="card review-draft review-inspector" tabindex="-1" data-review-inspector="${escapeHtml(id)}" data-draft-id="${escapeHtml(id)}" data-state="${escapeHtml(String(row.state ?? ""))}" data-editorial-state="${escapeHtml(editorial.state)}" data-editorial-actionable="${actionable ? "true" : "false"}" data-composer-version="${escapeHtml(composerVersion ?? "")}">
              <p class="kicker">${escapeHtml(String(row.state ?? ""))} · ${escapeHtml(String(row.purpose ?? ""))} · toque ${escapeHtml(String(row.ordinal ?? ""))}</p>
              <h3>${escapeHtml(String(account.nome_fantasia ?? account.razao_social ?? row.account_id ?? "Lead"))}</h3>
              <p>Destinatário: ${escapeHtml(String(row.recipient ?? "ausente"))}</p>
              <p>Razão: ${escapeHtml(String(row.stop_reason ?? row.generation_error ?? "pronto para revisão"))}</p>
              ${actionable ? "" : `<p class="banner stale" role="note" data-editorial-notice="true">${escapeHtml(notice)}</p>`}
              ${factGapBanner}
              ${contextFacts}
              ${decision}
              ${auditFacts}
            </article>`;
}

function commercialOps(
  snapshot: CommercialSnapshot,
  surface: string | null,
  resource: string | null = null,
  query: string | null = null,
  hash = "#/comercial",
): string {
  const ops = operationsOf(snapshot);
  const listViews = ops.list_views && typeof ops.list_views === "object"
    ? (ops.list_views as Record<string, unknown>)
    : {};
  const overview = ops.overview && typeof ops.overview === "object"
    ? (ops.overview as Record<string, unknown>)
    : {};
  const current = surface && surface.length > 0 ? surface : "visao";
  const auto = ops.auto_send && typeof ops.auto_send === "object" ? (ops.auto_send as Record<string, unknown>) : {};
  const cohorts = ops.cohorts && typeof ops.cohorts === "object" ? (ops.cohorts as Record<string, unknown>) : {};
  const activity = Array.isArray(ops.activity) ? ops.activity : [];
  const pipeline = Array.isArray(ops.pipeline) ? ops.pipeline : [];
  const exceptions = Array.isArray(ops.exceptions) ? ops.exceptions : [];
  const reviewDrafts = Array.isArray(ops.review_drafts) ? ops.review_drafts : [];
  const reviewPage = reviewPageView(ops.review_draft_page, reviewDrafts.length);
  const availability = snapshot.availability ?? "UNKNOWN";
  let body = "";
  if (current === "rascunhos") {
    const selectedIndex = reviewDrafts.length === 0 ? -1 : selectedReviewIndex(reviewDrafts, resource);
    const selectedDraft = selectedIndex >= 0 ? reviewDrafts[selectedIndex] : undefined;
    const selectedId = selectedDraft === undefined ? null : reviewDraftId(selectedDraft);
    const selectionFellBack = resource !== null && resource !== selectedId;
    const nextReviewId = selectedIndex < 0 ? null : nextActionableReviewId(reviewDrafts, selectedIndex);
    const mode = reviewInspectorMode(query);
    body = `<section aria-labelledby="rascunhos-title" data-review-workbench-count="${reviewDrafts.length}"><h2 id="rascunhos-title">Revisão editorial</h2>
      <p class="constraint">Aprovar vincula o hash exato e agenda a próxima janela útil. Nenhum botão envia imediatamente.</p>
      ${reviewCoverage(reviewPage)}
      ${selectionFellBack ? `<p class="banner stale" role="status" data-review-selection-fallback="true">A mensagem solicitada não está neste recorte; mostrando a próxima mensagem disponível.</p>` : ""}
      ${reviewDrafts.length === 0
        ? `<p class="banner empty">Nenhum rascunho aguardando revisão.</p>`
        : `<div class="review-workbench">
            <nav class="review-queue-panel" aria-label="Mensagens aguardando revisão">
              <ol class="review-queue">${reviewDrafts.map((item, index) => reviewDraftListItem(item, index === selectedIndex, hash)).join("")}</ol>
            </nav>
            ${selectedDraft === undefined ? "" : reviewDraftInspector(selectedDraft, nextReviewId, mode, hash)}
          </div>`}
      ${reviewPagination(reviewPage, hash)}
    </section>`;
  } else if (current === "cohorts") {
    const acquisition = Array.isArray(cohorts.acquisition) ? cohorts.acquisition : [];
    const inbound = cohorts.inbound_truth && typeof cohorts.inbound_truth === "object" ? (cohorts.inbound_truth as Record<string, unknown>) : {};
    const mixingRule = String(cohorts.mixing_rule ?? "");
    body = `
      <section class="stack" aria-labelledby="cohorts-title">
        <h2 id="cohorts-title">Coortes</h2>
        <p class="constraint">${mixingRule ? escapeHtml(cohortMixingLabel(mixingRule)) : "Coortes de aquisição e métricas por período são apresentadas separadamente."}</p>
        ${technicalDetails([{ term: "mixing_rule", value: mixingRule }], "cohort-mixing-rule")}
        <div class="cards">${acquisition
          .map((item) => {
            const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
            const kind = String(row.kind ?? "");
            const anchorLabel = String(row.anchor_label ?? "");
            return `<article class="card" data-cohort-window="${escapeHtml(String(row.window ?? ""))}" data-cohort-kind="${escapeHtml(kind)}">
              <h3>Janela ${escapeHtml(cohortWindowLabel(String(row.window ?? "")))} · ${escapeHtml(cohortKindLabel(kind))}</h3>
              <p>${anchorLabel ? escapeHtml(cohortAnchorLabel(anchorLabel)) : "Referência da métrica não informada."}</p>
              <dl class="facts">
                ${fact("População", String(row.population ?? "—"))}
                ${fact("Contactados", String(row.contacted ?? "—"))}
                ${fact("Taxa de resposta", metricRate(row.reply_rate))}
                ${fact("Taxa de resposta qualificada", metricRate(row.qualified_reply_rate))}
                ${fact("Conversão em oportunidade", metricRate(row.opportunity_conversion))}
                ${fact("Conversão em fechamento", metricRate(row.win_conversion))}
              </dl>
              ${technicalDetails(
                [
                  { term: "kind", value: kind },
                  { term: "window", value: String(row.window ?? "") },
                  { term: "anchor_event", value: String(row.anchor_event ?? "") },
                  { term: "anchor_label", value: anchorLabel },
                  { term: "source", value: String(row.source ?? "") },
                ],
                "acquisition-cohort",
              )}
            </article>`;
          })
          .join("")}</div>
        <article class="card">
          <h3>Origem das mensagens recebidas (Warmbly)</h3>
          <p>${inbound.anchor_label ? escapeHtml(cohortAnchorLabel(String(inbound.anchor_label))) : "Placar do Warmbly, quando presente. Não é coorte de aquisição."}</p>
          <p>${inbound.configured === true ? "Configurado no Warmbly." : "Não configurado no Warmbly."}</p>
          ${technicalDetails(
            [
              { term: "configured", value: inbound.configured === undefined ? "" : String(inbound.configured) },
              { term: "schema", value: String(inbound.schema ?? "") },
              { term: "kind", value: String(inbound.kind ?? "") },
              { term: "anchor_event", value: String(inbound.anchor_event ?? "") },
              { term: "anchor_label", value: String(inbound.anchor_label ?? "") },
            ],
            "inbound-truth",
          )}
        </article>
      </section>
      ${controlledEmailCohort(ops)}
      <article class="card" data-dispatch-moved="true">
        <h3>Controles de disparo do Warmbly</h3>
        <p>Pausar, retomar e reconhecer alertas saíram desta aba. Eles agora vivem em <a href="#/warmbly">Operação Warmbly</a>, junto do estado do outbound, da janela comercial, da fila, dos limites e da trilha de auditoria.</p>
      </article>
      `;
  } else if (current === "atividade" && resource) {
    // Detail sub-surface (#66). Owns its own back link, so the queue below is
    // replaced wholesale rather than rendered underneath it.
    body = leadDetailBlock({ snapshot, resource, query, surface: current });
  } else if (current === "atividade") {
    body = renderFilteredList({
      spec: ACTIVITY_LIST,
      rows: rowsOf(activity),
      hash,
      generatedAt: snapshot.generated_at,
      headingId: "atividade-title",
      heading: "Atividade recente",
      noun: "atividade(s) observada(s)",
      emptyData: "Sem atividade observada neste recorte. Ausência não é zero.",
      card: (row, position) => activityOpsCard(row, query, position),
      remote: listViews.atividade,
      declaredTotal: typeof overview.activity === "number" ? overview.activity : activity.length,
      complete: typeof overview.activity === "number" ? overview.activity === activity.length : true,
    });
  } else if (current === "pipeline") {
    body = `<section aria-labelledby="pipeline-title"><h2 id="pipeline-title">Pipeline ativo</h2><div class="stack">${
      pipeline.length === 0
        ? `<p class="banner empty">Sem negócios observados. Ausência não é zero.</p>`
        : pipeline
            .map((item) => {
              const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
              const stage = String(row.stage ?? row.status ?? "unknown");
              const status = String(row.status ?? "unknown");
              return `<article class="card" data-stale="${row.stale === true ? "true" : "false"}" data-stage="${escapeHtml(stage)}" data-status="${escapeHtml(status)}">
                <p class="kicker">${statusPill(stage, pipelineStageLabel(stage))} ${row.stale === true ? "· dado defasado" : ""}</p>
                <h3>${escapeHtml(String(row.display_name ?? row.id ?? "negócio"))}</h3>
                ${dealMoneyLine(row.value)}
                <dl class="facts">
                  ${fact("Próxima ação", escapeHtml(String(row.next_action ?? "ausente")))}
                  ${fact("Idade (segundos)", escapeHtml(String(row.age_seconds ?? "—")))}
                </dl>
                ${technicalDetails(
                  [
                    { term: "id", value: String(row.id ?? "") },
                    { term: "stage", value: String(row.stage ?? "") },
                    { term: "status", value: String(row.status ?? "") },
                  ],
                  "pipeline-deal",
                )}
              </article>`;
            })
            .join("")
    }</div></section>`;
  } else if (current === "excecoes") {
    body = renderFilteredList({
      spec: EXCEPTION_LIST,
      rows: rowsOf(exceptions),
      hash,
      generatedAt: snapshot.generated_at,
      headingId: "excecoes-ops-title",
      heading: "Exceções comerciais",
      noun: "exceção(ões) observada(s)",
      emptyData: "Nenhuma exceção observada.",
      intro: `<p class="constraint" data-operator-scope="control-center-only">Reconhecer no Control Center é um registro de auditoria local. Isto não resolve a exceção no Warmbly.</p>`,
      card: (row, position) => exceptionOpsCard(row, position.writesAllowed),
      remote: listViews.excecoes,
      declaredTotal: typeof overview.exceptions === "number" ? overview.exceptions : exceptions.length,
      complete: typeof overview.exceptions === "number" ? overview.exceptions === exceptions.length : true,
    });
  } else {
    body = `<section aria-labelledby="comercial-ops-title">
      <h2 id="comercial-ops-title">Operação agora</h2>
      <dl class="facts">
        ${fact("Disponibilidade da origem", escapeHtml(availabilityLabel(String(availability))), ` data-availability="${escapeHtml(String(availability))}"`)}
        ${fact("Envio automático", auto.enabled === true ? "observado ligado — o Control Center não liga envio" : "desligado")}
        ${fact("Exceções", escapeHtml(String(overview.exceptions ?? "—")))}
        ${fact("Trabalho em atraso", escapeHtml(String(overview.overdue_work ?? "—")))}
        ${fact("Mensagens recebidas a tratar", escapeHtml(String(overview.inbound_requiring_attention ?? "—")))}
        ${fact("Oportunidades a agir", escapeHtml(String(overview.opportunities_requiring_action ?? "—")))}
      </dl>
      ${technicalDetails([{ term: "availability", value: String(availability) }], "commercial-availability")}
    </section>
    ${weeklyRevenueBlock(ops, snapshot.generated_at)}`;
  }
  return body;
}

export function financeBlock(snapshot: FinanceSnapshot): string {
  const mrr =
    snapshot.mrr && snapshot.mrr.applicable
      ? moneyFact("Receita recorrente mensal (aplicável)", snapshot.mrr)
      : fact("Receita recorrente mensal", "omitida — não aplicável");
  const runway =
    snapshot.runway && snapshot.runway.cash_reliable && snapshot.runway.expense_reliable
      ? fact("Fôlego de caixa", `${snapshot.runway.months} mês(es)`)
      : fact("Fôlego de caixa", "omitido — caixa e despesas não confiáveis");
  return `
    <section class="compact domain-financeiro" aria-labelledby="financeiro-recorte" data-domain="finance">
      <h2 id="financeiro-recorte">Recorte financeiro (somente leitura)</h2>
      <p class="constraint" role="note">Mutações de provedor: ${escapeHtml(providerMutationLabel(snapshot.provider_mutations))}. Este recorte é ${escapeHtml(authorityLabel("read_model_only"))}: sem cobrança, checkout, estorno, cancelamento ou escrita no Asaas.</p>
      ${technicalDetails(
        [
          { term: "schema_version", value: snapshot.schema_version },
          { term: "provider_mutations", value: snapshot.provider_mutations },
          { term: "read_model_only", value: String(snapshot.read_model_only) },
        ],
        "finance-authority",
      )}
      <dl class="facts">
        ${snapshot.contracted ? moneyFact("Contratado", snapshot.contracted) : fact("Contratado", helpTerm("ausente", ABSENT_HELP), ` data-absent="true"`)}
        ${snapshot.billed ? moneyFact("Faturado", snapshot.billed) : fact("Faturado", helpTerm("ausente", ABSENT_HELP), ` data-absent="true"`)}
        ${snapshot.paid ? moneyFact("Pago", snapshot.paid) : fact("Pago", helpTerm("ausente", ABSENT_HELP), ` data-absent="true"`)}
        ${snapshot.effectively_received ? moneyFact("Efetivamente recebido", snapshot.effectively_received) : fact("Efetivamente recebido", helpTerm("ausente", ABSENT_HELP), ` data-absent="true"`)}
        ${optionalMoney("Vencido", snapshot.overdue ?? snapshot.receivables_overdue)}
        ${optionalMoney("A receber", snapshot.receivable ?? snapshot.receivables_open)}
        ${snapshot.refunds ? moneyFact("Estornos", snapshot.refunds) : fact("Estornos", helpTerm("ausente", ABSENT_HELP), ` data-absent="true"`)}
        ${snapshot.chargebacks ? moneyFact("Contestações de pagamento", snapshot.chargebacks) : fact("Contestações de pagamento", helpTerm("ausente", ABSENT_HELP), ` data-absent="true"`)}
        ${mrr}
        ${runway}
        ${optionalMoney("Recebíveis abertos", snapshot.receivables_open)}
        ${optionalMoney("Recebíveis em atraso", snapshot.receivables_overdue)}
      </dl>
      ${provenanceBlock(snapshot.provenance)}
    </section>
  `;
}

export function engineeringBlock(snapshot: EngineeringSnapshot): string {
  const hypo = snapshot.active_work_without_evidence
    ? fact(
        "Trabalho ativo sem evidência",
        escapeHtml(snapshot.active_work_without_evidence.detail ?? "permanece hipótese"),
        ` data-hypothesis="true"`,
      )
    : "";
  return `
    <section class="compact domain-engenharia" aria-labelledby="engenharia-recorte" data-domain="engineering">
      <h2 id="engenharia-recorte">Recorte de engenharia</h2>
      <dl class="facts">
        ${snapshot.repository ? fact("Repositório", escapeHtml(snapshot.repository)) : ""}
        ${snapshot.default_branch ? fact("Branch padrão", escapeHtml(snapshot.default_branch)) : ""}
        <div><dt>Pull requests abertos</dt><dd>${snapshot.open_pr_count}</dd></div>
        <div><dt>Integração contínua</dt><dd>${snapshot.failing_check_count} falhando${snapshot.ci?.status ? ` · ${escapeHtml(snapshot.ci.status)}` : ""}</dd></div>
        ${typeof snapshot.p0_count === "number" || typeof snapshot.p1_count === "number" ? fact("Prioridade 0 / prioridade 1", `P0 ${snapshot.p0_count ?? 0} · P1 ${snapshot.p1_count ?? 0}`) : ""}
        ${snapshot.aging ? fact("Itens envelhecidos", `${snapshot.aging.count ?? 0}${typeof snapshot.aging.oldest_days === "number" ? ` · mais antigo há ${snapshot.aging.oldest_days} dia(s)` : ""}`) : ""}
        ${listFact("Bloqueios", snapshot.blockers)}
        ${snapshot.last_evidence ? fact("Última evidência", escapeHtml(snapshot.last_evidence)) : ""}
        ${hypo}
        <div><dt>Verificações falhando</dt><dd>${snapshot.failing_check_count}</dd></div>
        <div><dt>Incidentes abertos</dt><dd>${snapshot.open_incident_count}</dd></div>
        ${listFact("Lista de permissões", snapshot.allowlist)}
      </dl>
      ${
        snapshot.repos && snapshot.repos.length > 0
          ? `<div class="stack">${snapshot.repos
              .map((repo) => {
                const name = String(repo.repository ?? repo.full_name ?? "repo");
                return `<article class="card">
                  <h3>${escapeHtml(name)}</h3>
                  <dl class="facts">
                    ${fact("Pull requests abertos", String(repo.open_pr_count ?? "—"))}
                    ${fact("Rascunho / prontos", `${repo.draft_pr_count ?? "—"} / ${repo.ready_pr_count ?? "—"}`)}
                    ${fact("Verificações falhando", String(repo.failing_check_count ?? "—"))}
                    ${fact("Última atividade", String(repo.last_activity_at ?? "—"))}
                  </dl>
                  <p><a href="https://github.com/${escapeHtml(name)}" rel="noreferrer">Abrir no GitHub</a></p>
                </article>`;
              })
              .join("")}</div>`
          : ""
      }
      ${provenanceBlock(snapshot.provenance)}
    </section>
  `;
}

function sourcePresence(label: string, key: string, value: string | undefined): string {
  const status = value && value.length > 0 ? value : "UNKNOWN";
  const absent =
    status === "UNKNOWN" ||
    status === "NO_DATA" ||
    status === "NOT_CONFIGURED" ||
    status === "BLOCKED_BY_SECRET";
  // `data-client-source` e `data-absent` seguem com o enum cru; só o texto muda.
  const shown = absent
    ? helpTerm(availabilityLabel(status), status === "BLOCKED_BY_SECRET" ? BLOCKED_HELP : ABSENT_HELP)
    : escapeHtml(availabilityLabel(status));
  return fact(
    label,
    shown,
    ` data-client-source="${escapeHtml(key)}" data-source-status="${escapeHtml(status)}"${absent ? ` data-absent="true"` : ""}`,
  );
}

export function clientCard(item: ClientStatus): string {
  const money = item.open_receivables
    ? `<p class="money" data-amount-cents="${item.open_receivables.amount_cents}" data-currency="${escapeHtml(item.open_receivables.currency)}">${escapeHtml(formatMoney(item.open_receivables))}</p>`
    : "";
  const due = item.due_date
    ? `<time datetime="${escapeHtml(item.due_date)}">${escapeHtml(formatLocal(item.due_date))}</time>`
    : "";
  const sources = item.sources ?? {};
  return `
    <article class="card client" data-lifecycle="${escapeHtml(item.lifecycle)}" data-id="${escapeHtml(item.id)}">
      <header>
        <p class="kicker">${statusPill(item.lifecycle, clientLifecycleLabel(item.lifecycle))} <span class="scope" data-scope="${escapeHtml(item.scope)}">${escapeHtml(scopeLabel(item.scope))}</span></p>
        <h3>${escapeHtml(item.display_name)}</h3>
      </header>
      ${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ""}
      ${money}
      <dl class="facts">
        <div><dt>Cliente</dt><dd>${escapeHtml(item.display_name)}</dd></div>
        ${item.health ? fact("Saúde", escapeHtml(clientLifecycleLabel(item.health))) : fact("Saúde", escapeHtml(clientLifecycleLabel(item.lifecycle)))}
        ${listFact("Compromissos", item.commitments)}
        ${item.owner ? fact("Responsável", escapeHtml(item.owner)) : ""}
        ${due ? fact("Vencimento", due) : ""}
        ${listFact("Entregáveis", item.deliverables)}
        ${listFact("Bloqueios", item.blockers)}
        ${item.next_action ? fact("Próxima ação", escapeHtml(item.next_action)) : ""}
        ${item.evidence ? fact("Evidência", escapeHtml(item.evidence)) : ""}
        ${sourcePresence("Warmbly", "warmbly", sources.warmbly)}
        ${sourcePresence("Asaas", "asaas", sources.asaas)}
        ${sourcePresence("Governance", "governance", sources.governance)}
      </dl>
      ${technicalDetails(
        [
          { term: "id", value: item.id },
          { term: "client_slug", value: item.client_slug ?? "" },
          { term: "scope", value: item.scope },
          { term: "lifecycle", value: item.lifecycle },
          { term: "schema_version", value: item.schema_version },
        ],
        "client",
      )}
      ${provenanceBlock(item.provenance)}
    </article>
  `;
}

/**
 * A record without a usable identity, rendered as a data-quality / join-queue
 * entry rather than as a client.
 *
 * Every field comes from the producer's own queue entry: it is the only party
 * that knows where the record came from, why it has no identity, and which
 * correction clears that particular reason. The placeholder card this replaces
 * offered none of the three.
 */
export function clientIdentityQueueCard(entry: ClientIdentityException): string {
  const origin = sourceSystemLabel(entry.origin.system);
  return `
    <article class="card data-quality" data-queue="client-identity" data-id="${escapeHtml(entry.id)}" data-operational-client="false" data-status="${escapeHtml(entry.status)}">
      <header>
        <p class="kicker"><span class="pill">sem identidade</span> <span class="scope">fila de qualidade de dados</span></p>
        <h3>Registro sem identidade de cliente</h3>
      </header>
      <p class="constraint">Não é um cliente. Não entra em contagens de clientes nem em alertas de risco.</p>
      <dl class="facts">
        ${fact("Origem", escapeHtml(origin))}
        ${entry.source_id ? fact("Registro na origem", escapeHtml(entry.source_id)) : ""}
        ${fact("Motivo", escapeHtml(entry.why))}
        ${fact("Ação necessária", escapeHtml(entry.recommended_next_action))}
      </dl>
      ${technicalDetails(
        [
          { term: "sistema", value: entry.origin.system },
          { term: "locator", value: entry.origin.locator },
          { term: "reason_codes", value: entry.reason_codes.join(",") },
          { term: "source_id", value: entry.source_id ?? "" },
        ],
        "client-identity-queue",
      )}
      ${entry.provenance ? provenanceBlock(entry.provenance) : ""}
    </article>
  `;
}

function checkLine(label: string, value: { status?: string; detail?: string } | undefined): string {
  if (!value) return "";
  const status = value.status ? healthLabel(value.status) : "";
  return fact(
    label,
    escapeHtml([status, value.detail].filter(Boolean).join(" · ")),
    value.status ? ` data-check-status="${escapeHtml(value.status)}"` : "",
  );
}

const HEALTH_LABELS: Record<ServiceHealth["status"], string> = {
  healthy: "saudável",
  degraded: "degradado",
  down: "fora do ar",
  unknown: "sem conclusão",
};

/**
 * Why this row is a defect, per code. A single hardcoded sentence used to claim
 * the origin gave no identity even for ambiguous_service_id, where it gave two
 * — and two distinct ids colliding is the entire problem. An unrecognised code
 * gets no invented cause: the code itself is the whole statement.
 */
export function catalogErrorExplanation(code: string): string {
  switch (code) {
    case "missing_service_identity":
      return "A origem não informou identidade para este serviço.";
    case "ambiguous_service_id":
      return "Duas entradas distintas do catálogo produzem o mesmo identificador. Os serviços seguem separados; corrigir os ids na origem.";
    default:
      return "Código não reconhecido por esta versão do cockpit; nenhuma causa é presumida.";
  }
}

interface PresentedHealth {
  readonly status: ServiceHealth["status"];
  readonly conclusive: boolean;
}

/**
 * "Saudável" is a conclusion, and a conclusion needs evidence. A row whose
 * freshness is not FRESH, or whose confidence is zero — not configured,
 * blocked, or failed collection — has none, so the card refuses to print the
 * word and says "sem conclusão" instead. The raw value stays on the element as
 * data-raw-status so nothing is hidden, only un-asserted.
 */
export function presentHealth(item: ServiceHealth): PresentedHealth {
  const conclusive =
    item.evidence_conclusive !== false &&
    item.provenance.freshness_status === "FRESH" &&
    item.provenance.confidence > 0;
  if (!conclusive && item.status === "healthy") {
    return { status: "unknown", conclusive: false };
  }
  return { status: item.status, conclusive };
}

export function healthCard(item: ServiceHealth): string {
  const presented = presentHealth(item);
  const tone = presented.status === "healthy" && presented.conclusive ? "green" : "not-green";
  const confidence = item.provenance.confidence.toFixed(2).replace(".", ",");
  const degraded = presented.status !== "healthy";
  const runbook = degraded ? item.runbook_url : undefined;
  const inconclusive = presented.conclusive
    ? ""
    : `<p class="constraint" data-inconclusive="true">Sem evidência conclusiva: atualização ${escapeHtml(
        freshnessLabel(item.provenance.freshness_status),
      )}, confiança ${escapeHtml(confidence)}. Nenhum estado conclusivo é afirmado para este serviço.</p>`;
  // Doubt about the collector run is stated, never folded into the service's
  // own status: one probe that timed out must not repaint a host that answered.
  const snapshotCaveat =
    item.snapshot_evidence && !item.snapshot_evidence.conclusive
      ? `<p class="constraint" data-snapshot-evidence="${escapeHtml(
          item.snapshot_evidence.freshness_status,
        )}">Coleta que trouxe este serviço: ${escapeHtml(
          freshnessLabel(item.snapshot_evidence.freshness_status),
        )}, confiança ${escapeHtml(
          item.snapshot_evidence.confidence.toFixed(2).replace(".", ","),
        )}. O estado abaixo vem da evidência do próprio serviço.</p>`
      : "";
  const catalogError = item.catalog_error
    ? `<p class="constraint" data-catalog-error="${escapeHtml(item.catalog_error)}">Erro de catálogo/telemetria. ${escapeHtml(catalogErrorExplanation(item.catalog_error))}</p>`
    : "";
  const duplicates =
    item.duplicate_count && item.duplicate_count > 1
      ? `<p class="constraint" data-duplicate-count="${item.duplicate_count}">${item.duplicate_count} entradas idênticas do catálogo agrupadas neste card.</p>`
      : "";
  const runbookFact = degraded
    ? runbook
      ? fact(
          "Runbook",
          `<a class="wrap-any" href="${escapeHtml(runbook)}" rel="noreferrer noopener">${escapeHtml(runbook)}</a>`,
        )
      : fact("Runbook", escapeHtml("não cadastrado no catálogo"), ` data-absent="true"`)
    : "";
  return `
    <article class="card health" data-status="${escapeHtml(presented.status)}" data-raw-status="${escapeHtml(item.status)}" data-id="${escapeHtml(item.id)}" data-tone="${tone}" data-conclusive="${presented.conclusive ? "true" : "false"}" data-partial-outage="${item.partial_outage === true ? "true" : "false"}">
      <header>
        <p class="kicker">${statusPill(presented.status, ownMapValue(HEALTH_LABELS, presented.status) ?? "estado de saúde não reconhecido")} <span class="sr-only">${escapeHtml(
          ownMapValue(HEALTH_LABELS, presented.status) ?? "estado de saúde não reconhecido",
        )}</span> <span class="scope" data-scope="${escapeHtml(item.scope)}">${escapeHtml(scopeLabel(item.scope))}</span></p>
        <h3>${escapeHtml(item.service_name)}</h3>
      </header>
      ${catalogError}
      ${snapshotCaveat}
      ${inconclusive}
      ${duplicates}
      ${item.message ? `<p>${escapeHtml(item.message)}</p>` : ""}
      ${item.partial_outage ? `<p class="constraint">Indisponibilidade parcial</p>` : ""}
      <dl class="facts">
        ${fact("Função", escapeHtml(item.role ?? "não declarada no catálogo"), item.role ? "" : ` data-absent="true"`)}
        ${fact("Endpoint lógico", `<span class="wrap-any">${escapeHtml(item.endpoint ?? "não declarado no catálogo")}</span>`, item.endpoint ? "" : ` data-absent="true"`)}
        ${item.service_id ? fact("Id no catálogo", escapeHtml(item.service_id)) : ""}
        ${fact(
          "Última verificação",
          `<time datetime="${escapeHtml(item.checked_at)}">${escapeHtml(formatLocal(item.checked_at))}</time>`,
        )}
        ${fact("Estado avaliado", escapeHtml(ownMapValue(HEALTH_LABELS, presented.status) ?? "estado de saúde não reconhecido"))}
        ${fact(
          item.latency_check ? `Latência observada (${item.latency_check})` : "Latência observada",
          item.latency_ms !== undefined
            ? escapeHtml(`${item.latency_ms} ms`)
            : escapeHtml("não medida (sem sonda de tempo neste serviço)"),
          item.latency_ms === undefined ? ` data-absent="true"` : "",
        )}
        ${fact("Atualização", escapeHtml(freshnessLabel(item.provenance.freshness_status)))}
        ${fact(
          "Erro recente",
          escapeHtml(item.last_error ?? "nenhum erro registrado nesta coleta"),
          item.last_error ? "" : ` data-absent="true"`,
        )}
        ${checkLine("Resposta HTTP", item.http)}
        ${checkLine("Certificado TLS", item.tls)}
        ${checkLine("Contêiner Docker", item.docker)}
        ${checkLine("Backup", item.backup)}
        ${checkLine("Host", item.host_metrics)}
        ${item.disk ? fact("Disco", escapeHtml(item.disk.detail ?? `${item.disk.used_pct ?? "?"}%`)) : ""}
        ${item.memory ? fact("Memória", escapeHtml(item.memory.detail ?? `${item.memory.used_pct ?? "?"}%`)) : ""}
        ${runbookFact}
        ${
          item.pncp_freshness
            ? fact(
                "Atualização do PNCP",
                escapeHtml(
                  `${freshnessLabel(item.pncp_freshness.freshness_status)}${item.pncp_freshness.detail ? ` · ${item.pncp_freshness.detail}` : ""}`,
                ),
                ` data-pncp-freshness="${escapeHtml(item.pncp_freshness.freshness_status)}"`,
              )
            : ""
        }
      </dl>
      ${technicalDetails(
        [
          { term: "id", value: item.id },
          { term: "service_name", value: item.service_name },
          { term: "status", value: item.status },
          { term: "scope", value: item.scope },
          { term: "catalog_error", value: item.catalog_error ?? "" },
          { term: "partial_outage", value: item.partial_outage === undefined ? "" : String(item.partial_outage) },
        ],
        "service-health",
      )}
      ${provenanceBlock(item.provenance)}
    </article>
  `;
}

const CATALOG_REASON_LABELS: Record<string, string> = {
  NOT_CONFIGURED: "coletor não configurado neste ambiente",
  BLOCKED_BY_SECRET: "credencial ausente; coleta bloqueada",
  UPSTREAM_ERROR: "erro na origem durante a coleta",
  UNKNOWN: "coleta sem evidência utilizável",
  STALE: "coleta mais antiga que a janela de frescor",
  collect_failed: "a coleta falhou",
  timeout: "a coleta excedeu o tempo limite",
};

/**
 * Why the Infra evidence is worth what it is worth. Confidence 0,00 alone
 * cannot tell "never configured" from "the probe failed", and that ambiguity is
 * the operator's complaint, so the reason is named on screen.
 */
export function infraCatalogBlock(summary: InfraCatalogSummary): string {
  const reason = summary.unavailability_reason ?? summary.availability;
  const reasonLabel = reason ? (ownMapValue(CATALOG_REASON_LABELS, reason) ?? "motivo não reconhecido") : undefined;
  const confidence = summary.confidence.toFixed(2).replace(".", ",");
  return `
    <dl class="facts catalog" data-catalog-summary="true" data-freshness="${escapeHtml(summary.freshness_status)}" data-catalog-errors="${summary.catalog_error_count ?? 0}">
      ${fact("Serviços monitorados", escapeHtml(String(summary.monitored_service_count ?? "desconhecido")))}
      ${fact("Evidência da coleta", escapeHtml(`${freshnessLabel(summary.freshness_status)} · confiança ${confidence}`))}
      ${
        reasonLabel
          ? fact("Motivo", escapeHtml(reasonLabel), ` data-reason="${escapeHtml(reason ?? "")}"`)
          : fact("Motivo", escapeHtml("coleta íntegra"), ` data-absent="true"`)
      }
      ${
        summary.catalog_error_count !== undefined
          ? fact("Erros de catálogo/telemetria", escapeHtml(String(summary.catalog_error_count)))
          : ""
      }
      ${
        summary.duplicate_group_count !== undefined
          ? fact("Duplicatas agrupadas", escapeHtml(String(summary.duplicate_group_count)))
          : ""
      }
    </dl>
    ${technicalDetails(
      [
        { term: "freshness_status", value: summary.freshness_status },
        { term: "availability", value: summary.availability ?? "" },
        { term: "unavailability_reason", value: summary.unavailability_reason ?? "" },
      ],
      "infra-catalog-summary",
    )}
  `;
}

export function directiveCard(item: Directive): string {
  const expires = item.expires_at ?? "sem expiração";
  const supersedes = item.supersedes?.join(", ") ?? "nenhuma";
  const kindLabel = directiveKindLabel(item.kind);
  const actor = item.created_by.display_name ?? item.created_by.id;
  return `
    <article class="card directive" data-kind="${escapeHtml(item.kind)}" data-status="${escapeHtml(item.status)}" data-id="${escapeHtml(item.id)}">
      <header>
        <p class="kicker">${statusPill(item.kind, kindLabel)} ${statusPill(item.status, directiveStatusLabel(item.status))} <span class="scope" data-scope="${escapeHtml(item.scope)}">${escapeHtml(scopeLabel(item.scope))}</span></p>
        <h3>${escapeHtml(item.title)}</h3>
      </header>
      <p>${escapeHtml(item.body)}</p>
      <dl class="facts">
        <div><dt>Vigente desde</dt><dd><time datetime="${escapeHtml(item.effective_from)}">${escapeHtml(item.effective_from)}</time></dd></div>
        <div><dt>Expira</dt><dd>${escapeHtml(expires)}</dd></div>
        <div><dt>Substitui</dt><dd>${escapeHtml(supersedes)}</dd></div>
        <div><dt>Revisões / substituições</dt><dd>${escapeHtml(supersedes)}</dd></div>
        <div><dt>Criado por</dt><dd>${escapeHtml(actor)}</dd></div>
      </dl>
      <p class="audit">Auditoria: ${item.audit.length} evento(s). Origem do dado no recorte de memória.</p>
      ${technicalDetails(
        [
          { term: "id", value: item.id },
          { term: "kind", value: item.kind },
          { term: "status", value: item.status },
          { term: "scope", value: item.scope },
          { term: "schema_version", value: item.schema_version },
          { term: "created_by", value: item.created_by.id },
        ],
        "directive",
      )}
    </article>
  `;
}

export function activityCard(item: AgentActivity): string {
  const statusLabel = agentStatusLabel(item.presentation_status);
  const staleRunning =
    item.presentation_status === "RUNNING" && item.provenance.freshness_status === "STALE"
      ? `<p class="constraint" data-stale-running="true">Em execução com observação defasada continua em execução — não vira concluído.</p>`
      : "";
  return `
    <article class="card session activity" data-status="${escapeHtml(item.presentation_status)}" data-raw-status="${escapeHtml(item.status)}" data-id="${escapeHtml(item.id)}">
      <header>
        <p class="kicker">${statusPill(item.presentation_status, statusLabel)} <span class="sr-only">${escapeHtml(statusLabel)}</span> <span class="scope" data-scope="${escapeHtml(item.scope)}">${escapeHtml(scopeLabel(item.scope))}</span></p>
        <h3>${escapeHtml(item.agent_id)}${item.provider ? ` · ${escapeHtml(item.provider)}` : ""}</h3>
      </header>
      <p>${escapeHtml(item.summary)}</p>
      ${staleRunning}
      <dl class="facts">
        <div><dt>Agente / provedor</dt><dd>${escapeHtml(item.agent_id)}${item.provider ? ` / ${escapeHtml(item.provider)}` : ""}</dd></div>
        <div><dt>Repositório / escopo</dt><dd>${escapeHtml(item.repo ?? scopeLabel(item.scope))}</dd></div>
        <div><dt>Objetivo / campanha</dt><dd>${escapeHtml(item.goal)}${item.campaign ? ` · ${escapeHtml(item.campaign)}` : ""}</dd></div>
        ${listFact("Evidência", item.evidence_refs)}
        ${listFact("Bloqueios", item.blockers)}
        ${listFact("Trabalho residual", item.residual_work)}
      </dl>
      ${technicalDetails(
        [
          { term: "id", value: item.id },
          { term: "agent_id", value: item.agent_id },
          { term: "presentation_status", value: item.presentation_status },
          { term: "status", value: item.status },
          { term: "scope", value: item.scope },
          { term: "schema_version", value: item.schema_version },
        ],
        "agent-activity",
      )}
      ${provenanceBlock(item.provenance)}
    </article>
  `;
}

export function memoriaGroups(directives: Directive[]): string {
  const kinds = [
    "decision",
    "directive",
    "fact",
    "constraint",
    "priority",
    "risk",
    "hypothesis",
  ] as const;
  const labels = MEMORY_GROUP_TITLES;
  return kinds
    .map((kind) => {
      const rows = directives.filter((item) => item.kind === kind);
      if (rows.length === 0) return "";
      return `<section aria-labelledby="memoria-${kind}" data-memory-kind="${kind}"><h2 id="memoria-${kind}">${ownMapValue(labels, kind) ?? "Registros"}</h2><div class="stack">${rows.map(directiveCard).join("")}</div></section>`;
    })
    .join("");
}
