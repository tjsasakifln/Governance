import type { DestinationId } from "../destinations";
import type {
  ActorRef,
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
}

export interface AdapterError {
  code: string;
  message: string;
}

export type AdapterReadResult =
  | { ok: true; loading: false; page: DestinationPage }
  | { ok: false; loading: false; error: AdapterError }
  | { ok: true; loading: true; page: null };

/**
 * Read-only Control Center port. Default implementation is in-repo fixtures.
 * A later convergence campaign may swap this for HTTP; MCP stays the agent
 * interface and is not consumed here.
 */
export interface ControlCenterReadAdapter {
  readonly mode: "mock";
  readonly actions: readonly AdapterAction[];
  readOperator(): ActorRef;
  readDestination(id: DestinationId): AdapterReadResult;
  readAttention(): AttentionItem[];
  readPriorities(): PriorityRecommendation[];
}

export function adapterAllows(action: string): action is AdapterAction {
  return (ADAPTER_ACTIONS as readonly string[]).includes(action);
}

export function isForbiddenAdapterAction(action: string): action is ForbiddenAdapterAction {
  return (FORBIDDEN_ADAPTER_ACTIONS as readonly string[]).includes(action);
}
