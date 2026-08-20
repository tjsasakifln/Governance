import {
  MCP_OUTCOMES,
  type ExecutionStatus,
  type McpOutcome,
} from "./contract.js";

/**
 * Mapping between this ledger and MCP `confenge.report_session_result`.
 * Do not edit `control-center/services/mcp/` from this workstream.
 *
 * MCP outcomes today: completed | partial | failed | blocked
 * Ledger statuses: RUNNING | DONE | PARTIAL | BLOCKED | FAILED | UNKNOWN
 */
export const MCP_OUTCOME_TO_STATUS = {
  completed: "DONE",
  partial: "PARTIAL",
  failed: "FAILED",
  blocked: "BLOCKED",
} as const satisfies Record<McpOutcome, ExecutionStatus>;

export const STATUS_TO_MCP_OUTCOME: Record<ExecutionStatus, McpOutcome | null> = {
  DONE: "completed",
  PARTIAL: "partial",
  FAILED: "failed",
  BLOCKED: "blocked",
  RUNNING: null,
  UNKNOWN: null,
};

export function mcpOutcomeToStatus(outcome: McpOutcome): ExecutionStatus {
  return MCP_OUTCOME_TO_STATUS[outcome];
}

export function statusToMcpOutcome(status: ExecutionStatus): McpOutcome | null {
  return STATUS_TO_MCP_OUTCOME[status];
}

export function isMcpOutcome(value: string): value is McpOutcome {
  return (MCP_OUTCOMES as readonly string[]).includes(value);
}
