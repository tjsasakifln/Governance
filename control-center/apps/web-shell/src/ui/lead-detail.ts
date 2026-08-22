/**
 * Lead/opportunity detail sub-surface (issue #66).
 *
 * Self-contained: it reads the commercial snapshot's `operations` block and the
 * current location's query string, and returns HTML. Nothing else in the shell
 * has to know it exists — `#/comercial/atividade?resource=<id>` reaches it
 * today, and the "Operação Warmbly" route (#64) can call `leadDetailBlock`
 * from its own sub-surface dispatch with the same arguments.
 *
 * Two invariants this module exists to hold:
 *
 * 1. **Opaque identifiers never headline the page.** Warmbly emits activity
 *    rows whose `lead_or_account` falls back to the raw record id, so the queue
 *    shows `warmbly:action:<uuid>:next_action` where a company name belongs.
 *    Here the identifier is demoted into a copyable technical block and the
 *    main view says plainly that the origin did not name the organisation.
 *
 * 2. **A local record is never dressed up as an upstream write.** Two genuinely
 *    different mechanisms can be triggered from this page and they are rendered
 *    as two separate, separately labelled groups:
 *      - `POST /v1/operator-actions` — an audit record in the Control Center.
 *        It does not reach Warmbly. Nothing changes in the CRM.
 *      - `acknowledge_inbound_alert` — the one lead-scoped action in the
 *        Warmbly operator channel that really writes upstream.
 *    Sending, dispatching, enrolling and charging are refused by that channel
 *    and have no control here.
 */

import { formatLocal } from "../datetime";
import { escapeHtml } from "../escape";
import { formatMoney, isMoney } from "../money";
import type { CommercialSnapshot } from "../types";
import { provenanceBlock } from "./provenance";

/** Query parameter that turns a queue surface into this detail. */
export const LEAD_DETAIL_RESOURCE_PARAM = "resource";
/** 1-based position of the subject inside the queue that linked here. */
export const LEAD_DETAIL_POSITION_PARAM = "pos";
/** Length of that queue, so the back label can say "item 3 de 12". */
export const LEAD_DETAIL_TOTAL_PARAM = "of";
/** Written on the back link so the queue can restore highlight/scroll. */
export const QUEUE_FOCUS_PARAM = "focus";
/** Parameters this module owns. Everything else on the hash is queue state. */
export const LEAD_DETAIL_PARAMS = [
  LEAD_DETAIL_RESOURCE_PARAM,
  LEAD_DETAIL_POSITION_PARAM,
  LEAD_DETAIL_TOTAL_PARAM,
] as const;

/**
 * Mirror of `TARGET_ID_PATTERN` in
 * `connectors/warmbly/src/operator/actions.ts`. The web shell cannot import
 * from the connector package, so the two copies are pinned together by
 * `tests/convergence/lead-detail-surface.test.ts`, which fails if they drift.
 */
export const WARMBLY_TARGET_ID_PATTERN = /^[A-Za-z0-9_~-]{1,128}$/;

export type ActionRisk = "baixo" | "medio" | "alto";
export type ActionWriteTarget = "control-center" | "warmbly";

const RISK_LABEL: Record<ActionRisk, string> = {
  baixo: "risco baixo",
  medio: "risco médio",
  alto: "risco alto",
};

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ULID_PATTERN = /(^|[^0-9A-Za-z])[0-9A-HJKMNP-TV-Z]{26}([^0-9A-Za-z]|$)/;
const NAMESPACED_ID_PATTERN = /^[A-Za-z0-9_.~-]+(?::[A-Za-z0-9_.~-]+){2,}$/;
const HEX_BLOB_PATTERN = /^[0-9a-f]{16,}$/i;
const LONG_DIGITS_PATTERN = /^[0-9]{6,}$/;

/**
 * True when a string is a machine handle rather than something a human named.
 *
 * Deliberately generous: showing "organização não identificada pela origem"
 * next to a copyable id is honest, while headlining an opaque handle is the
 * defect this surface exists to remove.
 */
export function isOpaqueIdentifier(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.toLowerCase() === "unknown") return true;
  if (UUID_PATTERN.test(trimmed)) return true;
  if (ULID_PATTERN.test(trimmed)) return true;
  if (NAMESPACED_ID_PATTERN.test(trimmed)) return true;
  if (HEX_BLOB_PATTERN.test(trimmed)) return true;
  if (LONG_DIGITS_PATTERN.test(trimmed)) return true;
  return false;
}

function paramsOf(query: string | null | undefined): URLSearchParams {
  const raw = (query ?? "").replace(/^\?/, "");
  return new URLSearchParams(raw);
}

function withQuery(path: string, params: URLSearchParams): string {
  const rendered = params.toString();
  return rendered ? `${path}?${rendered}` : path;
}

/**
 * Route that owns the queue.
 *
 * A bare name (`"atividade"`) is a sub-surface of Comercial, which is where the
 * queue lives today. A caller that already has its own route — the "Operação
 * Warmbly" surface, for one — passes the full hash path (`"#/warmbly/fila"`)
 * and this module leaves it alone.
 */
function routeOf(surface: string): string {
  return surface.startsWith("#/") ? surface : `#/comercial/${surface}`;
}

/**
 * Link from a queue row into this detail.
 *
 * Every parameter the queue already carries — search, filters, sort, page —
 * survives untouched; only this module's own parameters are (re)written. That
 * is the whole contract the triage queue (#65) has to honour: put your state on
 * the hash and it comes back.
 */
export function leadDetailHash(
  surface: string,
  query: string | null | undefined,
  resource: string,
  position?: { index: number; total: number },
): string {
  const params = paramsOf(query);
  params.delete(QUEUE_FOCUS_PARAM);
  params.set(LEAD_DETAIL_RESOURCE_PARAM, resource);
  if (position) {
    params.set(LEAD_DETAIL_POSITION_PARAM, String(position.index));
    params.set(LEAD_DETAIL_TOTAL_PARAM, String(position.total));
  } else {
    params.delete(LEAD_DETAIL_POSITION_PARAM);
    params.delete(LEAD_DETAIL_TOTAL_PARAM);
  }
  return withQuery(routeOf(surface), params);
}

/**
 * Back link out of this detail: the queue exactly as it was, plus `focus` so
 * the row that was opened can be restored under the cursor.
 */
export function queueBackHash(
  surface: string,
  query: string | null | undefined,
  resource: string,
): string {
  const params = paramsOf(query);
  for (const key of LEAD_DETAIL_PARAMS) {
    params.delete(key);
  }
  if (resource) {
    params.set(QUEUE_FOCUS_PARAM, resource);
  }
  return withQuery(routeOf(surface), params);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rowsOf(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  const out: Record<string, unknown>[] = [];
  for (const item of value) {
    const row = asRecord(item);
    if (row) out.push(row);
  }
  return out;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const IDENTITY_KEYS = ["source_id", "id", "canonical_id", "lead_id", "target_id", "deal_id"] as const;

function identitiesOf(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of IDENTITY_KEYS) {
    const value = text(row[key]);
    if (value) out.push(value);
  }
  return out;
}

function matchesResource(row: Record<string, unknown>, resource: string): boolean {
  return identitiesOf(row).includes(resource);
}

/** Human title for a row, or `null` when the origin only gave a handle. */
export function leadTitleOf(row: Record<string, unknown>): string | null {
  const candidates = [row.display_name, row.lead_or_account, row.company, row.name, row.organisation];
  for (const candidate of candidates) {
    const value = text(candidate);
    if (value && !isOpaqueIdentifier(value)) return value;
  }
  return null;
}

const UNNAMED = "Organização não identificada pela origem";

export interface DetailField {
  label: string;
  value: string | null;
  /** Why the value is missing. Rendered instead of a zero or a blank. */
  absence?: string;
}

export interface HistoryEntry {
  at: string | null;
  event: string;
  state: string | null;
  detail: string | null;
  origin: string;
}

export interface EvidenceEntry {
  label: string;
  value: string;
}

export interface LeadAction {
  /** `data-operator-form` value, or the Warmbly channel action name. */
  id: string;
  label: string;
  risk: ActionRisk;
  writes: ActionWriteTarget;
  effect: string;
  /** Extra confirmation beyond the mandatory audit note. */
  confirmation: "nota" | "nota-e-ciencia" | "nota-ciencia-e-palavra";
}

export interface LeadDetailModel {
  resource: string;
  /** Canonical id the local operator-action record is filed against. */
  canonicalId: string;
  found: boolean;
  title: string;
  titleFromOrigin: boolean;
  fields: DetailField[];
  history: HistoryEntry[];
  evidence: EvidenceEntry[];
  technicalIds: EvidenceEntry[];
  localActions: LeadAction[];
  warmblyActions: LeadAction[];
  /** Non-null only when the id is a legal target for the operator channel. */
  warmblyTargetId: string | null;
  warmblyRefusal: string | null;
  warmblyRefusalReason: "not-an-alert" | "target-id" | null;
  backHash: string;
  queuePosition: { index: number; total: number } | null;
}

export interface LeadDetailInput {
  snapshot: CommercialSnapshot;
  resource: string;
  /** Raw query string of the current location, carrying the queue state. */
  query?: string | null;
  /** Queue surface to return to. Defaults to the activity queue. */
  surface?: string;
}

function positionFrom(query: string | null | undefined): { index: number; total: number } | null {
  const params = paramsOf(query);
  const index = Number.parseInt(params.get(LEAD_DETAIL_POSITION_PARAM) ?? "", 10);
  const total = Number.parseInt(params.get(LEAD_DETAIL_TOTAL_PARAM) ?? "", 10);
  if (!Number.isInteger(index) || index < 1) return null;
  if (!Number.isInteger(total) || total < index) return null;
  return { index, total };
}

function moneyLabel(value: unknown): string | null {
  const rec = asRecord(value);
  if (!rec || typeof rec.amount_cents !== "number") return null;
  const money = { amount_cents: rec.amount_cents, currency: typeof rec.currency === "string" ? rec.currency : "" };
  return isMoney(money) ? formatMoney(money) : null;
}

function ageLabel(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const days = Math.floor(value / 86400);
  if (days >= 1) return `${days} dia(s)`;
  const hours = Math.floor(value / 3600);
  if (hours >= 1) return `${hours} hora(s)`;
  return `${Math.floor(value / 60)} minuto(s)`;
}

const OWNER_KEYS = ["owner", "owner_name", "assignee", "assigned_to", "responsible", "responsavel"] as const;

function ownerFrom(rows: readonly Record<string, unknown>[]): string | null {
  for (const row of rows) {
    for (const key of OWNER_KEYS) {
      const direct = text(row[key]);
      if (direct && !isOpaqueIdentifier(direct)) return direct;
    }
    const evidence = asRecord(row.evidence);
    if (!evidence) continue;
    for (const key of OWNER_KEYS) {
      const nested = text(evidence[key]);
      if (nested && !isOpaqueIdentifier(nested)) return nested;
    }
  }
  return null;
}

function localActionsFor(opts: {
  hasActivity: boolean;
  hasNextStep: boolean;
  hasOpenException: boolean;
  hasClosedException: boolean;
}): LeadAction[] {
  const out: LeadAction[] = [
    {
      id: "RECORD_NOTE",
      label: "Registrar nota",
      risk: "baixo",
      writes: "control-center",
      effect: "Grava uma nota de auditoria no Control Center. Nada muda no Warmbly.",
      confirmation: "nota",
    },
    {
      id: "MARK_REVIEWED",
      label: "Marcar como revisado",
      risk: "baixo",
      writes: "control-center",
      effect: "Registra que um humano olhou este item. Não altera o estágio no Warmbly.",
      confirmation: "nota",
    },
  ];
  if (opts.hasActivity) {
    out.push({
      id: "REVIEW_ACTIVITY",
      label: "Validar atividade",
      risk: "baixo",
      writes: "control-center",
      effect: "Confirma que a atividade observada confere com a realidade. Registro local.",
      confirmation: "nota",
    });
  }
  if (opts.hasNextStep) {
    out.push({
      id: "CONFIRM_NEXT_ACTION",
      label: "Confirmar próximo passo",
      risk: "baixo",
      writes: "control-center",
      effect: "Concorda com o próximo passo sugerido pela origem. Não o executa.",
      confirmation: "nota",
    });
    out.push({
      id: "REJECT_NEXT_ACTION",
      label: "Recusar próximo passo",
      risk: "medio",
      writes: "control-center",
      effect:
        "Registra que o próximo passo sugerido está errado. O Warmbly continua sugerindo até alguém corrigir lá.",
      confirmation: "nota-e-ciencia",
    });
  }
  if (opts.hasOpenException) {
    out.push({
      id: "ACKNOWLEDGE_EXCEPTION",
      label: "Reconhecer exceção no Control Center",
      risk: "medio",
      writes: "control-center",
      effect:
        "Registro de auditoria local. A exceção continua aberta no Warmbly e continua nesta fila.",
      confirmation: "nota-e-ciencia",
    });
  }
  if (opts.hasClosedException) {
    out.push({
      id: "REOPEN_EXCEPTION",
      label: "Reabrir exceção no Control Center",
      risk: "medio",
      writes: "control-center",
      effect: "Desfaz o reconhecimento local. Não reabre nada no Warmbly.",
      confirmation: "nota-e-ciencia",
    });
  }
  return out;
}

/**
 * Assembles the detail from the commercial `operations` block.
 *
 * Every reading is observed-or-absent-with-a-reason. There is no zero standing
 * in for "we did not look", and no invented owner, stage or next step.
 */
export function leadDetailView(input: LeadDetailInput): LeadDetailModel {
  const surface = input.surface && input.surface.length > 0 ? input.surface : "atividade";
  const resource = input.resource;
  const ops = asRecord(input.snapshot.operations) ?? {};
  const activity = rowsOf(ops.activity).filter((row) => matchesResource(row, resource));
  const pipeline = rowsOf(ops.pipeline).filter((row) => matchesResource(row, resource));
  const exceptions = rowsOf(ops.exceptions).filter((row) => matchesResource(row, resource));
  const deal = pipeline[0] ?? null;
  const firstActivity = activity[0] ?? null;
  const firstException = exceptions[0] ?? null;
  const related = [deal, firstActivity, firstException].filter(
    (row): row is Record<string, unknown> => row !== null,
  );
  const found = related.length > 0;

  const named = related.map(leadTitleOf).find((value): value is string => value !== null) ?? null;
  const backHash = queueBackHash(surface, input.query, resource);

  const stage = deal ? (text(deal.stage) ?? text(deal.status)) : null;
  const activityState = firstActivity ? text(firstActivity.state) : null;
  const nextStep =
    (deal ? text(deal.next_action) : null) ??
    (firstException ? text(firstException.recommended_next_action) : null);
  const owner = ownerFrom(related);
  const originSystem = input.snapshot.provenance.source.system;
  const originLocator = input.snapshot.provenance.source.locator;
  const rowOrigin = firstException ? text(firstException.source) : null;

  const fields: DetailField[] = [
    {
      label: "Organização/lead",
      value: named,
      ...(named ? {} : { absence: "a origem enviou apenas um identificador; veja o detalhe técnico" }),
    },
    {
      label: "Origem",
      value: found ? `${originSystem} · ${originLocator}${rowOrigin ? ` · ${rowOrigin}` : ""}` : null,
      ...(found ? {} : { absence: "nenhum registro casou com este identificador" }),
    },
    {
      label: "Estágio",
      value: stage ?? activityState,
      ...(stage ?? activityState
        ? {}
        : { absence: "não projetado para este item — só há registro de atividade, sem negócio no pipeline" }),
    },
    {
      label: "Responsável",
      value: owner,
      ...(owner
        ? {}
        : { absence: "não informado pela origem — o recorte comercial do Warmbly não projeta responsável" }),
    },
    {
      label: "Próximo passo",
      value: nextStep,
      ...(nextStep ? {} : { absence: "nenhum próximo passo informado pela origem" }),
    },
  ];

  const history: HistoryEntry[] = activity
    .map((row) => ({
      at: text(row.at),
      event: text(row.event) ?? "atividade",
      state: text(row.state),
      detail: text(row.evidence),
      origin: `${originSystem} · atividade`,
    }))
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

  for (const row of exceptions) {
    history.push({
      at: text(row.observed_at),
      event: text(row.kind) ?? "exceção",
      state: text(row.status),
      detail: text(row.why),
      origin: text(row.source) ?? `${originSystem} · exceção`,
    });
  }
  history.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

  const evidence: EvidenceEntry[] = [];
  if (deal) {
    const value = moneyLabel(deal.value);
    if (value) evidence.push({ label: "Valor do negócio", value });
    const age = ageLabel(deal.age_seconds);
    if (age) evidence.push({ label: "Sem movimento há", value: age });
    if (deal.stale === true) {
      evidence.push({ label: "Sinalizado", value: "negócio parado pela regra de idade da origem" });
    }
  }
  for (const row of exceptions) {
    const why = text(row.why);
    if (why) evidence.push({ label: `Exceção · ${text(row.kind) ?? "sem tipo"}`, value: why });
  }
  for (const row of activity) {
    const detail = text(row.evidence);
    if (detail) evidence.push({ label: `Atividade · ${text(row.event) ?? "evento"}`, value: detail });
  }

  const technicalIds: EvidenceEntry[] = [];
  const seenIds = new Set<string>();
  const pushId = (label: string, value: string | null): void => {
    if (!value) return;
    const key = `${label}=${value}`;
    if (seenIds.has(key)) return;
    seenIds.add(key);
    technicalIds.push({ label, value });
  };
  pushId("Identificador consultado", resource);
  if (deal) {
    pushId("Negócio · source_id", text(deal.source_id));
    pushId("Negócio · canonical_id", text(deal.canonical_id));
  }
  if (firstActivity) pushId("Atividade · source_id", text(firstActivity.source_id));
  for (const row of exceptions) {
    pushId("Exceção · id", text(row.id));
    pushId("Exceção · canonical_id", text(row.canonical_id));
  }
  pushId("Snapshot comercial", input.snapshot.id);
  pushId("Origem (locator)", originLocator);

  const openException = exceptions.some((row) => (text(row.status) ?? "open") === "open");
  const closedException = exceptions.some((row) => {
    const status = text(row.status) ?? "open";
    return status !== "open";
  });
  const localActions = found
    ? localActionsFor({
        hasActivity: activity.length > 0,
        hasNextStep: nextStep !== null,
        hasOpenException: openException,
        hasClosedException: closedException,
      })
    : [];

  // The one lead-scoped Warmbly write is `acknowledge_inbound_alert`, and its
  // target kind is an alert — not a deal. Two gates, both real: the item has to
  // be an alert, and its id has to be something the channel would accept.
  const isAlert =
    exceptions.length > 0 ||
    activity.some((row) => /inbound|alert/i.test(text(row.event) ?? ""));
  const warmblyTargetId =
    found && isAlert && WARMBLY_TARGET_ID_PATTERN.test(resource) ? resource : null;
  const warmblyActions: LeadAction[] = warmblyTargetId
    ? [
        {
          id: "acknowledge_inbound_alert",
          label: "Reconhecer alerta no Warmbly",
          risk: "alto",
          writes: "warmbly",
          effect:
            "Escreve no Warmbly: marca este alerta de inbound como visto por um humano. Não responde, não envia e não dispara nada.",
          confirmation: "nota-ciencia-e-palavra",
        },
      ]
    : [];
  let warmblyRefusal: string | null = null;
  let warmblyRefusalReason: LeadDetailModel["warmblyRefusalReason"] = null;
  if (found && !isAlert) {
    warmblyRefusalReason = "not-an-alert";
    warmblyRefusal =
      "Nenhuma escrita no Warmbly se aplica a este item: o canal de operador só reconhece alertas de inbound, e este item não é um. Pausar e retomar o disparo são controles de toda a operação e ficam na superfície de disparo, não no detalhe de um lead.";
  } else if (found && !warmblyTargetId) {
    warmblyRefusalReason = "target-id";
    warmblyRefusal =
      "Este identificador não é um alvo válido do canal de operador do Warmbly (o canal só aceita [A-Za-z0-9_~-], até 128 caracteres). Nenhuma escrita upstream é oferecida aqui.";
  }

  const canonicalId =
    (deal ? text(deal.canonical_id) : null) ??
    (firstException ? text(firstException.canonical_id) : null) ??
    resource;

  return {
    resource,
    canonicalId,
    found,
    title: named ?? UNNAMED,
    titleFromOrigin: named !== null,
    fields,
    history,
    evidence,
    technicalIds,
    localActions,
    warmblyActions,
    warmblyTargetId,
    warmblyRefusal,
    warmblyRefusalReason,
    backHash,
    queuePosition: positionFrom(input.query),
  };
}

function fieldRow(field: DetailField): string {
  if (field.value !== null) {
    return `<div><dt>${escapeHtml(field.label)}</dt><dd>${escapeHtml(field.value)}</dd></div>`;
  }
  return `<div data-absent="true"><dt>${escapeHtml(field.label)}</dt><dd>ausente — ${escapeHtml(field.absence ?? "não informado pela origem")}</dd></div>`;
}

function timeCell(at: string | null): string {
  if (!at) return `<span data-absent="true">sem carimbo de tempo</span>`;
  return `<time datetime="${escapeHtml(at)}">${escapeHtml(formatLocal(at))}</time><span class="sr-only">UTC ${escapeHtml(at)}</span>`;
}

function confirmationControls(action: LeadAction): string {
  if (action.confirmation === "nota") return "";
  const ciencia =
    action.writes === "warmbly"
      ? "Entendo que esta ação grava no Warmbly."
      : "Entendo que este é um registro local e que nada muda no Warmbly.";
  const checkbox = `<label class="confirm"><input type="checkbox" name="ciencia" required /> ${escapeHtml(ciencia)}</label>`;
  if (action.confirmation === "nota-e-ciencia") return checkbox;
  return `${checkbox}<label>Digite RECONHECER para liberar <input name="palavra_de_confirmacao" required pattern="RECONHECER" title="Digite RECONHECER" /></label>`;
}

function localActionForm(action: LeadAction, resource: string, canonicalId: string): string {
  return `
    <form data-operator-form="${escapeHtml(action.id)}" data-writes-to="control-center" data-action-risk="${escapeHtml(action.risk)}" class="operator-form lead-action">
      <h4>${escapeHtml(action.label)} <span class="pill" data-risk="${escapeHtml(action.risk)}">${escapeHtml(RISK_LABEL[action.risk])}</span></h4>
      <p class="constraint">${escapeHtml(action.effect)}</p>
      <input type="hidden" name="target_canonical_id" value="${escapeHtml(canonicalId)}" />
      <input type="hidden" name="target_source_id" value="${escapeHtml(resource)}" />
      <label>Nota de auditoria <textarea name="note" required minlength="2" maxlength="500"></textarea></label>
      ${confirmationControls(action)}
      <button type="submit">${escapeHtml(action.label)}</button>
    </form>`;
}

function warmblyActionForm(action: LeadAction, targetId: string): string {
  return `
    <form data-warmbly-dispatch="acknowledge" data-writes-to="warmbly" data-action-risk="${escapeHtml(action.risk)}" class="operator-form lead-action">
      <h4>${escapeHtml(action.label)} <span class="pill" data-risk="${escapeHtml(action.risk)}">${escapeHtml(RISK_LABEL[action.risk])}</span></h4>
      <p class="constraint">${escapeHtml(action.effect)}</p>
      <input type="hidden" name="target_id" value="${escapeHtml(targetId)}" />
      <label>Motivo <input name="reason" required minlength="2" maxlength="200" placeholder="por que está reconhecendo" /></label>
      ${confirmationControls(action)}
      <button type="submit">${escapeHtml(action.label)}</button>
    </form>`;
}

function historySection(model: LeadDetailModel): string {
  if (model.history.length === 0) {
    return `<p class="banner empty">Nenhum evento observado para este item. Ausência de histórico não é ausência de trabalho — é o que esta coleta enxergou.</p>`;
  }
  return `<ol class="stack lead-history">${model.history
    .map(
      (entry) => `<li class="card" data-history-event="${escapeHtml(entry.event)}">
        <p class="kicker">${timeCell(entry.at)} · ${escapeHtml(entry.origin)}</p>
        <h4>${escapeHtml(entry.event)}${entry.state ? ` · ${escapeHtml(entry.state)}` : ""}</h4>
        ${entry.detail ? `<p>${escapeHtml(entry.detail)}</p>` : ""}
      </li>`,
    )
    .join("")}</ol>`;
}

function evidenceSection(model: LeadDetailModel): string {
  if (model.evidence.length === 0) {
    return `<p class="constraint" data-absent="true">Nenhuma evidência anexada pela origem a este item.</p>`;
  }
  return `<dl class="facts lead-evidence">${model.evidence
    .map((row) => `<div><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd></div>`)
    .join("")}</dl>`;
}

function technicalSection(model: LeadDetailModel): string {
  const lines = model.technicalIds.map((row) => `${row.label}: ${row.value}`).join("\n");
  return `
    <details class="lead-technical" data-technical-detail="ids">
      <summary>Detalhe técnico (identificadores)</summary>
      <p class="constraint">Identificadores opacos ficam aqui, fora da leitura principal. Copie-os para abrir um chamado ou casar com o registro no Warmbly.</p>
      <dl class="facts">${model.technicalIds
        .map((row) => `<div><dt>${escapeHtml(row.label)}</dt><dd><code>${escapeHtml(row.value)}</code></dd></div>`)
        .join("")}</dl>
      <form data-copy-form="lead-technical-ids" class="operator-form copy-form">
        <label>Bloco copiável
          <textarea name="copy_payload" readonly rows="${Math.min(8, Math.max(2, model.technicalIds.length))}">${escapeHtml(lines)}</textarea>
        </label>
        <button type="submit">Copiar identificadores</button>
      </form>
    </details>`;
}

function backLink(model: LeadDetailModel): string {
  const position = model.queuePosition
    ? ` (item ${model.queuePosition.index} de ${model.queuePosition.total})`
    : "";
  return `<p class="lead-back"><a href="${escapeHtml(model.backHash)}" data-lead-back="queue">← Voltar para a fila${escapeHtml(position)}</a></p>`;
}

/**
 * Renders the detail. Callers pass the commercial snapshot, the resource id
 * from the hash, and the raw query string that carries queue state.
 */
export function leadDetailBlock(input: LeadDetailInput): string {
  const model = leadDetailView(input);

  if (!model.found) {
    return `
    <section class="stack lead-detail" aria-labelledby="lead-detail-title" data-lead-detail="not-found" data-lead-resource="${escapeHtml(model.resource)}">
      ${backLink(model)}
      <h2 id="lead-detail-title">Item não encontrado neste recorte</h2>
      <p class="banner empty">Nenhum lead, oportunidade ou exceção deste snapshot comercial casa com o identificador consultado. Isso pode significar que o item saiu da janela coletada, não que ele não exista no Warmbly.</p>
      ${technicalSection(model)}
      ${provenanceBlock(input.snapshot.provenance)}
    </section>`;
  }

  return `
    <section class="stack lead-detail" aria-labelledby="lead-detail-title" data-lead-detail="found" data-lead-resource="${escapeHtml(model.resource)}" data-lead-named="${model.titleFromOrigin ? "true" : "false"}">
      ${backLink(model)}
      <header class="page-head">
        <h2 id="lead-detail-title">${escapeHtml(model.title)}</h2>
        ${model.titleFromOrigin ? "" : `<p class="constraint">A origem não enviou nome de organização para este item — o identificador está no detalhe técnico abaixo.</p>`}
      </header>

      <article class="card lead-summary">
        <h3>Contexto</h3>
        <dl class="facts">${model.fields.map(fieldRow).join("")}</dl>
        ${provenanceBlock(input.snapshot.provenance)}
      </article>

      <article class="card lead-evidence-card">
        <h3>Evidências</h3>
        ${evidenceSection(model)}
      </article>

      <section aria-labelledby="lead-history-title">
        <h3 id="lead-history-title">Histórico</h3>
        ${historySection(model)}
      </section>

      <section class="stack lead-actions" aria-labelledby="lead-actions-title" data-action-scope="control-center-only">
        <h3 id="lead-actions-title">Registros no Control Center (não gravam no Warmbly)</h3>
        <p class="constraint" data-operator-scope="control-center-only">Estas ações gravam apenas um registro de auditoria local. Nada muda no Warmbly, e o item continua na fila até a origem mudar.</p>
        ${model.localActions.map((action) => localActionForm(action, model.resource, model.canonicalId)).join("")}
      </section>

      <section class="stack lead-actions" aria-labelledby="lead-warmbly-title" data-action-scope="warmbly-write">
        <h3 id="lead-warmbly-title">Escritas no Warmbly</h3>
        <p class="constraint" data-operator-scope="warmbly-write">Só existe uma ação por item que grava no Warmbly, e ela é reconhecimento de alerta. Enviar e-mail, disparar sequência, inscrever em campanha e cobrar não existem nesta tela e são recusados pelo canal de operador.</p>
        ${
          model.warmblyRefusal
            ? `<p class="banner empty" data-warmbly-refusal="${escapeHtml(model.warmblyRefusalReason ?? "unknown")}">${escapeHtml(model.warmblyRefusal)}</p>`
            : model.warmblyActions
                .map((action) => warmblyActionForm(action, model.warmblyTargetId ?? ""))
                .join("")
        }
      </section>

      ${technicalSection(model)}
    </section>`;
}
