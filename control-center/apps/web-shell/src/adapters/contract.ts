import type { DestinationId } from "../destinations";
import type { HojeViewModel } from "../hoje-compose";
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
  health?: ServiceHealth[];
  directives?: Directive[];
  sessions?: AgentSession[];
  activities?: AgentActivity[];
  hoje?: HojeViewModel;
}

export interface AdapterError {
  code: string;
  message: string;
}

export type AdapterReadResult =
  | { ok: true; loading: false; page: DestinationPage }
  | { ok: false; loading: false; error: AdapterError }
  | { ok: true; loading: true; page: null };

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
  readDestination(id: DestinationId): AdapterReadResult | Promise<AdapterReadResult>;
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
