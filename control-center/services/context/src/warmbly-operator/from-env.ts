/**
 * Wires the Warmbly operator channel, or returns undefined.
 *
 * Off unless explicitly configured. An unconfigured deployment 404s every
 * operator route, which is the fail-closed default: a control plane that can
 * pause and resume outbound email must be switched on deliberately, never by
 * a default.
 */

import {
  WarmblyOperatorClient,
  createAgentActivityLedgerSink,
  createFanOutOperatorActionLedger,
  createMemoryOperatorActionLedger,
  createOperatorHttpHandler,
  createWarmblyOperatorChannel,
  defaultOperatorSinkErrorHandler,
} from "@confenge/control-center-warmbly-connector";

import type { Logger } from "../log.ts";
import type { WarmblyOperatorHttpRequest, WarmblyOperatorHttpResponse } from "../http.ts";

/**
 * The connector's log entry shape. Declared structurally here rather than
 * exported from the connector, so mounting it does not widen its public surface.
 */
type ConnectorLogEntry = { level: "info" | "warn" | "error"; msg: string; [key: string]: unknown };
type ConnectorLogger = (entry: ConnectorLogEntry) => void;

/**
 * The connector logs structured entries through a single callable; this service
 * logs through level methods. Adapt rather than widen either side, and drop the
 * fields the service logger refuses so a nested object cannot smuggle a secret
 * past its own redaction.
 */
function connectorLogger(logger: Logger): ConnectorLogger {
  return (entry: ConnectorLogEntry) => {
    const { level, msg, ...rest } = entry;
    const fields: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
        fields[key] = value as string | number | boolean | null;
      } else {
        fields[key] = JSON.stringify(value) ?? "";
      }
    }
    const write = level === "error" ? logger.error : level === "warn" ? logger.warn : logger.info;
    write.call(logger, msg, fields);
  };
}

export type WarmblyOperatorHandler = (
  req: WarmblyOperatorHttpRequest,
) => Promise<WarmblyOperatorHttpResponse>;

export interface WarmblyOperatorEnvDeps {
  logger: Logger;
  /** Optional agent-activity sink, so operator actions land on the timeline. */
  agentActivity?: Parameters<typeof createAgentActivityLedgerSink>[0];
}

function required(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name];
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
}

export function createWarmblyOperatorHandlerFromEnv(
  env: NodeJS.ProcessEnv,
  deps: WarmblyOperatorEnvDeps,
): WarmblyOperatorHandler | undefined {
  if (required(env, "CC_WARMBLY_OPERATOR_ENABLED") !== "true") {
    return undefined;
  }
  const baseUrl = required(env, "CC_WARMBLY_BASE_URL");
  const token = required(env, "CC_WARMBLY_OPERATOR_TOKEN");
  if (!baseUrl || !token) {
    // Enabled but not configured is a misconfiguration, not a reason to run
    // half-wired: say so and stay off.
    deps.logger.error("warmbly.operator.not_configured", {
      msg: "CC_WARMBLY_OPERATOR_ENABLED=true requires CC_WARMBLY_BASE_URL and CC_WARMBLY_OPERATOR_TOKEN",
      has_base_url: Boolean(baseUrl),
      has_token: Boolean(token),
    });
    return undefined;
  }

  const log = connectorLogger(deps.logger);
  const client = new WarmblyOperatorClient({
    baseUrl,
    token,
    logger: log,
    ...(required(env, "CC_WARMBLY_OPERATOR_TIMEOUT_MS")
      ? { timeoutMs: Number(required(env, "CC_WARMBLY_OPERATOR_TIMEOUT_MS")) }
      : {}),
  });

  const primary = createMemoryOperatorActionLedger();
  const sinks = deps.agentActivity ? [createAgentActivityLedgerSink(deps.agentActivity)] : [];
  const ledger = createFanOutOperatorActionLedger(
    primary,
    sinks,
    defaultOperatorSinkErrorHandler(log),
  );

  const channel = createWarmblyOperatorChannel({ client, ledger, logger: log });
  return createOperatorHttpHandler(channel) as WarmblyOperatorHandler;
}
