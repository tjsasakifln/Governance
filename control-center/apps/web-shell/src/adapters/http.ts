import type { DestinationId } from "../destinations";
import { getDestination, parseHash, queryParamsOf } from "../destinations";
import { isUtcDateTime } from "../datetime";
import { LIST_PARAM_IDS } from "../filter";
import { ownMapValue } from "../own-map";
import { clientIdentityGapFrom } from "../client-identity";
import type {
  ActorRef,
  AttentionItem,
  ClientIdentityException,
  ClientStatus,
  PriorityRecommendation,
  Provenance,
} from "../types";
import {
  ADAPTER_ACTIONS,
  APPROVAL_DEFAULT_REASON,
  type AdapterAction,
  type AdapterReadResult,
  type AdapterWriteResult,
  type WarmblyDispatchInput,
  type WarmblyGateInput,
  type ControlCenterReadAdapter,
  type DestinationPage,
} from "./contract";
import {
  activityFrom,
  asRecord,
  clientDataQualityFrom,
  maybeClientFrom,
  commercialFrom,
  composePageFromHojeInput,
  engineeringFrom,
  fallbackProvenance,
  financeFrom,
  healthFrom,
  infraSummaryFrom,
  itemsOf,
  mapContextDirectives,
  mapHojePayloads,
  provenanceOf,
} from "./map";
import {
  AUTHORIZED_WRITE_PATH,
  WARMBLY_DISPATCH_PATHS,
  WARMBLY_OPERATOR_LEDGER_PATH,
  WRITE_SHORTCUT_DIRECTIVE_KIND,
  WRITE_SHORTCUT_KINDS,
  destinationUsesContext,
  isAuthorizedWritePath,
  readPathsFor,
  type WriteShortcutKind,
} from "./paths";

/**
 * What the operator reads as the detail line.
 *
 * The channel writes `reason` only on a refusal; an executed action answers
 * with `outcome`, `action` and `upstream_status` and nothing else, so the
 * sentence has to be built from those rather than falling back to the status.
 */
function dispatchMessage(body: Record<string, unknown>, status: number): string {
  if (typeof body.reason === "string" && body.reason !== "") return body.reason;
  const action = typeof body.action === "string" ? body.action : "a ação";
  if (body.outcome === "executed") {
    const upstream = typeof body.upstream_status === "number" ? ` (Warmbly respondeu HTTP ${body.upstream_status})` : "";
    return `Warmbly aceitou ${action}${upstream}.`;
  }
  if (body.outcome === "challenged") {
    return `Confirmação emitida para ${action}. Ela vence sozinha, vale uma vez só e é ligada a quem a pediu.`;
  }
  return `O canal respondeu HTTP ${status} sem explicação legível.`;
}

function stringValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

const REVIEW_PAGE_LIMIT = 100;

class HttpReadError extends Error {
  constructor(readonly status: number, path: string) {
    super(`Backend operacional indisponível (${status} ${path}).`);
    this.name = "HttpReadError";
  }
}

function reviewOffsetOf(location: string | undefined): number {
  const raw = queryParamsOf(location ?? "").offset;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed <= 100_000 ? parsed : 0;
}

function reviewPageFrom(
  payload: Record<string, unknown> | null | undefined,
  loadedCount: number,
  requestedOffset: number,
): Record<string, unknown> {
  const fallback = {
    limit: REVIEW_PAGE_LIMIT,
    offset: requestedOffset,
    loaded_count: loadedCount,
    coverage_status: "UNPROVEN",
  };
  if (payload?.schema_version !== "control-center.review-draft-page.v1") return fallback;
  const page = asRecord(payload.page);
  if (
    !page ||
    page.limit !== REVIEW_PAGE_LIMIT ||
    page.offset !== requestedOffset ||
    page.loaded_count !== loadedCount
  ) return fallback;

  if (page.coverage_status === "TOTAL_KNOWN") {
    const total = page.total_count;
    const remaining = page.remaining_count;
    const hasMore = page.has_more;
    const pageEnd = requestedOffset + loadedCount;
    if (
      typeof total !== "number" || !Number.isSafeInteger(total) || total < pageEnd ||
      typeof remaining !== "number" || remaining !== total - pageEnd ||
      typeof hasMore !== "boolean" || hasMore !== (pageEnd < total) ||
      (hasMore && loadedCount !== REVIEW_PAGE_LIMIT) ||
      (hasMore && page.next_offset !== pageEnd) ||
      (!hasMore && page.next_offset !== undefined)
    ) return fallback;
    return {
      ...fallback,
      coverage_status: "TOTAL_KNOWN",
      total_count: total,
      remaining_count: remaining,
      has_more: hasMore,
      ...(hasMore ? { next_offset: pageEnd } : {}),
    };
  }

  if (page.coverage_status === "PAGE_ONLY") {
    const hasMore = page.has_more;
    const pageEnd = requestedOffset + loadedCount;
    if (
      typeof hasMore !== "boolean" ||
      (hasMore && (loadedCount !== REVIEW_PAGE_LIMIT || page.next_offset !== pageEnd)) ||
      (!hasMore && page.next_offset !== undefined)
    ) return fallback;
    return {
      ...fallback,
      coverage_status: "PAGE_ONLY",
      has_more: hasMore,
      ...(hasMore ? { next_offset: pageEnd } : {}),
    };
  }
  return fallback;
}

function validReceiptInstant(value: string, now = Date.now()): boolean {
  if (!isUtcDateTime(value)) return false;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed) || parsed > now) return false;
  const inputSecond = value.replace(/\.\d{1,9}Z$/, "Z");
  const parsedSecond = new Date(parsed).toISOString().replace(/\.\d{3}Z$/, "Z");
  return inputSecond === parsedSecond;
}

type ReviewDraftAction = "SAVE_ADJUSTMENT" | "APPROVE" | "REJECT";

function reviewDecisionFailure(
  path: string,
  message: string,
  status?: number,
  code = "review_result_not_confirmed",
): AdapterWriteResult {
  return {
    ok: false,
    path,
    kind: "nota",
    message,
    outcome: "unknown",
    code,
    ...(status === undefined ? {} : { status }),
    readback: { status: "not_confirmed", detail: message },
  };
}

function reviewDecisionResult(
  input: { id: string; action: ReviewDraftAction; expected_content_hash: string },
  path: string,
  idempotency: string,
  status: number,
  payload: unknown,
): AdapterWriteResult {
  const body = asRecord(payload);
  const readback = asRecord(body?.readback);
  const outcome = stringValue(body ?? {}, "outcome");
  const action = stringValue(body ?? {}, "action");
  const touchpointId = stringValue(body ?? {}, "touchpoint_id");
  const expectedContentHash = stringValue(body ?? {}, "expected_content_hash");
  const correlationId = stringValue(body ?? {}, "correlation_id");
  const observedAt = stringValue(body ?? {}, "observed_at");
  const message = stringValue(body ?? {}, "message");
  const readbackStatus = stringValue(readback ?? {}, "status");
  const readbackDetail = stringValue(readback ?? {}, "detail");
  const envelopeValid =
    body?.schema_version === "control-center.review-decision-receipt.v1" &&
    (outcome === "confirmed" || outcome === "not_confirmed") &&
    action === input.action &&
    touchpointId === input.id &&
    expectedContentHash === input.expected_content_hash &&
    correlationId === idempotency &&
    observedAt !== undefined &&
    validReceiptInstant(observedAt) &&
    message !== undefined &&
    (readbackStatus === "confirmed" || readbackStatus === "not_confirmed" || readbackStatus === "unavailable") &&
    readbackDetail !== undefined;
  if (!envelopeValid) {
    return reviewDecisionFailure(
      path,
      "Resultado não confirmado. Não repita ainda: o servidor retornou um recibo incompatível.",
      status,
      "review_receipt_invalid",
    );
  }

  const evidence = {
    action: action as ReviewDraftAction,
    touchpointId: touchpointId!,
    expectedContentHash: expectedContentHash!,
    ...(stringValue(body, "content_hash") ? { contentHash: stringValue(body, "content_hash")! } : {}),
    ...(stringValue(body, "approved_content_hash")
      ? { approvedContentHash: stringValue(body, "approved_content_hash")! }
      : {}),
    ...(stringValue(body, "state") ? { state: stringValue(body, "state")! } : {}),
    ...(stringValue(body, "due_at") ? { dueAt: stringValue(body, "due_at")! } : {}),
    ...(stringValue(body, "scheduled_for") ? { scheduledFor: stringValue(body, "scheduled_for")! } : {}),
    ...(stringValue(body, "approved_by") ? { approvedBy: stringValue(body, "approved_by")! } : {}),
    ...(stringValue(body, "approved_at") ? { approvedAt: stringValue(body, "approved_at")! } : {}),
    observedAt: observedAt!,
  };
  const adapterReadback = {
    status: readbackStatus === "confirmed"
      ? "confirmed" as const
      : readbackStatus === "unavailable"
        ? "unavailable" as const
        : "not_confirmed" as const,
    detail: readbackDetail!,
  };
  if (outcome !== "confirmed") {
    return {
      ...reviewDecisionFailure(path, message!, status),
      readback: adapterReadback,
      reviewDecision: evidence,
    };
  }

  const receiptId = stringValue(body, "receipt_id");
  const contentHash = stringValue(body, "content_hash");
  const state = stringValue(body, "state");
  let confirmationFailure: string | undefined;
  if (!receiptId || !contentHash || !state || readbackStatus !== "confirmed") {
    confirmationFailure = "receipt, hash, estado ou readback confirmado ausente";
  } else if (input.action === "APPROVE") {
    const approvedHash = stringValue(body, "approved_content_hash");
    const approvedBy = stringValue(body, "approved_by");
    const approvedAt = stringValue(body, "approved_at");
    const dueAt = stringValue(body, "due_at");
    const scheduledFor = stringValue(body, "scheduled_for");
    if (contentHash !== input.expected_content_hash || approvedHash !== input.expected_content_hash) {
      confirmationFailure = "o servidor não confirmou o hash exato aprovado";
    } else if (state !== "QUEUED" && state !== "SENT") {
      confirmationFailure = "APPROVE não foi observado em QUEUED ou SENT";
    } else if (!approvedBy || !approvedAt || !isUtcDateTime(approvedAt)) {
      confirmationFailure = "ator ou instante de aprovação ausente";
    } else if (
      state === "QUEUED" &&
      (!dueAt || !scheduledFor || !isUtcDateTime(dueAt) || dueAt !== scheduledFor)
    ) {
      confirmationFailure = "QUEUED não possui due_at/scheduled_for confirmado";
    }
  } else if (input.action === "REJECT") {
    if (contentHash !== input.expected_content_hash || state !== "REJECTED_REWRITE_PENDING") {
      confirmationFailure = "REJECT não foi confirmado sobre o hash e estado esperados";
    }
  } else if (state !== "NEEDS_REVIEW" && state !== "DRAFTED") {
    confirmationFailure = "SAVE_ADJUSTMENT não permaneceu em revisão";
  }
  if (confirmationFailure) {
    return {
      ...reviewDecisionFailure(
        path,
        `Resultado não confirmado. Não repita ainda: ${confirmationFailure}.`,
        status,
        "review_confirmation_invalid",
      ),
      reviewDecision: evidence,
    };
  }

  return {
    ok: true,
    path,
    kind: "nota",
    message: message!,
    outcome: "executed",
    status,
    receipt: {
      id: receiptId!,
      correlation_id: correlationId!,
      occurred_at: observedAt!,
      outcome: "accepted",
      target: touchpointId!,
      writes_to: "warmbly",
    },
    readback: adapterReadback,
    reviewDecision: evidence,
  };
}

/* ------------------------------------------------------------------ *
 * Human-gate response reading.
 *
 * The channel answers every gate write with the same envelope shape, so the
 * only way to tell a created cohort from a recorded HOLD is to read the action
 * back out and to keep the resource the server named. Collapsing all of them
 * into one "Decisão registrada" — and dropping the returned resource — is what
 * left the operator with no way to reach the version they had just created.
 * ------------------------------------------------------------------ */

function gateText(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (typeof value === "string" && value.trim() !== "") return value;
  return undefined;
}

function gateNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The cohort payload, whether the server nests it or answers it at the root. */
function gateCohortOf(body: Record<string, unknown>): Record<string, unknown> | undefined {
  const nested = asRecord(body.cohort);
  if (nested && typeof nested.id === "string") return nested;
  return typeof body.id === "string" ? body : undefined;
}

function gateDiffOf(
  adjustment: Record<string, unknown> | null | undefined,
): AdapterWriteResult["diff"] {
  if (!adjustment || !Array.isArray(adjustment.diff)) return undefined;
  const rows = adjustment.diff
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => ({
      field: String(entry.field ?? ""),
      ...(typeof entry.before === "string" ? { before: entry.before } : {}),
      ...(typeof entry.after === "string" ? { after: entry.after } : {}),
    }))
    .filter((entry) => entry.field !== "");
  return rows.length > 0 ? rows : undefined;
}

/**
 * The prose an operator reads when the server sent none.
 *
 * The channel's own success bodies carry a receipt and nothing else, so the
 * sentence has to come from the action that was actually performed.
 */
function gateFallbackMessage(input: WarmblyGateInput, version: number | undefined): string {
  const v = version === undefined ? "" : ` v${version}`;
  switch (input.action) {
    case "create":
      return `Cohort congelada criada${v}.`;
    case "reproduce":
      return `Reprodução da versão imutável concluída${v}.`;
    case "validate":
      return "Verificação do destinatário solicitada ao Warmbly.";
    case "review":
      return input.decision === "APPROVE"
        ? "Aprovação registrada e mensagem agendada para a próxima janela comercial."
        : input.decision === "HOLD"
          ? "HOLD registrado para este candidato."
          : "Rejeição registrada para este candidato.";
    case "adjust":
      return `Ajuste aceito. O servidor criou a nova versão${v}.`;
    case "reconcile":
      return "Reconciliação concluída pelo mesmo caminho de agendamento do APPROVE.";
  }
}

/**
 * The counters Warmbly returns for approval reconciliation.
 *
 * Read out of the response rather than guessed from the approval history.
 * Anything the server did not send stays absent instead of becoming a zero.
 */
export function gateReconcileOf(body: Record<string, unknown>): AdapterWriteResult["reconcile"] {
  const data = asRecord(body.data) ?? body;
  const num = (key: string): number | undefined => gateNumber(data[key]);
  const counts = {
    ...(num("approval_records") !== undefined ? { approvalRecords: num("approval_records")! } : {}),
    ...(num("latest_approved_bindings") !== undefined
      ? { latestApprovedBindings: num("latest_approved_bindings")! }
      : {}),
    ...(num("unique_approved_candidates") !== undefined
      ? { uniqueApprovedCandidates: num("unique_approved_candidates")! }
      : {}),
    ...(num("scheduled") !== undefined ? { scheduled: num("scheduled")! } : {}),
    ...(num("already_scheduled") !== undefined
      ? { alreadyScheduled: num("already_scheduled")! }
      : {}),
    ...(num("failed") !== undefined ? { failed: num("failed")! } : {}),
  };
  const failures = Array.isArray(data.failures)
    ? data.failures
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => entry !== null)
        .map((entry) => ({
          ...(typeof entry.cohort_version_id === "string" ? { cohortId: entry.cohort_version_id } : {}),
          ...(typeof entry.candidate_id === "string" ? { candidateId: entry.candidate_id } : {}),
          reason: typeof entry.reason === "string" ? entry.reason : "",
        }))
        .filter((entry) => entry.cohortId !== undefined || entry.candidateId !== undefined || entry.reason !== "")
    : [];
  if (Object.keys(counts).length === 0 && failures.length === 0) return undefined;
  return { ...counts, ...(failures.length > 0 ? { failures } : {}) };
}

export function gateResult(
  input: WarmblyGateInput,
  path: string,
  status: number,
  ok: boolean,
  body: Record<string, unknown>,
): AdapterWriteResult {
  const adjustment = asRecord(body.adjustment);
  const cohort = gateCohortOf(body);
  const version =
    gateNumber(adjustment?.to_version) ?? gateNumber(cohort?.version) ?? gateNumber(body.version);
  const cohortId =
    (cohort && typeof cohort.id === "string" ? cohort.id : undefined) ?? input.version_id;
  const rawServerMessage =
    gateText(body, "message")
    ?? (Array.isArray(body.reason)
      ? body.reason.filter((row) => typeof row === "string").join(", ") || undefined
      : gateText(body, "reason"));
  // The edge stamps `reason: ["ok"]` / `["upstream_refused"]` when the upstream
  // sent no prose at all. Those are envelope filler, not a sentence, and
  // showing them would be the same "HTTP 200" non-answer in Portuguese.
  const serverMessage =
    rawServerMessage === "ok" || rawServerMessage === "upstream_refused"
      ? undefined
      : rawServerMessage;
  const rawCode = gateText(body, "code");
  // A 404 on adjust is the expected state of an install whose backend route has
  // not landed yet, not an operator mistake. It gets its own code so the UI can
  // say so and stop offering the control.
  const code =
    input.action === "adjust" && status === 404 && rawCode !== "candidate_not_found"
      ? "adjust_route_unavailable"
      : rawCode;
  const diff = gateDiffOf(adjustment);
  const receipt = gateText(body, "receipt") ?? gateText(adjustment ?? {}, "receipt");
  const correlation =
    gateText(adjustment ?? {}, "correlation_id")
    ?? gateText(body, "correlation_id")
    ?? gateText(body, "edge_correlation_id");
  const upstreamOutcome = gateText(body, "outcome")?.toUpperCase();
  const outcome = upstreamOutcome === "UNKNOWN"
    ? "unknown"
    : upstreamOutcome === "REFUSED"
      ? "refused"
      : upstreamOutcome === "APPLIED"
        ? "executed"
        : ok
          ? "executed"
          : status >= 500
            ? "unknown"
            : "refused";
  return {
    ok,
    path,
    kind: "nota",
    status,
    outcome,
    message: serverMessage ?? gateFallbackMessage(input, version),
    gateAction: input.action,
    ...(code ? { code } : {}),
    ...(input.action !== "reconcile" && (input.version_id || input.candidate_id)
      ? {
          gateTarget: {
            ...(input.version_id ? { cohort_id: input.version_id } : {}),
            ...(input.candidate_id ? { candidate_id: input.candidate_id } : {}),
          },
        }
      : {}),
    ...(ok && (cohortId || version !== undefined)
      ? {
          gateResource: {
            ...(cohortId ? { cohort_id: cohortId } : {}),
            ...(version !== undefined ? { version } : {}),
          },
        }
      : {}),
    ...(receipt ? { receiptId: receipt } : {}),
    ...(correlation ? { correlationId: correlation } : {}),
    ...(diff ? { diff } : {}),
    ...(() => {
      if (input.action !== "reconcile" || !ok) return {};
      const reconcile = gateReconcileOf(body);
      return reconcile ? { reconcile } : {};
    })(),
  };
}

async function operatorIdempotencyKey(input: {
  action_type: string;
  target_canonical_id: string;
  target_source_id: string;
  note: string;
}): Promise<string> {
  const material = new TextEncoder().encode(JSON.stringify([
    input.action_type,
    input.target_canonical_id,
    input.target_source_id,
    input.note,
  ]));
  if (globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", material));
    const token = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
    return `cc-web:${input.action_type}:${token}`;
  }
  // Test/legacy fallback only. A collision is rejected by the server's
  // conflicting-payload guard; no operator prose is copied into the key.
  let hash = 0x811c9dc5;
  for (const byte of material) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return `cc-web:${input.action_type}:fnv-${hash.toString(16).padStart(8, "0")}`;
}

export class HttpControlCenterAdapter implements ControlCenterReadAdapter {
  readonly mode = "http" as const;
  readonly actions: readonly AdapterAction[] = ADAPTER_ACTIONS;
  lastOperatorResult?: AdapterWriteResult;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly operator: ActorRef;

  constructor(options: { baseUrl: string; fetchImpl?: typeof fetch; operator?: ActorRef }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.operator = options.operator ?? { kind: "human", id: "human:operator", display_name: "Operador" };
  }

  readOperator(): ActorRef {
    return { ...this.operator };
  }

  async readDestination(id: DestinationId, location?: string): Promise<AdapterReadResult> {
    try {
      const page = await this.loadPage(id, location);
      return { ok: true, loading: false, page };
    } catch (err) {
      const denied = err instanceof HttpReadError && (err.status === 401 || err.status === 403);
      return {
        ok: false,
        loading: false,
        error: {
          code: denied ? "PERMISSION_DENIED" : "CONTEXT_UNAVAILABLE",
          message:
            err instanceof Error
              ? err.message
              : "Backend operacional indisponível. Nenhuma origem mock foi usada.",
        },
      };
    }
  }

  async readAttention(): Promise<AttentionItem[]> {
    const result = await this.readDestination("hoje");
    if (!result.ok || result.loading) return [];
    return result.page.attention;
  }

  async readPriorities(): Promise<PriorityRecommendation[]> {
    const result = await this.readDestination("hoje");
    if (!result.ok || result.loading) return [];
    return result.page.priorities;
  }

  async warmblyDispatch(input: WarmblyDispatchInput): Promise<AdapterWriteResult> {
    const path = ownMapValue(WARMBLY_DISPATCH_PATHS, input.action);
    /**
     * A refusal this adapter makes on its own, before anything is written. It
     * carries `outcome: "refused"` because that is provable here: no request
     * left the browser, so Warmbly cannot have applied anything.
     */
    const fail = (message: string, code = "client_precondition"): AdapterWriteResult => {
      const denied: AdapterWriteResult = {
        ok: false,
        path: path ?? "/v1/warmbly/operator",
        kind: "nota",
        message,
        outcome: "refused",
        code,
      };
      this.lastOperatorResult = denied;
      return denied;
    };
    if (!path) {
      return fail("ação de dispatch desconhecida", "unknown_action");
    }
    // Pause and resume require an audit reason. Acknowledge deliberately does
    // not: the channel contract marks it `reason_required: false`, and the UI
    // labels that field optional.
    if (input.action !== "acknowledge" && input.reason.trim() === "") {
      return fail("motivo é obrigatório");
    }
    if (input.action === "resume" && !input.confirmation_token) {
      return fail("resume exige o token de confirmação do passo anterior");
    }
    if (input.action === "acknowledge" && !input.target_id) {
      return fail("acknowledge exige o id do alerta");
    }
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        // No x-actor-id: identity is Authelia's, resolved at the edge from the
        // session. Sending an actor header here would invite trusting it.
        headers: { accept: "application/json", "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...(input.reason.trim() !== "" ? { reason: input.reason } : {}),
          ...(input.confirmation_token ? { confirmation_token: input.confirmation_token } : {}),
          ...(input.target_id ? { target_id: input.target_id } : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      // The channel answers a refusal with `code`+`reason` and a success with
      // `outcome`+`action` and no prose at all. Both travel: the status alone
      // cannot separate an open circuit from a lost answer — both are 503 — and
      // a bare "HTTP 200" is not a sentence an operator can act on.
      const result: AdapterWriteResult = {
        ok: response.ok,
        path,
        kind: "nota",
        message: dispatchMessage(body, response.status),
        status: response.status,
        ...(typeof body.outcome === "string" ? { outcome: body.outcome } : {}),
        ...(typeof body.code === "string" ? { code: body.code } : {}),
        ...(typeof body.confirmation_token === "string"
          ? { confirmationToken: body.confirmation_token }
          : {}),
        ...(stringValue(body, "correlation_id") && stringValue(body, "recorded_at")
          ? {
              receipt: {
                id: stringValue(body, "ledger_id") ?? stringValue(body, "correlation_id")!,
                correlation_id: stringValue(body, "correlation_id")!,
                occurred_at: stringValue(body, "recorded_at")!,
                outcome: stringValue(body, "outcome") ?? (response.ok ? "executed" : "refused"),
                writes_to: "warmbly" as const,
              },
            }
          : {}),
      };
      this.lastOperatorResult = result;
      return result;
    } catch (err) {
      // A transport failure here says nothing about whether Warmbly applied the
      // change; the channel reports `unknown` for exactly this reason. Calling
      // it "refused" would tell the operator that nothing happened, which this
      // adapter cannot know.
      const unresolved: AdapterWriteResult = {
        ok: false,
        path,
        kind: "nota",
        message: `falha de transporte: ${err instanceof Error ? err.name : "erro"}`,
        outcome: "unknown",
        code: "browser_transport",
      };
      this.lastOperatorResult = unresolved;
      return unresolved;
    }
  }

  async warmblyGate(input: WarmblyGateInput): Promise<AdapterWriteResult> {
    const base = "/v1/warmbly/operator/cohorts";
    const version = input.version_id ?? "";
    const candidate = input.candidate_id ?? "";
    const path = input.action === "create" ? base
      : input.action === "reconcile" ? `${base}/reconcile-approved`
      : input.action === "reproduce" ? `${base}/${version}/reproduce`
      : input.action === "validate" ? `${base}/${version}/candidates/${candidate}/validation`
      : input.action === "review" ? `${base}/${version}/candidates/${candidate}/review`
      : `${base}/${version}/candidates/${candidate}/adjust`;
    // Every refusal below happens before the wire, so "nada foi aplicado" is a
    // fact this adapter can prove rather than a hope.
    const target = input.action === "reconcile"
      ? {}
      : {
          ...(version ? { cohort_id: version } : {}),
          ...(candidate ? { candidate_id: candidate } : {}),
        };
    const refuse = (message: string, code: string): AdapterWriteResult => {
      const refusal: AdapterWriteResult = {
        ok: false,
        path,
        kind: "nota",
        message,
        outcome: "refused",
        code,
        gateAction: input.action,
        ...(Object.keys(target).length > 0 ? { gateTarget: target } : {}),
      };
      this.lastOperatorResult = refusal;
      return refusal;
    };
    if (
      (input.action !== "create" && input.action !== "reconcile" && !version)
      || (["validate", "review", "adjust"].includes(input.action) && !candidate)
    ) {
      return refuse("alvo do gate incompleto", "gate_precondition");
    }
    if (
      input.action === "create"
      && input.selection_mode === "RECOVER_PRIOR"
      && (!input.recover_version_ids || input.recover_version_ids.length === 0)
    ) {
      return refuse("selecione ao menos uma versão anterior para recuperar", "recover_versions_required");
    }
    // The acknowledgement stays on the wire and stays mandatory here. What
    // changed is where it comes from: the reviewer's click on Aprovar is the
    // acknowledgement, and the button says so above itself, so there is no
    // second checkbox asking them to declare the action they just took. This
    // guard therefore no longer describes a control — it is the invariant that
    // stops any other caller from constructing an APPROVE without one.
    if (input.action === "review" && input.decision === "APPROVE" && input.acknowledged !== true) {
      return refuse(
        "APPROVE exige ciência explícita do destinatário, mensagem, policy e evidência",
        "approval_acknowledgement_required",
      );
    }
    if (
      input.action === "review"
      && (input.decision === "HOLD" || input.decision === "REJECT")
      && !input.reason?.trim()
    ) {
      return refuse("HOLD/REJECT exige motivo escrito", "gate_precondition");
    }
    if (input.action === "adjust") {
      // The three editable fields plus the two anti-clobber tokens. An adjust
      // that cannot name the frozen hash it was written against is an edit
      // against an unknown baseline, and the server is right to reject it —
      // this refuses it one hop earlier, without spending an attempt.
      if (!input.subject?.trim() || !input.body_text?.trim() || !input.reason?.trim()) {
        return refuse(
          "ajuste exige assunto, corpo e motivo preenchidos",
          "gate_precondition",
        );
      }
      if (!input.confirmation?.trim()) {
        return refuse("ajuste exige a confirmação digitada da versão", "confirmation_mismatch");
      }
      if (!input.expected_frozen_hash?.trim()) {
        return refuse(
          "ajuste exige o frozen hash da versão revisada",
          "gate_precondition",
        );
      }
    }
    // An ordinary approval carries no typed motive, and the trail must not
    // record an empty one. `approved_by_human_reviewer` is what "o revisor leu
    // e aprovou" looks like as data; a comment the reviewer did write always
    // wins over it.
    const reason =
      input.reason?.trim()
      || (input.action === "review" && input.decision === "APPROVE" ? APPROVAL_DEFAULT_REASON : "");
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          idempotency_key: input.idempotency_key,
          ...(input.limit ? { limit: input.limit } : {}),
          ...(input.selection_mode ? { selection_mode: input.selection_mode } : {}),
          ...(input.recover_version_ids && input.recover_version_ids.length > 0
            ? { recover_version_ids: [...input.recover_version_ids].sort() }
            : {}),
          ...(input.decision ? { decision: input.decision } : {}),
          ...(reason ? { reason } : {}),
          ...(input.acknowledged === true ? { acknowledged: true } : {}),
          ...(input.confirmation ? { confirmation: input.confirmation.trim().toLowerCase() } : {}),
          ...(input.action === "adjust"
            ? {
                subject: input.subject,
                body_text: input.body_text,
                expected_frozen_hash: input.expected_frozen_hash,
              }
            : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const result = gateResult(input, path, response.status, response.ok, body);
      this.lastOperatorResult = result;
      return result;
    } catch {
      const result: AdapterWriteResult = {
        ok: false,
        path,
        kind: "nota",
        outcome: "unknown",
        code: "browser_transport",
        message: "Sem resposta; releia o recurso antes de repetir.",
        gateAction: input.action,
        ...(Object.keys(target).length > 0 ? { gateTarget: target } : {}),
      };
      this.lastOperatorResult = result;
      return result;
    }
  }

  async operatorAction(input: {
    action_type: string;
    target_canonical_id: string;
    target_source_id: string;
    note: string;
    idempotency_key?: string;
  }): Promise<AdapterWriteResult> {
    const forbidden = [
      "SEND_CAMPAIGN",
      "SEND_EMAIL",
      "SEND_WHATSAPP",
      "AUTO_SEND_ENABLE",
      "CHARGE",
      "REFUND",
      "PAYMENT",
    ];
    if (forbidden.includes(input.action_type)) {
      const denied: AdapterWriteResult = {
        ok: false,
        path: "/v1/operator-actions",
        kind: "nota",
        message: "ação comercial proibida",
      };
      this.lastOperatorResult = denied;
      return denied;
    }
    try {
      const idempotency = input.idempotency_key ?? await operatorIdempotencyKey(input);
      const response = await this.fetchImpl(`${this.baseUrl}/v1/operator-actions`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          action_type: input.action_type,
          target_canonical_id: input.target_canonical_id,
          target_source_id: input.target_source_id,
          note: input.note,
          idempotency_key: idempotency,
          correlation_id: idempotency,
          scope: "commercial",
        }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        const error = body.error && typeof body.error === "object" && !Array.isArray(body.error)
          ? (body.error as Record<string, unknown>)
          : {};
        const detail = stringValue(body, "message") ?? stringValue(body, "reason") ?? stringValue(error, "message");
        const denied: AdapterWriteResult = {
          ok: false,
          path: "/v1/operator-actions",
          kind: "nota",
          message: `recusado (${response.status})${detail ? `: ${detail}` : ""}`,
          outcome: "refused",
          code: `http_${response.status}`,
          status: response.status,
        };
        this.lastOperatorResult = denied;
        return denied;
      }
      const actor = body.actor && typeof body.actor === "object" && !Array.isArray(body.actor)
        ? (body.actor as Record<string, unknown>)
        : {};
      const resultingStatus = stringValue(body, "resulting_status");
      const receiptId = stringValue(body, "id");
      const correlationId = stringValue(body, "correlation_id");
      const occurredAt = stringValue(body, "occurred_at");
      const receiptIsValid =
        (resultingStatus === "accepted" || resultingStatus === "duplicate") &&
        Boolean(receiptId && correlationId && occurredAt && validReceiptInstant(occurredAt)) &&
        correlationId === idempotency &&
        stringValue(body, "action_type") === input.action_type &&
        stringValue(body, "target_canonical_id") === input.target_canonical_id &&
        stringValue(body, "target_source_id") === input.target_source_id &&
        stringValue(actor, "kind") === "human" &&
        stringValue(actor, "id") === this.operator.id;
      if (!receiptIsValid) {
        const unproven: AdapterWriteResult = {
          ok: false,
          path: "/v1/operator-actions",
          kind: "nota",
          message: "a resposta não trouxe um receipt íntegro; a gravação permanece indeterminada",
          outcome: "unknown",
          code: "invalid_operator_receipt",
          status: response.status,
        };
        this.lastOperatorResult = unproven;
        return unproven;
      }
      const accepted: AdapterWriteResult = {
        ok: true,
        path: "/v1/operator-actions",
        kind: "nota",
        message: resultingStatus === "duplicate"
          ? "requisição duplicada: o receipt original foi preservado; Warmbly não foi alterado"
          : "ação registrada no Control Center; Warmbly não foi alterado",
        outcome: resultingStatus!,
        receipt: {
          id: receiptId!,
          correlation_id: correlationId!,
          occurred_at: occurredAt!,
          outcome: resultingStatus!,
          actor_id: stringValue(actor, "id")!,
          target: input.target_canonical_id,
          writes_to: "control-center" as const,
        },
      };
      this.lastOperatorResult = accepted;
      return accepted;
    } catch (err) {
      const failed: AdapterWriteResult = {
        ok: false,
        path: "/v1/operator-actions",
        kind: "nota",
        message: err instanceof Error ? err.message : "gravação indisponível",
        outcome: "unknown",
        code: "browser_transport",
      };
      this.lastOperatorResult = failed;
      return failed;
    }
  }

  async reviewDraftAction(input: {
    id: string;
    action: "SAVE_ADJUSTMENT" | "APPROVE" | "REJECT";
    expected_content_hash: string;
    subject?: string;
    body_text?: string;
    reason?: string;
    generic_recipient_acknowledged?: boolean;
  }): Promise<AdapterWriteResult> {
    const path = `/v1/commercial/review-drafts/${encodeURIComponent(input.id)}`;
    const idempotency = `review:${input.action}:${input.id}:${input.expected_content_hash}`;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "idempotency-key": idempotency,
        },
        credentials: "include",
        body: JSON.stringify(input),
      });
      const raw = await response.text();
      if (!response.ok) {
        let message = `decisão recusada (${response.status})`;
        try {
          const body = JSON.parse(raw) as { message?: string };
          if (body.message) message = body.message;
        } catch {
          // The status remains the safe diagnostic.
        }
        const failed: AdapterWriteResult = {
          ...reviewDecisionFailure(path, message, response.status, "review_write_refused"),
          outcome: response.status >= 500 ? "unknown" : "refused",
        };
        this.lastOperatorResult = failed;
        return failed;
      }
      let payload: unknown;
      try {
        payload = raw.trim() === "" ? undefined : JSON.parse(raw) as unknown;
      } catch {
        payload = undefined;
      }
      const result = reviewDecisionResult(input, path, idempotency, response.status, payload);
      this.lastOperatorResult = result;
      return result;
    } catch (err) {
      const failed: AdapterWriteResult = {
        ...reviewDecisionFailure(
          path,
          `Resultado não confirmado. Não repita ainda: ${err instanceof Error ? err.message : "Warmbly indisponível"}.`,
          undefined,
          "browser_transport",
        ),
      };
      this.lastOperatorResult = failed;
      return failed;
    }
  }

  async writeShortcut(kind: WriteShortcutKind, draft: { title: string; body: string }): Promise<AdapterWriteResult> {
    if (!(WRITE_SHORTCUT_KINDS as readonly string[]).includes(kind)) {
      return { ok: false, path: AUTHORIZED_WRITE_PATH, kind, message: "atalho não autorizado" };
    }
    const title = draft.title.trim();
    const body = draft.body.trim();
    if (!title || !body) {
      return { ok: false, path: AUTHORIZED_WRITE_PATH, kind, message: "título e corpo são obrigatórios" };
    }
    const observed_at = new Date().toISOString();
    const payload = {
      kind: ownMapValue(WRITE_SHORTCUT_DIRECTIVE_KIND, kind) ?? "fact",
      title,
      body,
      scope: "company",
      source: {
        system: "control-center",
        kind: "founder-shortcut",
        locator: "hoje",
      },
      observed_at,
      freshness_status: "FRESH",
      confidence: 1,
    };
    if (!isAuthorizedWritePath(AUTHORIZED_WRITE_PATH)) {
      return { ok: false, path: AUTHORIZED_WRITE_PATH, kind, message: "write path not authorized" };
    }
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${AUTHORIZED_WRITE_PATH}`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-actor-id": this.operator.id,
          "x-actor-kind": this.operator.kind,
        },
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      if (!response.ok) {
        return {
          ok: false,
          path: AUTHORIZED_WRITE_PATH,
          kind,
          message: `gravação recusada (${response.status})`,
        };
      }
      void text;
      return {
        ok: true,
        path: AUTHORIZED_WRITE_PATH,
        kind,
        message: "gravado no Context Service",
      };
    } catch (err) {
      return {
        ok: false,
        path: AUTHORIZED_WRITE_PATH,
        kind,
        message: err instanceof Error ? err.message : "gravação indisponível",
      };
    }
  }

  private async loadPage(id: DestinationId, location?: string): Promise<DestinationPage> {
    const fallback = fallbackProvenance(this.baseUrl || "relative", new Date().toISOString());
    if (id === "hoje") {
      return this.loadHoje(fallback);
    }
    if (id === "memoria") {
      return this.loadMemoria(fallback);
    }
    if (id === "agentes") {
      return this.loadAgentes(fallback);
    }
    return this.loadDomain(id, fallback, location);
  }

  private async loadHoje(fallback: Provenance): Promise<DestinationPage> {
    const paths = readPathsFor("hoje");
    const [today, attentionNow, attentionToday, snapshot, activities] = await Promise.all(
      paths.map((path) => this.getJson(path)),
    );
    const composeInput = mapHojePayloads({
      today,
      attentionNow,
      attentionToday,
      snapshot,
      activities,
      fallback,
    });
    return composePageFromHojeInput("hoje", this.readOperator(), composeInput);
  }

  private async loadMemoria(fallback: Provenance): Promise<DestinationPage> {
    if (!destinationUsesContext("memoria")) {
      throw new Error("memoria must use /v1/context");
    }
    const [path] = readPathsFor("memoria");
    const ctx = asRecord(await this.getJson(path!));
    if (!ctx) throw new Error("context payload is not an object");
    const dest = getDestination("memoria");
    const directives = mapContextDirectives(ctx, fallback);
    return {
      id: "memoria",
      label: dest.label,
      scope: dest.scope,
      generated_at: String(ctx.observed_at ?? fallback.observed_at),
      operator: this.readOperator(),
      headline: dest.description,
      attention: [],
      priorities: [],
      directives,
    };
  }

  private async loadAgentes(fallback: Provenance): Promise<DestinationPage> {
    const [path] = readPathsFor("agentes");
    const payload = await this.getJson(path!);
    const dest = getDestination("agentes");
    const activities = itemsOf(payload).map((row) => activityFrom(asRecord(row) ?? {}, fallback));
    return {
      id: "agentes",
      label: dest.label,
      scope: dest.scope,
      generated_at: fallback.observed_at,
      operator: this.readOperator(),
      headline: dest.description,
      attention: [],
      priorities: [],
      activities,
    };
  }

  private domainBody(payload: unknown, fallback: Provenance): Record<string, unknown> {
    const rec = asRecord(payload) ?? {};
    const slot = asRecord(rec.snapshot) ?? rec;
    const nested = asRecord(slot.snapshot);
    const body = { ...(nested ?? slot) };
    if (!body.freshness_status) body.freshness_status = slot.freshness_status ?? rec.freshness_status ?? fallback.freshness_status;
    if (!body.observed_at) body.observed_at = slot.observed_at ?? rec.generated_at ?? fallback.observed_at;
    if (!asRecord(body.source) && asRecord(slot.source)) body.source = slot.source;
    if (!asRecord(body.provenance)) {
      body.provenance = {
        source: body.source ?? slot.source ?? fallback.source,
        observed_at: body.observed_at,
        freshness_status: body.freshness_status,
        confidence: body.confidence ?? slot.confidence ?? fallback.confidence,
      };
    }
    return body;
  }

  private commercialListPath(id: DestinationId, location?: string): string | null {
    if (id !== "comercial" || !location) return null;
    const surface = parseHash(location).surface;
    const list = surface === "atividade" ? "activity" : surface === "excecoes" ? "exceptions" : null;
    if (!list) return null;
    const current = queryParamsOf(location);
    const params = new URLSearchParams({ scope: getDestination(id).scope });
    for (const key of LIST_PARAM_IDS) {
      const value = current[key];
      if (value !== undefined && value !== "") params.set(key, value);
    }
    return `/v1/domains/commercial/lists/${list}?${params.toString()}`;
  }

  private async loadDomain(id: DestinationId, fallback: Provenance, location?: string): Promise<DestinationPage> {
    const paths = readPathsFor(id);
    const listPath = this.commercialListPath(id, location);
    const payloads = await Promise.all([
      ...paths.map((path) => this.getJson(path)),
      ...(listPath ? [this.getJson(listPath).catch(() => undefined)] : []),
    ]);
    const payload = payloads[0];
    const dest = getDestination(id);
    const rec = asRecord(payload) ?? {};
    const inner = this.domainBody(payload, fallback);
    const page: DestinationPage = {
      id,
      label: dest.label,
      scope: dest.scope,
      generated_at: String(inner.generated_at ?? rec.generated_at ?? fallback.observed_at),
      operator: this.readOperator(),
      headline: dest.description,
      attention: [],
      priorities: [],
    };
    if (id === "comercial" || id === "crescimento" || id === "warmbly") {
      page.commercial = commercialFrom(inner, fallback);
      if (id === "comercial") {
        // During a rolling deployment the read model may precede the review
        // proxy. A 404 means the optional surface is not available yet; it
        // must not blank the rest of the commercial cockpit.
        const reviewOffset = reviewOffsetOf(location);
        const reviewPayload = asRecord(await this.readReviewJson(
          `/v1/commercial/review-drafts?limit=${REVIEW_PAGE_LIMIT}&offset=${reviewOffset}`,
        ));
        const reviewRows = itemsOf(reviewPayload?.data ?? reviewPayload);
        page.commercial.operations = {
          ...(page.commercial.operations ?? {}),
          review_drafts: reviewRows,
          review_draft_page: reviewPageFrom(reviewPayload, reviewRows.length, reviewOffset),
        };
      }
    }
    if (id === "comercial" && page.commercial && listPath) {
      const listPayload = asRecord(payloads[paths.length]);
      if (listPayload) {
        const list = listPayload.list === "activity" ? "activity" : listPayload.list === "exceptions" ? "exceptions" : null;
        if (list) {
          const ops = (page.commercial.operations ??= {});
          ops[list] = itemsOf(listPayload.items);
          const views = asRecord(ops.list_views) ?? {};
          views[list === "activity" ? "atividade" : "excecoes"] = listPayload;
          ops.list_views = views;
        }
      }
    }
    // Only the operation cockpit renders the audit trail, so only it pays for
    // the extra GET. Comercial stopped rendering the dispatch controls when
    // they moved to their own route.
    if (id === "warmbly" && page.commercial) {
      const parsed = parseHash(location ?? "#/warmbly");
      // Every Warmbly surface now reads the gate, because the operation cockpit
      // opens on a stepper that has to say where the pilot actually stands. A
      // gate the channel cannot serve must not take the whole destination down
      // with it, so these reads are soft and report their own status.
      const [list, outboundStatus] = await Promise.all([
        this.readGate("/v1/warmbly/operator/cohorts?limit=50"),
        this.readGate("/v1/warmbly/operator/outbound-status"),
      ]);
      const selected = parsed.resource
        ? await this.readGate(`/v1/warmbly/operator/cohorts/${encodeURIComponent(parsed.resource)}`)
        : undefined;
      page.warmbly_gate = {
        list: list.data ?? {},
        list_status: list.status,
        ...(list.detail ? { list_detail: list.detail } : {}),
        outbound_status: outboundStatus.data ?? {},
        outbound_status_status: outboundStatus.status,
        ...(outboundStatus.detail ? { outbound_status_detail: outboundStatus.detail } : {}),
        ...(selected
          ? {
              selected: selected.data ?? {},
              selected_status: selected.status,
              ...(selected.detail ? { selected_detail: selected.detail } : {}),
            }
          : {}),
      };
      if (parsed.surface !== "cohorts" && parsed.surface !== "revisao") {
        await this.attachOperatorLedger(page.commercial);
      }
    }
    if (id === "crescimento" && payloads[1]) {
      const pncp = this.domainBody(payloads[1], fallback);
      page.health = [healthFrom(pncp, fallback)];
    } else if (id === "financeiro") {
      page.finance = financeFrom(inner, fallback);
    } else if (id === "engenharia") {
      page.engineering = engineeringFrom(inner, fallback);
    } else if (id === "clientes") {
      // Only real client rows. The `[inner]` fallback that used to sit at the end
      // of this chain handed the *snapshot envelope* to the client mapper
      // whenever `clients` was absent or empty — which the shipped clients
      // snapshot is — and the mapper defaulted it into `client:unknown` /
      // "Cliente" / every source UNKNOWN: the card reported in issue #70.
      // A snapshot with no clients has no clients.
      const list = itemsOf(inner.clients);
      const rows = list.length > 0 ? list : itemsOf(payload);
      const clients: ClientStatus[] = [];
      const gaps: ClientIdentityException[] = [];
      rows.forEach((row, index) => {
        const rec = asRecord(row) ?? {};
        const client = maybeClientFrom(rec, fallback);
        if (client !== null) {
          clients.push(client);
          return;
        }
        // A published row that fails the identity rule is not dropped silently:
        // it joins the queue so the operator can see and correct it.
        gaps.push(clientIdentityGapFrom(rec, index, fallback));
      });
      page.clients = clients;
      // The producer's own queue is authoritative: it knows the origin, the
      // reason code and the correction. The reader must never invent them.
      page.client_data_quality = [...clientDataQualityFrom(inner, fallback), ...gaps];
    } else if (id === "infra") {
      const list = itemsOf(inner.services);
      const rows = list.length > 0 ? list : itemsOf(payload).length > 0 ? itemsOf(payload) : itemsOf(rec.health);
      // Per-service rows inherit the snapshot's provenance, not the adapter's
      // "nothing is known" default. Using the generic fallback printed every
      // card as UNKNOWN with confidence 0,00 while still echoing the row's own
      // "healthy" — the freshness of the snapshot the row came from is the
      // honest floor.
      const slotProvenance = provenanceOf(inner, fallback);
      page.health = (rows.length > 0 ? rows : inner.schema_version ? [inner] : []).map((row) =>
        healthFrom(asRecord(row) ?? {}, slotProvenance),
      );
      page.health_summary = infraSummaryFrom(inner, slotProvenance);
    }
    return page;
  }

  /**
   * Attaches the recent operator audit trail to the commercial snapshot.
   *
   * Best effort on purpose: the channel is off by default and answers 404, and
   * a cockpit that cannot read its own audit trail must still render the
   * dispatch state. What it must never do is let "unreadable" look like
   * "empty", so the read status is recorded explicitly and the surface says
   * which of the two it is looking at.
   */
  private async attachOperatorLedger(commercial: { operations?: Record<string, unknown> }): Promise<void> {
    const ops = (commercial.operations ??= {});
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${WARMBLY_OPERATOR_LEDGER_PATH}`, {
        headers: { accept: "application/json" },
        credentials: "include",
      });
      if (!response.ok) {
        ops.operator_ledger_status = response.status === 404 ? "not_mounted" : "unreadable";
        ops.operator_ledger_detail = `HTTP ${response.status}`;
        return;
      }
      const body = (await response.json()) as { entries?: unknown };
      const entries = Array.isArray(body.entries)
        ? body.entries.filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
        : [];
      ops.operator_ledger_status = "read";
      ops.operator_ledger = entries;
      const latest = entries[0];
      if (latest) ops.last_operator_action = latest;
    } catch (err) {
      // Same reason as above: unreadable is not empty.
      ops.operator_ledger_status = "unreadable";
      ops.operator_ledger_detail = err instanceof Error ? err.name : "erro de transporte";
    }
  }

  /**
   * Reads one human-gate resource without ever taking the page down with it.
   *
   * Two differences from `getJson`, both deliberate:
   *
   * - No `x-actor-id`/`x-actor-kind`. These routes authenticate at the edge with
   *   Authelia; a browser-set actor has no business travelling next to them.
   * - A failure returns a status instead of throwing. "Não consegui ler" is a
   *   thing this surface must be able to say out loud; an exception here would
   *   render the whole destination as a generic error, which reads to an
   *   operator exactly like "there are no cohorts".
   */
  private async readGate(path: string): Promise<{
    status: "read" | "not_mounted" | "forbidden" | "unreadable";
    data?: Record<string, unknown>;
    detail?: string;
  }> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { accept: "application/json" },
        credentials: "include",
      });
      if (!response.ok) {
        return {
          status:
            response.status === 404
              ? "not_mounted"
              : response.status === 401 || response.status === 403
                ? "forbidden"
                : "unreadable",
          detail: `HTTP ${response.status}`,
        };
      }
      const parsed = asRecord(await response.json().catch(() => undefined));
      if (!parsed) return { status: "unreadable", detail: "resposta não é um objeto JSON" };
      return { status: "read", data: parsed };
    } catch (err) {
      return {
        status: "unreadable",
        detail: err instanceof Error ? err.name : "erro de transporte",
      };
    }
  }

  private async readReviewJson(path: string): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: { accept: "application/json" },
      credentials: "include",
    });
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new HttpReadError(response.status, path);
    }
    try {
      return await response.json() as unknown;
    } catch {
      throw new Error(`Backend operacional devolveu JSON inválido em ${path}.`);
    }
  }

  private async getJson(path: string, allowNotFound = false): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const response = await this.fetchImpl(url, {
      headers: {
        accept: "application/json",
        "x-actor-id": this.operator.id,
        "x-actor-kind": this.operator.kind,
      },
    });
    const text = await response.text();
    if (allowNotFound && response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      throw new HttpReadError(response.status, path);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Backend operacional devolveu JSON inválido em ${path}.`);
    }
  }
}

export function createHttpAdapter(
  baseUrl: string,
  fetchImpl?: typeof fetch,
  operator?: ActorRef,
): HttpControlCenterAdapter {
  return new HttpControlCenterAdapter({
    baseUrl,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(operator ? { operator } : {}),
  });
}

export function productionActorFromDocument(
  doc: { querySelector(selector: string): { getAttribute(name: string): string | null } | null } | undefined =
    typeof document !== "undefined" ? document : undefined,
): ActorRef | undefined {
  const id = doc?.querySelector('meta[name="cc-actor-id"]')?.getAttribute("content")?.trim();
  const kind = doc?.querySelector('meta[name="cc-actor-kind"]')?.getAttribute("content")?.trim();
  if (!id || (kind !== "human" && kind !== "agent" && kind !== "system")) {
    return undefined;
  }
  return { kind, id };
}

export function productionContextUrl(): string {
  const meta =
    typeof document !== "undefined"
      ? document.querySelector('meta[name="cc-context-url"]')?.getAttribute("content")
      : null;
  if (meta && meta.trim()) {
    return meta.trim();
  }
  if (typeof window !== "undefined") {
    const injected = (window as unknown as { __CC_CONTEXT_URL__?: string }).__CC_CONTEXT_URL__;
    if (injected && injected.trim()) {
      return injected.trim();
    }
  }
  return "";
}

/**
 * Production boot always constructs the HTTP adapter.
 * Mock is never selected here — only via explicit test injection in boot/mount.
 */
export function createProductionAdapter(): ControlCenterReadAdapter {
  const base = productionContextUrl() || "";
  return createHttpAdapter(base, undefined, productionActorFromDocument());
}
