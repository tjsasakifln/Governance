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
import { ownMapValue } from "../own-map";
import { interactionDraftValue } from "../interaction-draft";
import { sourcePresentationLabel, sourceSystemLabel } from "../provenance";
import type { CommercialSnapshot } from "../types";
import {
  commercialEventLabel,
  commercialStateLabel,
  exceptionKindLabel,
  pipelineStageLabel,
  technicalDetails,
} from "./labels";
import { provenanceBlock } from "./provenance";

/** Query parameter that turns a queue surface into this detail. */
export const LEAD_DETAIL_RESOURCE_PARAM = "resource";
/** 1-based position of the subject inside the queue that linked here. */
export const LEAD_DETAIL_POSITION_PARAM = "pos";
/** Length of that queue, so the back label can say "item 3 de 12". */
export const LEAD_DETAIL_TOTAL_PARAM = "of";
/** Written on the back link so the queue can restore highlight/scroll. */
export const QUEUE_FOCUS_PARAM = "focus";
export const QUEUE_FOCUS_TOKEN_PATTERN = /^qf-[1-9][0-9]{0,8}-[0-9]{1,9}-[0-9a-f]{16}$/;

function boundedDigest(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    first ^= unit;
    first = Math.imul(first, 0x01000193) >>> 0;
    second ^= unit + index;
    second = Math.imul(second, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

/** Bounded return marker for one exact occurrence in a filtered/paged queue. */
export function queueFocusToken(
  resource: string,
  position: { index: number; total: number },
): string {
  const index = Number.isSafeInteger(position.index) && position.index > 0
    ? Math.min(position.index, 999_999_999)
    : 1;
  const length = Math.min(resource.length, 999_999_999);
  return `qf-${index}-${length}-${boundedDigest(resource)}`;
}

/**
 * Short DOM id for a queue-row token.
 *
 * The position inside `queueFocusToken` disambiguates repeated source ids. The
 * digest keeps this id bounded even when an upstream identifier is hostile.
 */
export function queueFocusDomId(token: string): string {
  return `commercial-queue-row-${token}`;
}
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
  const position = positionFrom(query);
  for (const key of LEAD_DETAIL_PARAMS) {
    params.delete(key);
  }
  if (resource && position) {
    params.set(QUEUE_FOCUS_PARAM, queueFocusToken(resource, position));
  } else {
    params.delete(QUEUE_FOCUS_PARAM);
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

/**
 * Warmbly's acknowledge route owns inbound alerts, not every commercial
 * exception. Require both the projector's explicit attention origin and a
 * structured inbound kind/code; prose such as `why` is presentation, not an
 * authorization signal.
 */
function isInboundAlertException(row: Record<string, unknown>): boolean {
  if (text(row.source) !== "warmbly.attention") return false;
  const evidence = asRecord(row.evidence);
  const discriminator = text(row.kind) ?? (evidence ? text(evidence.code) : null);
  return discriminator !== null && /(?:^|[_-])inbound(?:$|[_-])/i.test(discriminator);
}

// These keys identify the record the operator opened. `lead_id` is deliberately
// absent: it is an operational target carried by some records, not a generic
// record alias. Treating it as identity lets an ordinary inbound activity join
// an alert exception for the same lead and inherit an upstream write it did not
// itself authorize.
const IDENTITY_KEYS = ["source_id", "id", "canonical_id", "target_id", "deal_id"] as const;

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

/** Items returned for the current server-side page, across wire/internal shapes. */
function currentListItems(
  operations: Record<string, unknown>,
  list: "atividade" | "excecoes",
): Record<string, unknown>[] {
  const views = asRecord(operations.list_views);
  const entry = views ? asRecord(views[list]) : null;
  if (!entry) return [];
  const view = asRecord(entry.view);
  return [...rowsOf(entry.items), ...rowsOf(view?.items)];
}

/**
 * Merge bounded preview rows with the current remote page without duplicating
 * a structurally identical record present in both. Rows that merely share an
 * id remain distinct: one lead can have several real activity events.
 */
function mergeObservedRows(
  preview: readonly Record<string, unknown>[],
  current: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  const structurallyEqual = (left: unknown, right: unknown): boolean => {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
      return left.every((item, index) => structurallyEqual(item, right[index]));
    }
    const leftRecord = asRecord(left);
    const rightRecord = asRecord(right);
    if (!leftRecord || !rightRecord) return false;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every(
      (key, index) => key === rightKeys[index] && structurallyEqual(leftRecord[key], rightRecord[key]),
    );
  };
  const merged = [...preview];
  for (const row of current) {
    if (!merged.some((candidate) => structurallyEqual(candidate, row))) merged.push(row);
  }
  return merged;
}

const LEAD_ENTITY_TYPES = new Set(["lead", "lead_id", "inbound_lead"]);

/** All lead ids explicitly carried by an inbound exception. Ambiguity is data, not precedence. */
function inboundLeadIds(row: Record<string, unknown>): string[] {
  if (!isInboundAlertException(row)) return [];
  const candidates: string[] = [];
  const explicitLeadId = text(row.lead_id);
  if (explicitLeadId) candidates.push(explicitLeadId);
  const evidence = asRecord(row.evidence);
  const entityRef = evidence ? asRecord(evidence.entity_ref) : null;
  const entityType = entityRef ? text(entityRef.type)?.toLowerCase() : null;
  const entityId = entityRef ? text(entityRef.id) : null;
  if (entityId && entityType && LEAD_ENTITY_TYPES.has(entityType)) candidates.push(entityId);

  const evidenceLeadId = evidence ? text(evidence.lead_id) : null;
  if (evidenceLeadId) candidates.push(evidenceLeadId);

  // `source_id` is normally the exception record id. It becomes a lead id only
  // under an explicit discriminator; a plausible-looking string is not proof.
  const sourceKind = (evidence ? text(evidence.source_id_kind) : null) ?? text(row.source_id_kind);
  const sourceId = text(row.source_id);
  if (sourceId && sourceKind && LEAD_ENTITY_TYPES.has(sourceKind.toLowerCase())) {
    candidates.push(sourceId);
  }
  return [...new Set(candidates)];
}

function typedActivityLeadIds(row: Record<string, unknown>): string[] | null {
  const kind = text(row.operator_target_kind)?.toLowerCase();
  if (!kind || !LEAD_ENTITY_TYPES.has(kind)) return null;
  const target = text(row.operator_target_id);
  return target ? [target] : [];
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
  kind: "activity" | "exception";
  at: string | null;
  event: string;
  state: string | null;
  detail: string | null;
  /** Authored label for the reading surface. */
  origin: string;
  /** Upstream token, retained only in attributes and the collapsed technical detail. */
  source: string | null;
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
  /** Only content that changes the meaning of this particular decision. */
  humanInput: "none" | "note" | "reason";
  confirmation: "none" | "consequence";
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
  warmblyRefusalReason: "not-an-alert" | "lead-id-unproven" | "target-id" | null;
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

const HISTORY_SOURCE_LABELS: Record<string, string> = {
  "warmbly.attention": "Warmbly · fila de atenção",
  "warmbly.intel.exceptions": "Warmbly · exceções comerciais",
};

/**
 * A history row may carry a projector namespace rather than presentation copy.
 * Only recognized namespaces influence the authored label; every raw value is
 * retained separately for the technical disclosure.
 */
function historyOriginLabel(
  rawSource: string | null,
  fallbackSystem: string,
  subject: "atividade comercial" | "exceção comercial",
): string {
  const known = rawSource ? ownMapValue(HISTORY_SOURCE_LABELS, rawSource) : undefined;
  if (known) return known;
  const namespace = rawSource?.split(".", 1)[0] ?? fallbackSystem;
  return `${sourceSystemLabel(namespace)} · ${subject}`;
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
      humanInput: "note",
      confirmation: "none",
    },
    {
      id: "MARK_REVIEWED",
      label: "Marcar como revisado",
      risk: "baixo",
      writes: "control-center",
      effect: "Registra que um humano olhou este item. Não altera o estágio no Warmbly.",
      humanInput: "none",
      confirmation: "none",
    },
  ];
  if (opts.hasActivity) {
    out.push({
      id: "REVIEW_ACTIVITY",
      label: "Validar atividade",
      risk: "baixo",
      writes: "control-center",
      effect: "Confirma que a atividade observada confere com a realidade. Registro local.",
      humanInput: "none",
      confirmation: "none",
    });
  }
  if (opts.hasNextStep) {
    out.push({
      id: "CONFIRM_NEXT_ACTION",
      label: "Confirmar próximo passo",
      risk: "baixo",
      writes: "control-center",
      effect: "Concorda com o próximo passo sugerido pela origem. Não o executa.",
      humanInput: "none",
      confirmation: "none",
    });
    out.push({
      id: "REJECT_NEXT_ACTION",
      label: "Recusar próximo passo",
      risk: "medio",
      writes: "control-center",
      effect:
        "Registra que o próximo passo sugerido está errado. O Warmbly continua sugerindo até alguém corrigir lá.",
      humanInput: "reason",
      confirmation: "consequence",
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
      humanInput: "none",
      confirmation: "consequence",
    });
  }
  if (opts.hasClosedException) {
    out.push({
      id: "REOPEN_EXCEPTION",
      label: "Reabrir exceção no Control Center",
      risk: "medio",
      writes: "control-center",
      effect: "Desfaz o reconhecimento local. Não reabre nada no Warmbly.",
      humanInput: "reason",
      confirmation: "consequence",
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
  const activity = mergeObservedRows(
    rowsOf(ops.activity),
    currentListItems(ops, "atividade"),
  ).filter((row) => matchesResource(row, resource));
  const pipeline = rowsOf(ops.pipeline).filter((row) => matchesResource(row, resource));
  const exceptions = mergeObservedRows(
    rowsOf(ops.exceptions),
    currentListItems(ops, "excecoes"),
  ).filter((row) => matchesResource(row, resource));
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
  const originSource = input.snapshot.provenance.source;
  const originSystem = originSource.system;
  const originLocator = originSource.locator;

  const fields: DetailField[] = [
    {
      label: "Organização/lead",
      value: named,
      ...(named ? {} : { absence: "a origem enviou apenas um identificador; veja o detalhe técnico" }),
    },
    {
      label: "Origem",
      value: found ? sourcePresentationLabel(originSource) : null,
      ...(found ? {} : { absence: "nenhum registro casou com este identificador" }),
    },
    {
      label: "Estágio",
      value: stage ? pipelineStageLabel(stage) : activityState ? commercialStateLabel(activityState) : null,
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
    .map((row) => {
      const source = text(row.source) ?? originSystem;
      return {
        kind: "activity" as const,
        at: text(row.at),
        event: text(row.event) ?? "atividade",
        state: text(row.state),
        detail: text(row.evidence),
        origin: historyOriginLabel(text(row.source), originSystem, "atividade comercial"),
        source,
      };
    })
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

  for (const row of exceptions) {
    const source = text(row.source) ?? originSystem;
    history.push({
      kind: "exception",
      at: text(row.observed_at),
      event: text(row.kind) ?? "exceção",
      state: text(row.status),
      detail: text(row.why),
      origin: historyOriginLabel(text(row.source), originSystem, "exceção comercial"),
      source,
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
    if (why) evidence.push({ label: `Exceção · ${exceptionKindLabel(text(row.kind) ?? "unknown")}`, value: why });
  }
  for (const row of activity) {
    const detail = text(row.evidence);
    if (detail) evidence.push({ label: `Atividade · ${commercialEventLabel(text(row.event) ?? "activity")}`, value: detail });
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
  if (stage) pushId("Negócio · stage", stage);
  if (activityState) pushId("Atividade · state", activityState);
  for (const row of exceptions) {
    pushId("Exceção · id", text(row.id));
    pushId("Exceção · canonical_id", text(row.canonical_id));
  }
  pushId("Snapshot comercial", input.snapshot.id);
  pushId("Origem (sistema)", originSystem);
  pushId("Origem (tipo)", originSource.kind);
  pushId("Origem (locator)", originLocator);
  for (const row of activity) pushId("Histórico de atividade · source", text(row.source));
  for (const row of exceptions) pushId("Histórico de exceção · source", text(row.source));

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

  // The one lead-scoped Warmbly write is `acknowledge_inbound_alert`. Its URL
  // takes a lead id, not the exception id, source row id, deal id or whatever
  // opaque resource happened to open this detail.
  const inboundExceptionProofs = exceptions.filter(isInboundAlertException).map(inboundLeadIds);
  const activityProofs = activity
    .map(typedActivityLeadIds)
    .filter((value): value is string[] => value !== null);
  const isAlert = inboundExceptionProofs.length > 0 || activityProofs.length > 0;
  const proofSets = [...inboundExceptionProofs, ...activityProofs];
  const proofIncomplete = proofSets.some((candidates) => candidates.length !== 1);
  const provenTargets = [...new Set(proofSets.flat())];
  const provenTarget = !proofIncomplete && provenTargets.length === 1
    ? provenTargets[0] ?? null
    : null;
  const warmblyTargetId =
    found && isAlert && provenTarget && WARMBLY_TARGET_ID_PATTERN.test(provenTarget)
      ? provenTarget
      : null;
  const warmblyActions: LeadAction[] = warmblyTargetId
    ? [
        {
          id: "acknowledge_inbound_alert",
          label: "Reconhecer alerta no Warmbly",
          risk: "medio",
          writes: "warmbly",
          effect:
            "Escreve no Warmbly: marca este alerta de inbound como visto por um humano. Não responde, não envia e não dispara nada.",
          humanInput: "none",
          confirmation: "consequence",
        },
      ]
    : [];
  let warmblyRefusal: string | null = null;
  let warmblyRefusalReason: LeadDetailModel["warmblyRefusalReason"] = null;
  if (found && !isAlert) {
    warmblyRefusalReason = "not-an-alert";
    warmblyRefusal =
      "Nenhuma escrita no Warmbly se aplica a este item: o canal de operador só reconhece alertas de inbound, e este item não é um. Pausar e retomar o disparo são controles de toda a operação e ficam na superfície de disparo, não no detalhe de um lead.";
  } else if (found && isAlert && !provenTarget) {
    warmblyRefusalReason = "lead-id-unproven";
    warmblyRefusal =
      "A exceção é de inbound, mas não traz um identificador de lead comprovado e inequívoco. O id da exceção, o source_id e o registro aberto não são substitutos seguros; nenhuma escrita upstream é oferecida.";
  } else if (found && provenTarget && !warmblyTargetId) {
    warmblyRefusalReason = "target-id";
    warmblyRefusal =
      "O identificador de lead comprovado não é um alvo válido do canal de operador do Warmbly (o canal só aceita [A-Za-z0-9_~-], até 128 caracteres). Nenhuma escrita upstream é oferecida aqui.";
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

function localActionForm(action: LeadAction, resource: string, canonicalId: string, returnHash: string): string {
  const riskLabel = ownMapValue(RISK_LABEL, action.risk) ?? "risco não reconhecido";
  const interactionIds: Record<string, string> = {
    RECORD_NOTE: "lead.record-note",
    MARK_REVIEWED: "lead.mark-reviewed",
    REVIEW_ACTIVITY: "lead.review-activity",
    CONFIRM_NEXT_ACTION: "lead.confirm-next",
    REJECT_NEXT_ACTION: "lead.reject-next",
    ACKNOWLEDGE_EXCEPTION: "lead.acknowledge-exception",
    REOPEN_EXCEPTION: "lead.reopen-exception",
  };
  const draftKey = `operator:${action.id}:${canonicalId}:${resource}`;
  const draftNote = interactionDraftValue(draftKey, "note");
  const field = action.humanInput === "note"
    ? `<label>Nota de auditoria <textarea name="note" required minlength="2" maxlength="500">${escapeHtml(draftNote)}</textarea></label>`
    : action.humanInput === "reason"
      ? `<label>Motivo operacional <textarea name="note" required minlength="2" maxlength="500">${escapeHtml(draftNote)}</textarea></label>`
      : "";
  return `
    <form data-operator-form="${escapeHtml(action.id)}" data-writes-to="control-center" data-draft-key="${escapeHtml(draftKey)}" data-action-risk="${escapeHtml(action.risk)}" data-human-input="${escapeHtml(action.humanInput)}" data-interaction="${escapeHtml(interactionIds[action.id] ?? action.id)}" data-continuity-action="queue" data-continuity-next="${escapeHtml(returnHash)}"${action.humanInput === "none" ? ` data-one-decision="true"` : ""} class="operator-form lead-action">
      <h4>${escapeHtml(action.label)} <span class="pill" data-risk="${escapeHtml(action.risk)}">${escapeHtml(riskLabel)}</span></h4>
      <p class="constraint">${escapeHtml(action.effect)}</p>
      <input type="hidden" name="target_canonical_id" value="${escapeHtml(canonicalId)}" />
      <input type="hidden" name="target_source_id" value="${escapeHtml(resource)}" />
      ${field}
      <button type="submit">${escapeHtml(action.label)}</button>
    </form>`;
}

function warmblyActionForm(action: LeadAction, targetId: string): string {
  const riskLabel = ownMapValue(RISK_LABEL, action.risk) ?? "risco não reconhecido";
  return `
    <form data-warmbly-dispatch="acknowledge" data-writes-to="warmbly" data-action-risk="${escapeHtml(action.risk)}" data-interaction="lead.warmbly-acknowledge" data-one-decision="true" class="operator-form lead-action">
      <h4>${escapeHtml(action.label)} <span class="pill" data-risk="${escapeHtml(action.risk)}">${escapeHtml(riskLabel)}</span></h4>
      <p class="constraint">${escapeHtml(action.effect)}</p>
      <input type="hidden" name="target_id" value="${escapeHtml(targetId)}" />
      <button type="submit">${escapeHtml(action.label)}</button>
    </form>`;
}

function historySection(model: LeadDetailModel): string {
  if (model.history.length === 0) {
    return `<p class="banner empty">Nenhum evento observado para este item. Ausência de histórico não é ausência de trabalho — é o que esta coleta enxergou.</p>`;
  }
  return `<ol class="stack lead-history">${model.history
    .map((entry) => {
      const eventLabel = entry.kind === "exception"
        ? exceptionKindLabel(entry.event)
        : commercialEventLabel(entry.event);
      const stateLabel = entry.state ? commercialStateLabel(entry.state) : null;
      return `<li class="card" data-history-event="${escapeHtml(entry.event)}" data-history-source="${escapeHtml(entry.source ?? "")}">
        <p class="kicker">${timeCell(entry.at)} · ${escapeHtml(entry.origin)}</p>
        <h4>${escapeHtml(eventLabel)}${stateLabel ? ` · ${escapeHtml(stateLabel)}` : ""}</h4>
        ${entry.detail ? `<p>${escapeHtml(entry.detail)}</p>` : ""}
        ${technicalDetails(
          [
            { term: "event", value: entry.event },
            { term: "state", value: entry.state ?? "" },
            { term: "source", value: entry.source ?? "" },
          ],
          "lead-history-event",
        )}
      </li>`;
    })
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
        ${model.localActions.map((action) => localActionForm(action, model.resource, model.canonicalId, model.backHash)).join("")}
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
