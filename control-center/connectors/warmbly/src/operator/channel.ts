/**
 * The Warmbly operator action channel.
 *
 * Narrow by construction: a caller names one of three actions and supplies the
 * raw HTTP request whose Authelia `Remote-*` headers carry the founder. There
 * is no method parameter, no path parameter, and no escape hatch. Every call
 * — executed, refused, challenged, or unknown — writes exactly one ledger entry
 * before it returns, under a correlation id minted here rather than supplied by
 * the caller.
 */

import { randomUUID } from "node:crypto";
import { CircuitOpenError } from "../http/circuit-breaker.ts";
import type { CircuitState } from "../http/circuit-breaker.ts";
import { createStderrLogger, type Logger } from "../http/redaction.ts";
import {
  DISPATCH_TARGET_ID,
  OPERATOR_ACTION_NAMES,
  TARGET_ID_PATTERN,
  isValidReason,
  isValidTargetId,
  resolveOperatorAction,
  type OperatorActionDefinition,
  type OperatorActionName,
} from "./actions.ts";
import { classifyOperatorRequest } from "./allowlist.ts";
import {
  OperatorPathNotAllowedError,
  OperatorTimeoutError,
  isPreFlightTransportFailure,
  type WarmblyOperatorClient,
} from "./client.ts";
import {
  createConfirmationStore,
  type ConfirmationStore,
  type OperatorConfirmationChallenge,
} from "./confirmation.ts";
import {
  defaultOperatorIdentityPolicy,
  resolveOperatorActor,
  type OperatorIdentityResult,
  type IdentityRequest,
  type OperatorActor,
  type TrustedHopPolicy,
} from "./identity.ts";
import {
  OPERATOR_DISPATCH_STATUS_PATH,
  OPERATOR_LEDGER_SCHEMA,
  OPERATOR_LEDGER_SOURCE_KIND,
  OPERATOR_LEDGER_SOURCE_SYSTEM,
  OPERATOR_UNKNOWN_CODE,
  createMemoryOperatorActionLedger,
  operatorLedgerId,
  writeOperatorLedgerWal,
  type OperatorActionLedger,
  type OperatorActionLedgerEntry,
  type OperatorLedgerConfirmation,
  type OperatorLedgerTarget,
  type OperatorLedgerUpstream,
  type OperatorRefusalCode,
  type OperatorUnknownCode,
} from "./ledger.ts";

export interface OperatorActionInput {
  /** Deliberately `string`: an unknown name must be refusable and recordable. */
  action: string;
  /** Raw request. Identity is derived from it; it cannot be supplied directly. */
  request: IdentityRequest | undefined;
  target_id?: string;
  reason?: string;
  confirmation_token?: string;
  /**
   * The caller's own reference. It is echoed on the entry and never used as a
   * key: `correlation_id` and the ledger `id` are minted here, so a replayed
   * reference can never rewrite an existing record.
   */
  client_reference?: string;
}

export type NamedOperatorActionInput = Omit<OperatorActionInput, "action">;

export interface OperatorExecuted {
  ok: true;
  outcome: "executed";
  action: OperatorActionName;
  target: OperatorLedgerTarget;
  upstream_status: number;
  upstream_body: unknown;
  entry: OperatorActionLedgerEntry;
}

export interface OperatorChallenged {
  ok: true;
  outcome: "challenged";
  action: OperatorActionName;
  target: OperatorLedgerTarget;
  challenge: OperatorConfirmationChallenge;
  entry: OperatorActionLedgerEntry;
}

export interface OperatorRefused {
  ok: false;
  outcome: "refused";
  code: OperatorRefusalCode;
  reason: string;
  entry: OperatorActionLedgerEntry;
}

/**
 * The request reached Warmbly and the answer did not reach us. Not a success
 * and — critically — not a refusal: the action may have been applied.
 */
export interface OperatorUnknown {
  ok: false;
  outcome: "unknown";
  code: OperatorUnknownCode;
  reason: string;
  entry: OperatorActionLedgerEntry;
}

export type OperatorActionResult =
  | OperatorExecuted
  | OperatorChallenged
  | OperatorRefused
  | OperatorUnknown;

export interface WarmblyOperatorChannelOptions {
  client: WarmblyOperatorClient;
  ledger?: OperatorActionLedger;
  identityPolicy?: TrustedHopPolicy;
  confirmations?: ConfirmationStore;
  confirmationTtlMs?: number;
  now?: () => Date;
  newCorrelationId?: () => string;
  logger?: Logger;
  /**
   * Durable last resort when `ledger.record` throws. Defaults to a synchronous
   * stderr WAL line so an executed action is never lost silently.
   */
  onLedgerWriteFailure?: (entry: OperatorActionLedgerEntry, err: unknown) => void;
}

export interface WarmblyOperatorChannel {
  readonly actions: readonly OperatorActionName[];
  readonly ledger: OperatorActionLedger;
  circuitState(): CircuitState;
  /**
   * Resolves the founder from a raw request, for read-backs that must sit
   * behind the same gate as a write without performing one. It records nothing:
   * only calls that attempt an action write to the ledger.
   */
  resolveActor(request: IdentityRequest | undefined): OperatorIdentityResult;
  /** Step 1 of the two-step release. Only `resume_dispatch` accepts it. */
  requestConfirmation(input: OperatorActionInput): Promise<OperatorActionResult>;
  requestResumeConfirmation(input: NamedOperatorActionInput): Promise<OperatorActionResult>;
  execute(input: OperatorActionInput): Promise<OperatorActionResult>;
  pauseDispatch(input: NamedOperatorActionInput): Promise<OperatorActionResult>;
  resumeDispatch(input: NamedOperatorActionInput): Promise<OperatorActionResult>;
  acknowledgeInboundAlert(input: NamedOperatorActionInput): Promise<OperatorActionResult>;
}

const UNKNOWN_TARGET: OperatorLedgerTarget = { kind: "unknown", id: "unknown" };
const NO_UPSTREAM: OperatorLedgerUpstream = { method: null, path: null, status: null };
const NO_CONFIRMATION: OperatorLedgerConfirmation = {
  required: false,
  satisfied: false,
  token_id: null,
};

export function createWarmblyOperatorChannel(
  options: WarmblyOperatorChannelOptions,
): WarmblyOperatorChannel {
  const client = options.client;
  const ledger = options.ledger ?? createMemoryOperatorActionLedger();
  const identityPolicy = options.identityPolicy ?? defaultOperatorIdentityPolicy();
  const confirmations =
    options.confirmations ??
    createConfirmationStore(
      options.confirmationTtlMs === undefined ? {} : { ttlMs: options.confirmationTtlMs },
    );
  const now = options.now ?? (() => new Date());
  const newCorrelationId = options.newCorrelationId ?? (() => randomUUID());
  const logger = options.logger ?? createStderrLogger();
  const onLedgerWriteFailure = options.onLedgerWriteFailure ?? writeOperatorLedgerWal;

  /**
   * Always minted here. A caller-chosen correlation id would key the ledger
   * entry (and the agent-activity session), so replaying it would rewrite the
   * row of an already-executed action — in a record that is the sole
   * non-repudiation evidence while `paused_by` is missing upstream.
   */
  function correlationOf(): string {
    return `cc:warmbly-op:${newCorrelationId()}`;
  }

  /** The caller's value, carried but never used as a key. */
  function clientReferenceOf(input: OperatorActionInput): string | null {
    const raw = typeof input.client_reference === "string" ? input.client_reference.trim() : "";
    return raw !== "" && /^[A-Za-z0-9._:~-]{1,96}$/.test(raw) ? raw : null;
  }

  function record(entry: OperatorActionLedgerEntry): OperatorActionLedgerEntry {
    try {
      ledger.record(entry);
    } catch (err) {
      // The upstream write may already have happened. An entry lost here is the
      // non-repudiation failure, so put it somewhere durable before the failure
      // surfaces to the caller.
      onLedgerWriteFailure(entry, err);
      logger({
        level: "error",
        msg: "warmbly.operator.ledger_write_failed",
        correlation_id: entry.correlation_id,
        requested_action: entry.requested_action,
        outcome: entry.outcome,
        upstream_status: entry.upstream.status,
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
      throw err;
    }
    logger({
      level: entry.outcome === "executed" ? "info" : "warn",
      msg: "warmbly.operator.recorded",
      correlation_id: entry.correlation_id,
      requested_action: entry.requested_action,
      outcome: entry.outcome,
      refusal_code: entry.refusal_code,
      actor_id: entry.actor?.id ?? null,
      target: `${entry.target.kind}:${entry.target.id}`,
      upstream_status: entry.upstream.status,
      circuit_state: entry.circuit_state,
    });
    return entry;
  }

  function buildEntry(parts: {
    correlation_id: string;
    client_reference: string | null;
    requested_action: string;
    action: OperatorActionName | null;
    outcome: OperatorActionLedgerEntry["outcome"];
    refusal_code: OperatorRefusalCode | OperatorUnknownCode | null;
    refusal_reason: string | null;
    actor: OperatorActor | null;
    target: OperatorLedgerTarget;
    upstream: OperatorLedgerUpstream;
    confirmation: OperatorLedgerConfirmation;
    reason: string | null;
  }): OperatorActionLedgerEntry {
    const at = now().toISOString();
    return {
      schema_version: OPERATOR_LEDGER_SCHEMA,
      id: operatorLedgerId(parts.correlation_id),
      correlation_id: parts.correlation_id,
      client_reference: parts.client_reference,
      requested_action: parts.requested_action,
      action: parts.action,
      outcome: parts.outcome,
      refusal_code: parts.refusal_code,
      refusal_reason: parts.refusal_reason,
      actor: parts.actor,
      target: parts.target,
      upstream: parts.upstream,
      confirmation: parts.confirmation,
      circuit_state: safeCircuitState(),
      reason: parts.reason,
      recorded_at: at,
      source: {
        system: OPERATOR_LEDGER_SOURCE_SYSTEM,
        kind: OPERATOR_LEDGER_SOURCE_KIND,
        locator: parts.correlation_id,
      },
      observed_at: at,
      freshness_status: "FRESH",
      confidence: 1,
    };
  }

  function safeCircuitState(): CircuitState {
    try {
      return client.circuitState();
    } catch {
      return "open";
    }
  }

  function refuse(parts: {
    correlation_id: string;
    client_reference: string | null;
    requested_action: string;
    action: OperatorActionName | null;
    code: OperatorRefusalCode;
    reason: string;
    actor: OperatorActor | null;
    target?: OperatorLedgerTarget;
    upstream?: OperatorLedgerUpstream;
    confirmation?: OperatorLedgerConfirmation;
    auditReason?: string | null;
  }): OperatorRefused {
    const entry = record(
      buildEntry({
        correlation_id: parts.correlation_id,
        client_reference: parts.client_reference,
        requested_action: parts.requested_action,
        action: parts.action,
        outcome: "refused",
        refusal_code: parts.code,
        refusal_reason: parts.reason,
        actor: parts.actor,
        target: parts.target ?? UNKNOWN_TARGET,
        upstream: parts.upstream ?? NO_UPSTREAM,
        confirmation: parts.confirmation ?? NO_CONFIRMATION,
        reason: parts.auditReason ?? null,
      }),
    );
    return { ok: false, outcome: "refused", code: parts.code, reason: parts.reason, entry };
  }

  /**
   * Records an action whose result is genuinely unknown: the POST was written
   * and no answer came back. The reason points at the one place that can settle
   * it, because a blind retry of a resume is exactly what must not happen.
   */
  function unresolved(parts: {
    correlation_id: string;
    client_reference: string | null;
    action: OperatorActionName;
    detail: string;
    actor: OperatorActor;
    target: OperatorLedgerTarget;
    path: string;
    confirmation: OperatorLedgerConfirmation;
    auditReason: string | null;
  }): OperatorUnknown {
    const reason =
      `${parts.detail}. The request was already written to Warmbly, so ${parts.action} may have ` +
      `been applied: read GET ${OPERATOR_DISPATCH_STATUS_PATH} before retrying. Any confirmation ` +
      "token used for this call is spent and a retry needs a fresh confirmation.";
    const entry = record(
      buildEntry({
        correlation_id: parts.correlation_id,
        client_reference: parts.client_reference,
        requested_action: parts.action,
        action: parts.action,
        outcome: "unknown",
        refusal_code: OPERATOR_UNKNOWN_CODE,
        refusal_reason: reason,
        actor: parts.actor,
        target: parts.target,
        upstream: { method: "POST", path: parts.path, status: null },
        confirmation: parts.confirmation,
        reason: parts.auditReason,
      }),
    );
    return { ok: false, outcome: "unknown", code: OPERATOR_UNKNOWN_CODE, reason, entry };
  }

  interface Prepared {
    action: OperatorActionDefinition;
    actor: OperatorActor;
    target: OperatorLedgerTarget;
    path: string;
    reason: string | null;
  }

  /**
   * Shared, ordered gate for both `requestConfirmation` and `execute`.
   * Identity first: an unauthenticated caller must not learn which action names
   * exist. Then allowlist, then target, then reason, then path.
   */
  function prepare(
    input: OperatorActionInput,
    correlationId: string,
    clientReference: string | null,
  ): Prepared | OperatorRefused {
    const requested = typeof input.action === "string" ? input.action : String(input.action);

    const identity = resolveOperatorActor(input.request, identityPolicy);
    if (!identity.ok) {
      return refuse({
        correlation_id: correlationId,
        client_reference: clientReference,
        requested_action: requested,
        action: null,
        code: "missing_actor",
        reason: `authenticated founder identity is required (${identity.code}: ${identity.reason})`,
        actor: null,
      });
    }
    const actor = identity.actor;

    const action = resolveOperatorAction(requested);
    if (!action) {
      return refuse({
        correlation_id: correlationId,
        client_reference: clientReference,
        requested_action: requested,
        action: null,
        code: "unknown_action",
        reason: `"${requested}" is not an allowed Warmbly operator action (allowed: ${OPERATOR_ACTION_NAMES.join(", ")})`,
        actor,
      });
    }

    const rawTarget =
      typeof input.target_id === "string" && input.target_id.trim() !== ""
        ? input.target_id.trim()
        : action.default_target_id;
    if (rawTarget === null || !isValidTargetId(rawTarget)) {
      return refuse({
        correlation_id: correlationId,
        client_reference: clientReference,
        requested_action: requested,
        action: action.name,
        code: "invalid_target",
        reason: `${action.name} requires a safe target id matching ${TARGET_ID_PATTERN.source}`,
        actor,
        target: { kind: action.target_kind, id: "invalid" },
      });
    }
    if (!action.target_in_path && rawTarget !== action.default_target_id) {
      return refuse({
        correlation_id: correlationId,
        client_reference: clientReference,
        requested_action: requested,
        action: action.name,
        code: "invalid_target",
        reason: `${action.name} targets the singleton "${action.default_target_id}" only`,
        actor,
        target: { kind: action.target_kind, id: rawTarget },
      });
    }
    const target: OperatorLedgerTarget = { kind: action.target_kind, id: rawTarget };

    const rawReason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (action.reason_required && !isValidReason(rawReason)) {
      return refuse({
        correlation_id: correlationId,
        client_reference: clientReference,
        requested_action: requested,
        action: action.name,
        code: "invalid_reason",
        reason: `${action.name} requires a 1-200 character audit reason without control characters or separators`,
        actor,
        target,
      });
    }
    if (rawReason !== "" && !isValidReason(rawReason)) {
      return refuse({
        correlation_id: correlationId,
        client_reference: clientReference,
        requested_action: requested,
        action: action.name,
        code: "invalid_reason",
        reason: "reason contains characters that are not allowed in an audit reason",
        actor,
        target,
      });
    }
    const reason = rawReason === "" ? null : rawReason;

    // Defence in depth: the built path is re-classified against the write
    // allowlist even though the action owns its own template.
    const path = action.buildPath(target.id);
    const classified = classifyOperatorRequest(action.method, path);
    if (!classified.allowed) {
      return refuse({
        correlation_id: correlationId,
        client_reference: clientReference,
        requested_action: requested,
        action: action.name,
        code: "forbidden_path",
        reason: classified.reason,
        actor,
        target,
        upstream: { method: null, path, status: null },
        auditReason: reason,
      });
    }

    return { action, actor, target, path: classified.path, reason };
  }

  function isRefusal(value: Prepared | OperatorRefused): value is OperatorRefused {
    return (value as OperatorRefused).ok === false;
  }

  async function requestConfirmation(input: OperatorActionInput): Promise<OperatorActionResult> {
    const correlationId = correlationOf();
    const clientReference = clientReferenceOf(input);
    const prepared = prepare(input, correlationId, clientReference);
    if (isRefusal(prepared)) {
      return prepared;
    }
    const { action, actor, target, reason } = prepared;
    if (action.confirmation !== "two_step") {
      return refuse({
        correlation_id: correlationId,
        client_reference: clientReference,
        requested_action: action.name,
        action: action.name,
        code: "confirmation_not_applicable",
        reason: `${action.name} is a one-step action and does not take a confirmation token`,
        actor,
        target,
        auditReason: reason,
      });
    }
    // A fresh decision supersedes every older pending decision by this actor.
    // The ledger keeps all challenges, but only the newest token remains live.
    confirmations.invalidate({
      action: action.name,
      target_id: target.id,
      actor_id: actor.id,
    });
    const challenge = confirmations.issue({
      action: action.name,
      target_id: target.id,
      actor_id: actor.id,
      reason,
      now: now(),
    });
    const entry = record(
      buildEntry({
        correlation_id: correlationId,
        client_reference: clientReference,
        requested_action: action.name,
        action: action.name,
        outcome: "challenged",
        refusal_code: null,
        refusal_reason: null,
        actor,
        target,
        upstream: NO_UPSTREAM,
        confirmation: { required: true, satisfied: false, token_id: challenge.token_id },
        reason,
      }),
    );
    return { ok: true, outcome: "challenged", action: action.name, target, challenge, entry };
  }

  async function execute(input: OperatorActionInput): Promise<OperatorActionResult> {
    const correlationId = correlationOf();
    const clientReference = clientReferenceOf(input);
    const prepared = prepare(input, correlationId, clientReference);
    if (isRefusal(prepared)) {
      return prepared;
    }
    const { action, actor, target, path, reason } = prepared;

    if (action.name === "pause_dispatch") {
      // Dispatch is a singleton: even a refused pause attempt is a new safety
      // intervention, so no operator may later release it with an older token.
      confirmations.invalidate({
        action: "resume_dispatch",
        target_id: DISPATCH_TARGET_ID,
      });
    } else if (action.name === "acknowledge_inbound_alert") {
      // Acknowledge does not change dispatch globally, but it interrupts this
      // operator's decision flow and invalidates their pending resume.
      confirmations.invalidate({
        action: "resume_dispatch",
        target_id: DISPATCH_TARGET_ID,
        actor_id: actor.id,
      });
    }

    let confirmation: OperatorLedgerConfirmation = NO_CONFIRMATION;
    if (action.confirmation === "two_step") {
      const supplied = input.confirmation_token;
      if (typeof supplied !== "string" || supplied.trim() === "") {
        return refuse({
          correlation_id: correlationId,
          client_reference: clientReference,
          requested_action: action.name,
          action: action.name,
          code: "confirmation_required",
          reason: `${action.name} is two-step: call requestConfirmation first and replay the token`,
          actor,
          target,
          confirmation: { required: true, satisfied: false, token_id: null },
          auditReason: reason,
        });
      }
      const checked = confirmations.consume({
        token: supplied,
        action: action.name,
        target_id: target.id,
        actor_id: actor.id,
        reason,
        now: now(),
      });
      if (!checked.ok) {
        return refuse({
          correlation_id: correlationId,
          client_reference: clientReference,
          requested_action: action.name,
          action: action.name,
          code: "confirmation_invalid",
          reason: checked.reason,
          actor,
          target,
          confirmation: { required: true, satisfied: false, token_id: null },
          auditReason: reason,
        });
      }
      confirmation = { required: true, satisfied: true, token_id: checked.token_id };
    }

    try {
      client.assertCircuitClosed();
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        return refuse({
          correlation_id: correlationId,
          client_reference: clientReference,
          requested_action: action.name,
          action: action.name,
          code: "circuit_open",
          reason:
            "Warmbly connector circuit breaker is open; the operator action was not attempted. " +
            "Out-of-band fallback for pause: deploy/confenge-vps/pause.sh on the VPS.",
          actor,
          target,
          upstream: { method: "POST", path, status: null },
          confirmation,
          auditReason: reason,
        });
      }
      throw err;
    }

    const body = action.buildBody({ reason });
    let response;
    try {
      response = await client.post(path, body);
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        return refuse({
          correlation_id: correlationId,
          client_reference: clientReference,
          requested_action: action.name,
          action: action.name,
          code: "circuit_open",
          reason: err.message,
          actor,
          target,
          upstream: { method: "POST", path, status: null },
          confirmation,
          auditReason: reason,
        });
      }
      if (err instanceof OperatorPathNotAllowedError) {
        return refuse({
          correlation_id: correlationId,
          client_reference: clientReference,
          requested_action: action.name,
          action: action.name,
          code: "forbidden_path",
          reason: err.message,
          actor,
          target,
          upstream: { method: "POST", path, status: null },
          confirmation,
          auditReason: reason,
        });
      }
      const message =
        err instanceof OperatorTimeoutError
          ? err.message
          : err instanceof Error
            ? `Warmbly operator transport failure: ${err.name}`
            : "Warmbly operator transport failure";
      // A timeout, or any failure that is not provably pre-flight, means the
      // POST may already have been applied upstream. Calling that "refused"
      // would tell the operator dispatch is still paused while Warmbly sends.
      if (!isPreFlightTransportFailure(err)) {
        return unresolved({
          correlation_id: correlationId,
          client_reference: clientReference,
          action: action.name,
          detail: message,
          actor,
          target,
          path,
          confirmation,
          auditReason: reason,
        });
      }
      return refuse({
        correlation_id: correlationId,
        client_reference: clientReference,
        requested_action: action.name,
        action: action.name,
        code: "transport_error",
        reason: `${message} (the request was never written: nothing was applied upstream)`,
        actor,
        target,
        upstream: { method: null, path: null, status: null },
        confirmation,
        auditReason: reason,
      });
    }

    const upstream: OperatorLedgerUpstream = {
      method: "POST",
      path: response.path,
      status: response.status,
    };

    if (response.status < 200 || response.status > 299) {
      const redirected = response.status >= 300 && response.status <= 399;
      return refuse({
        correlation_id: correlationId,
        client_reference: clientReference,
        requested_action: action.name,
        action: action.name,
        code: "upstream_error",
        reason: redirected
          ? `Warmbly answered ${action.name} with HTTP ${response.status}; the operator channel ` +
            "never follows a redirect, because the Location is not classified by the write allowlist"
          : `Warmbly refused ${action.name} with HTTP ${response.status}`,
        actor,
        target,
        upstream,
        confirmation,
        auditReason: reason,
      });
    }

    const entry = record(
      buildEntry({
        correlation_id: correlationId,
        client_reference: clientReference,
        requested_action: action.name,
        action: action.name,
        outcome: "executed",
        refusal_code: null,
        refusal_reason: null,
        actor,
        target,
        upstream,
        confirmation,
        reason,
      }),
    );
    return {
      ok: true,
      outcome: "executed",
      action: action.name,
      target,
      upstream_status: response.status,
      upstream_body: response.json,
      entry,
    };
  }

  return {
    actions: OPERATOR_ACTION_NAMES,
    ledger,
    circuitState: safeCircuitState,
    resolveActor: (request) => resolveOperatorActor(request, identityPolicy),
    requestConfirmation,
    requestResumeConfirmation: (input) =>
      requestConfirmation({ ...input, action: "resume_dispatch", target_id: DISPATCH_TARGET_ID }),
    execute,
    pauseDispatch: (input) =>
      execute({ ...input, action: "pause_dispatch", target_id: DISPATCH_TARGET_ID }),
    resumeDispatch: (input) =>
      execute({ ...input, action: "resume_dispatch", target_id: DISPATCH_TARGET_ID }),
    acknowledgeInboundAlert: (input) =>
      execute({ ...input, action: "acknowledge_inbound_alert" }),
  };
}
