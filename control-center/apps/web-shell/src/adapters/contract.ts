import type { DestinationId } from "../destinations";
import type { HojeViewModel } from "../hoje-compose";
import type {
  ActorRef,
  AgentActivity,
  AgentSession,
  AttentionItem,
  ClientIdentityException,
  ClientStatus,
  CommercialSnapshot,
  Directive,
  EngineeringSnapshot,
  FinanceSnapshot,
  InfraCatalogSummary,
  PriorityRecommendation,
  ServiceHealth,
  UtcDateTime,
} from "../types";
import type { WriteShortcutKind } from "./paths";

/** The mock/HTTP adapter is read-only. Mutation verbs are not part of the contract. */
export const ADAPTER_ACTIONS = ["read"] as const;
export type AdapterAction = (typeof ADAPTER_ACTIONS)[number];

/**
 * Financial/provider and commercial-send mutations stay forbidden in this campaign.
 * Listed so tests can assert they are absent from the adapter contract.
 */
export const FORBIDDEN_ADAPTER_ACTIONS = [
  "cobranca",
  "checkout",
  "refund",
  "cancelamento",
  "asaas_write",
  "commercial_send",
] as const;
export type ForbiddenAdapterAction = (typeof FORBIDDEN_ADAPTER_ACTIONS)[number];

export const CHAT_SURFACE_ACTIONS = ["compose", "send_message", "open_thread"] as const;

export interface DestinationPage {
  id: DestinationId;
  label: string;
  scope: string;
  generated_at: UtcDateTime;
  operator: ActorRef;
  headline: string;
  attention: AttentionItem[];
  priorities: PriorityRecommendation[];
  commercial?: CommercialSnapshot;
  finance?: FinanceSnapshot;
  engineering?: EngineeringSnapshot;
  clients?: ClientStatus[];
  /** Records the producer could not identify. Never clients; never counted as clients. */
  client_data_quality?: ClientIdentityException[];
  health?: ServiceHealth[];
  health_summary?: InfraCatalogSummary;
  directives?: Directive[];
  sessions?: AgentSession[];
  activities?: AgentActivity[];
  hoje?: HojeViewModel;
  /** Warmbly's versioned human-gate contract. The UI renders, never re-derives, eligibility. */
  warmbly_gate?: Record<string, unknown>;
}

export interface AdapterError {
  code: string;
  message: string;
}

export type AdapterReadResult =
  | { ok: true; loading: false; page: DestinationPage }
  | { ok: false; loading: false; error: AdapterError }
  | { ok: true; loading: true; page: null };

/** One field the server itself reported as changed by an accepted adjust. */
export interface GateDiffEntry {
  field: string;
  before?: string;
  after?: string;
}

/**
 * What a GET issued *after* a definitive write found.
 *
 * A 2xx says the channel accepted the call, not that the resource now reads the
 * way the operator expects. Claiming "aplicado" from the status alone is the
 * same mistake as reading "PAUSADO" from a collection that never ran.
 */
export interface GateReadback {
  status: "confirmed" | "not_confirmed" | "unavailable" | "skipped";
  detail: string;
  reason_group?: "READBACK_UNKNOWN";
}

/** Backend reconciliation of durable APPROVEs into scheduled queue work. */
export interface GateReconcileCounts {
  approvalRecords?: number;
  latestApprovedBindings?: number;
  uniqueApprovedCandidates?: number;
  scheduled?: number;
  alreadyScheduled?: number;
  failed?: number;
  failures?: readonly { cohortId?: string; candidateId?: string; reason: string }[];
}

/**
 * Server-observed result of one commercial draft decision.
 *
 * This is deliberately distinct from an optimistic UI state. The Context
 * Service emits it only after comparing Warmbly's write response with a
 * canonical GET of the same touchpoint.
 */
export interface ReviewDecisionEvidence {
  action: "SAVE_ADJUSTMENT" | "APPROVE" | "REJECT";
  touchpointId: string;
  expectedContentHash: string;
  contentHash?: string;
  approvedContentHash?: string;
  state?: string;
  dueAt?: string;
  scheduledFor?: string;
  approvedBy?: string;
  approvedAt?: string;
  observedAt: string;
}

export interface AdapterWriteResult {
  ok: boolean;
  path: string;
  kind: WriteShortcutKind;
  message: string;
  /**
   * Returned only by `resume_confirm`. The caller replays it on `resume`; it is
   * single-use, bound to the issuing operator, and never re-armed.
   */
  confirmationToken?: string;
  /**
   * Warmbly operator channel outcome, carried verbatim from the response body
   * (`executed | challenged | refused | unknown`).
   *
   * `ok` alone cannot tell an operator what happened: an HTTP failure may mean
   * the channel refused before touching Warmbly, or that the POST was written
   * and the answer never came back. Those demand opposite next moves, so the
   * classification travels with the result instead of being guessed from the
   * message string.
   */
  outcome?: string;
  /** Refusal code from the channel (`circuit_open`, `confirmation_invalid`, …). */
  code?: string;
  /** HTTP status the channel answered with, absent when the call never left the browser. */
  status?: number;
  /**
   * Sanitized read-back of the append-only receipt. It is deliberately small:
   * enough for an operator to identify the actor/session, target and outcome,
   * without leaking provider payloads or authentication material.
   */
  receipt?: {
    id: string;
    correlation_id: string;
    occurred_at: string;
    outcome: string;
    actor_id?: string;
    target?: string;
    writes_to: "control-center" | "warmbly";
  };
  /**
   * Which human-gate action produced this result.
   *
   * Without it every gate write collapses into one anonymous "decisão
   * registrada" and the operator cannot tell a created cohort from a recorded
   * HOLD, which is exactly the defect this field exists to prevent.
   */
  gateAction?: WarmblyGateAction;
  /** The card this result belongs to, so feedback lands where the operator acted. */
  gateTarget?: { cohort_id?: string; candidate_id?: string };
  /**
   * Resource the server created or superseded, read from the response body.
   *
   * The UI navigates to what the server returned. It never guesses `n + 1`:
   * a version the server did not name is a version that may not exist.
   */
  gateResource?: { cohort_id?: string; version?: number };
  /** Correlation id echoed by the edge envelope, for the audit trail. */
  correlationId?: string;
  /** Receipt token echoed by the gate (a string, unlike the dispatch receipt object). */
  receiptId?: string;
  /** Field-level diff the server returned for an accepted adjust. */
  diff?: readonly GateDiffEntry[];
  /** Counters Warmbly returned for an accepted approval reconciliation. */
  reconcile?: GateReconcileCounts;
  /** Result of the GET readback performed after a definitive response. */
  readback?: GateReadback;
  /** Canonical receipt/readback for a Comercial → Rascunhos decision. */
  reviewDecision?: ReviewDecisionEvidence;
}

/**
 * Production default is HTTP. Mock exists only by explicit test injection.
 * MCP is the agent interface and is not consumed here. Provider mutations
 * stay forbidden; the only writes are authorized Context Service shortcuts.
 */
export interface ControlCenterReadAdapter {
  readonly mode: "mock" | "http";
  readonly actions: readonly AdapterAction[];
  lastOperatorResult?: AdapterWriteResult;
  readOperator(): ActorRef;
  readDestination(id: DestinationId, location?: string): AdapterReadResult | Promise<AdapterReadResult>;
  readAttention(): AttentionItem[] | Promise<AttentionItem[]>;
  readPriorities(): PriorityRecommendation[] | Promise<PriorityRecommendation[]>;
  writeShortcut?(
    kind: WriteShortcutKind,
    draft: { title: string; body: string },
  ): AdapterWriteResult | Promise<AdapterWriteResult>;
  operatorAction?(input: {
    action_type: string;
    target_canonical_id: string;
    target_source_id: string;
    note: string;
    idempotency_key?: string;
  }): AdapterWriteResult | Promise<AdapterWriteResult>;
  /**
   * Warmbly dispatch control. Deliberately separate from `operatorAction`:
   * that one authenticates with `x-actor-id`, a header the browser sets, and a
   * client-settable actor must never be able to restart outbound email. These
   * routes authenticate at the edge with Authelia, so the adapter sends no
   * actor header at all and relies on the session cookie.
   *
   * `resume` is two-step by contract: `resume_confirm` returns a token that
   * `resume` must replay. There is no single-call resume.
   */
  warmblyDispatch?(input: WarmblyDispatchInput): AdapterWriteResult | Promise<AdapterWriteResult>;
  warmblyGate?(input: WarmblyGateInput): AdapterWriteResult | Promise<AdapterWriteResult>;
  reviewDraftAction?(input: {
    id: string;
    action: "SAVE_ADJUSTMENT" | "APPROVE" | "REJECT";
    expected_content_hash: string;
    subject?: string;
    body_text?: string;
    reason?: string;
    generic_recipient_acknowledged?: boolean;
  }): AdapterWriteResult | Promise<AdapterWriteResult>;
}

export const WARMBLY_GATE_ACTIONS = [
  "create",
  "reproduce",
  "validate",
  "review",
  "adjust",
  // Admin repair only. Ordinary APPROVE already queues through the same path.
  "reconcile",
] as const;
export type WarmblyGateAction = (typeof WARMBLY_GATE_ACTIONS)[number];

export function isWarmblyGateAction(value: string | null): value is WarmblyGateAction {
  return typeof value === "string" && (WARMBLY_GATE_ACTIONS as readonly string[]).includes(value);
}

/**
 * What the audit trail records when a reviewer approves a normal message and
 * writes nothing.
 *
 * A required free-text field on the happy path bought the trail nothing: the
 * reviewer types the same word every time, and the row that matters is already
 * complete without it — actor, instant, version, frozen hash, recipient and
 * decision all come from the server. This constant makes the ordinary case say
 * exactly what it is, and leaves the optional comment for when the reviewer
 * actually has something to record.
 */
export const APPROVAL_DEFAULT_REASON = "approved_by_human_reviewer";

export interface WarmblyGateInput {
  action: WarmblyGateAction;
  version_id?: string;
  candidate_id?: string;
  limit?: number;
  selection_mode?: "NEXT_UNCLAIMED" | "RECOVER_PRIOR";
  recover_version_ids?: string[];
  decision?: "APPROVE" | "REJECT" | "HOLD";
  reason?: string;
  acknowledged?: boolean;
  confirmation?: string;
  /**
   * `adjust` only. Exactly three fields are editable, and the contract carries
   * no others: mailbox, evidence, source, policy and route class are frozen by
   * construction, so this UI has no control that could offer to change them.
   */
  subject?: string;
  body_text?: string;
  /** `adjust` only: the frozen hash the operator actually reviewed. */
  expected_frozen_hash?: string;
  idempotency_key: string;
}

export const WARMBLY_DISPATCH_ACTIONS = ["pause", "resume_confirm", "resume", "acknowledge"] as const;
export type WarmblyDispatchAction = (typeof WARMBLY_DISPATCH_ACTIONS)[number];

export interface WarmblyDispatchInput {
  action: WarmblyDispatchAction;
  /** Audit reason. Required: the channel refuses a write without one. */
  reason: string;
  /** Only for `resume`, replayed from the `resume_confirm` response. */
  confirmation_token?: string;
  /** Only for `acknowledge`. */
  target_id?: string;
}

export function adapterAllows(action: string): action is AdapterAction {
  return (ADAPTER_ACTIONS as readonly string[]).includes(action);
}

export function isForbiddenAdapterAction(action: string): action is ForbiddenAdapterAction {
  return (FORBIDDEN_ADAPTER_ACTIONS as readonly string[]).includes(action);
}
