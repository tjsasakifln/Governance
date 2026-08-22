export {
  DISPATCH_TARGET_ID,
  OPERATOR_ACTIONS,
  OPERATOR_ACTION_NAMES,
  OPERATOR_FORBIDDEN_ACTIONS,
  REASON_PATTERN,
  TARGET_ID_PATTERN,
  isOperatorActionName,
  isValidReason,
  isValidTargetId,
  resolveOperatorAction,
} from "./actions.ts";
export type {
  OperatorActionDefinition,
  OperatorActionName,
  OperatorConfirmationMode,
  OperatorTargetKind,
} from "./actions.ts";

export {
  OPERATOR_ACK_PREFIX,
  OPERATOR_ACK_SUFFIX,
  OPERATOR_PAUSE_PATH,
  OPERATOR_RESUME_PATH,
  classifyOperatorRequest,
  isAllowedOperatorWrite,
} from "./allowlist.ts";
export type { AllowedOperatorRequest } from "./allowlist.ts";

export {
  defaultOperatorIdentityPolicy,
  operatorActorFromIdentity,
  resolveOperatorActor,
} from "./identity.ts";
export type {
  ForwardAuthIdentity,
  IdentityRequest,
  OperatorActor,
  OperatorIdentityResult,
  TrustedHopPolicy,
} from "./identity.ts";

export {
  OPERATOR_LEDGER_SCHEMA,
  OPERATOR_LEDGER_SOURCE_KIND,
  OPERATOR_LEDGER_SOURCE_SYSTEM,
  OPERATOR_OUTCOMES,
  OPERATOR_REFUSAL_CODES,
  createFanOutOperatorActionLedger,
  createMemoryOperatorActionLedger,
  operatorLedgerId,
} from "./ledger.ts";
export type {
  OperatorActionLedger,
  OperatorActionLedgerEntry,
  OperatorLedgerConfirmation,
  OperatorLedgerTarget,
  OperatorLedgerUpstream,
  OperatorOutcome,
  OperatorRefusalCode,
} from "./ledger.ts";

export {
  DEFAULT_CONFIRMATION_TTL_MS,
  createConfirmationStore,
} from "./confirmation.ts";
export type {
  ConfirmationCheck,
  ConfirmationStore,
  OperatorConfirmationChallenge,
} from "./confirmation.ts";

export {
  OperatorPathNotAllowedError,
  OperatorTimeoutError,
  WarmblyOperatorClient,
} from "./client.ts";
export type { OperatorPostResult, WarmblyOperatorClientOptions } from "./client.ts";

export { createWarmblyOperatorChannel } from "./channel.ts";
export type {
  NamedOperatorActionInput,
  OperatorActionInput,
  OperatorActionResult,
  OperatorChallenged,
  OperatorExecuted,
  OperatorRefused,
  WarmblyOperatorChannel,
  WarmblyOperatorChannelOptions,
} from "./channel.ts";

export { OPERATOR_HTTP_ROUTES, createOperatorHttpHandler } from "./http.ts";
export type {
  OperatorHttpRequest,
  OperatorHttpResponse,
  OperatorHttpRoute,
} from "./http.ts";

export {
  OPERATOR_LEDGER_AGENT_ID,
  OPERATOR_LEDGER_AGENT_PROVIDER,
  OPERATOR_LEDGER_REPO,
  createAgentActivityLedgerSink,
} from "./agent-activity-sink.ts";
export type { AgentLedgerLike } from "./agent-activity-sink.ts";
