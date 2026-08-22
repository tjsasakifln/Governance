/**
 * Wires the Warmbly operator channel, or returns undefined.
 *
 * Off unless explicitly configured. An unconfigured deployment 404s every
 * operator route, which is the fail-closed default: a control plane that can
 * pause and resume outbound email must be switched on deliberately, never by
 * a default.
 */

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
  agentActivity?: unknown;
}

function required(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name];
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
}

/**
 * Loaded lazily and only when enabled. A static import would make an opt-in
 * feature able to crash boot on any image that does not ship the connector,
 * which is exactly what it did the first time.
 */
async function loadConnector(): Promise<typeof import("@confenge/control-center-warmbly-connector")> {
  return import("@confenge/control-center-warmbly-connector");
}

export async function createWarmblyOperatorHandlerFromEnv(
  env: NodeJS.ProcessEnv,
  deps: WarmblyOperatorEnvDeps,
): Promise<WarmblyOperatorHandler | undefined> {
  if (required(env, "CC_WARMBLY_OPERATOR_ENABLED") !== "true") {
    return undefined;
  }
  const baseUrl = required(env, "CC_WARMBLY_BASE_URL");
  const token = required(env, "CC_WARMBLY_OPERATOR_TOKEN");
  // The hop that may speak for Authelia must be named explicitly. The library
  // default is DEFAULT_TRUSTED_HOPS, which contains the whole cc_edge /24 — and
  // that network holds web, mcp, collector and context alongside caddy. Trusting
  // it would let any of them forge Remote-* and execute a resume, restarting
  // outbound email, ledgered as the founder. Reads have lived behind that CIDR
  // for a while; a write must not.
  const trustedHops = (required(env, "CC_WARMBLY_OPERATOR_TRUSTED_HOPS") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter((hop) => hop !== "");
  if (trustedHops.length === 0) {
    deps.logger.error("warmbly.operator.trusted_hop_required", {
      msg: "CC_WARMBLY_OPERATOR_TRUSTED_HOPS must name the single proxy that may present Remote-* (for example the caddy address), and it must be narrower than the edge network",
    });
    return undefined;
  }
  if (!baseUrl || !token) {
    // Enabled but not configured is a misconfiguration, not a reason to run
    // half-wired: say so and stay off.
    deps.logger.error("warmbly.operator.not_configured", {
      msg: "CC_WARMBLY_OPERATOR_ENABLED=true requires CC_WARMBLY_BASE_URL and CC_WARMBLY_OPERATOR_TOKEN",
      has_base_url: Boolean(baseUrl),
      // The service logger refuses any field NAME matching /token/i and throws,
      // so `has_token` — and `token_present` — turn a misconfiguration into a
      // boot crash loop. The name must not contain the word at all.
      credential_present: Boolean(token),
    });
    return undefined;
  }

  let connector: Awaited<ReturnType<typeof loadConnector>>;
  try {
    connector = await loadConnector();
  } catch (err) {
    deps.logger.error("warmbly.operator.connector_unavailable", {
      msg: "the operator channel is enabled but its connector is not present in this image",
      error: err instanceof Error ? err.name : "unknown",
    });
    return undefined;
  }
  const {
    WarmblyOperatorClient,
    createAgentActivityLedgerSink,
    createFanOutOperatorActionLedger,
    createMemoryOperatorActionLedger,
    createOperatorHttpHandler,
    createWarmblyOperatorChannel,
    defaultOperatorSinkErrorHandler,
  } = connector;
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
  const sinks = deps.agentActivity
    ? [createAgentActivityLedgerSink(deps.agentActivity as never)]
    : [];
  const ledger = createFanOutOperatorActionLedger(
    primary,
    sinks,
    defaultOperatorSinkErrorHandler(log),
  );

  const channel = createWarmblyOperatorChannel({
    client,
    ledger,
    logger: log,
    identityPolicy: connector.defaultOperatorIdentityPolicy(trustedHops),
  });
  return createOperatorHttpHandler(channel) as WarmblyOperatorHandler;
}
