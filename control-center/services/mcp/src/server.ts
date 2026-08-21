import { executeTool, getPrompt, promptDefinitions, readResource, resourceDefinitions, toolDefinitions } from "./catalog.js";
import { ERROR_CODES, jsonRpcCode, McpAppError, type ErrorCode } from "./errors.js";
import { createLogger, redact, type Logger } from "./logging.js";
import {
  authenticate,
  extractCorrelationId,
  extractPresentedToken,
  isRecord,
  RateLimiter,
  tokenFingerprint,
  type RateLimitConfig,
  type RequestExtras,
} from "./security.js";
import { createStubContextApi } from "./stub-adapter.js";
import { canonicalToolName, type ContextApiPort } from "./types.js";

export const PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"] as const;
export const DEFAULT_PROTOCOL_VERSION = "2025-03-26";
export const SERVER_INFO = { name: "confenge-control-center", version: "0.1.0" } as const;

const INITIALIZE_INSTRUCTIONS = [
  "Confenge Control Center MCP. Scoped operational context for agents.",
  "Before acting, get prompt confenge.session_preflight and read resource confenge://preflight/checklist.",
  "Reads are first-class. The only writes are confenge.report_session_result and confenge.report_blocker.",
  "Do not create or alter decisions, constraints, or authoritative directives.",
  "Do not charge, checkout, refund, cancel, or mutate payment providers.",
].join(" ");

export interface McpRuntimeOptions {
  context?: ContextApiPort;
  authToken?: string;
  logger?: Logger;
  rateLimit?: RateLimitConfig;
  secretsToRedact?: string[];
}

export interface McpRuntime {
  handleRaw(line: string, extras?: RequestExtras): Promise<string | null>;
}

interface RpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: unknown;
}

interface RpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export function createMcpRuntime(options: McpRuntimeOptions = {}): McpRuntime {
  const context = options.context ?? createStubContextApi();
  const logger = options.logger ?? createLogger();
  const limiter = new RateLimiter(options.rateLimit ?? { max: 30, windowMs: 60_000 });
  const expectedToken = options.authToken;
  const extraSecrets = [
    ...(options.secretsToRedact ?? []),
    ...(expectedToken ? [expectedToken] : []),
  ];
  let initialized = false;

  const runtime: McpRuntime = {
    async handleRaw(line: string, extras?: RequestExtras): Promise<string | null> {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        return null;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed) as unknown;
      } catch {
        const correlationId = extractCorrelationId(undefined, extras);
        logger.warn("mcp.parse_error", { correlation_id: correlationId });
        return serializeError(null, ERROR_CODES.PARSE_ERROR, "Parse error", correlationId, extraSecrets);
      }

      if (Array.isArray(parsed)) {
        const correlationId = extractCorrelationId(undefined, extras);
        return serializeError(
          null,
          ERROR_CODES.INVALID_REQUEST,
          "JSON-RPC batches are not supported",
          correlationId,
          extraSecrets,
        );
      }

      if (!isRecord(parsed) || parsed["jsonrpc"] !== "2.0") {
        const correlationId = extractCorrelationId(isRecord(parsed) ? parsed["params"] : undefined, extras);
        const id = isRecord(parsed) ? asId(parsed["id"]) : null;
        return serializeError(
          id,
          ERROR_CODES.INVALID_REQUEST,
          "Invalid Request",
          correlationId,
          extraSecrets,
        );
      }

      const method = parsed["method"];
      if (typeof method !== "string" || method.length === 0) {
        const correlationId = extractCorrelationId(parsed["params"], extras);
        return serializeError(
          asId(parsed["id"]),
          ERROR_CODES.INVALID_REQUEST,
          "method is required",
          correlationId,
          extraSecrets,
        );
      }

      const idPresent = Object.prototype.hasOwnProperty.call(parsed, "id");
      const params = parsed["params"];
      const correlationId = extractCorrelationId(params, extras);

      if (!idPresent) {
        await handleNotification({ jsonrpc: "2.0", method, params }, extras, correlationId);
        return null;
      }
      const id = asId(parsed["id"]);

      try {
        const result = await handleRequest(
          { jsonrpc: "2.0", id, method, params },
          extras,
          correlationId,
        );
        return JSON.stringify(
          redact({ jsonrpc: "2.0", id, result }, extraSecrets),
        );
      } catch (err) {
        if (err instanceof McpAppError) {
          logger.warn("mcp.request_error", {
            method,
            code: err.code,
            correlation_id: err.correlationId,
          });
          return serializeError(id, err.code, err.message, err.correlationId, extraSecrets);
        }
        const message = err instanceof Error ? err.message : "internal error";
        logger.error("mcp.internal_error", { method, correlation_id: correlationId, err: message });
        return serializeError(id, ERROR_CODES.INTERNAL, "internal error", correlationId, extraSecrets);
      }
    },
  };

  async function handleNotification(
    note: RpcNotification,
    extras: RequestExtras | undefined,
    correlationId: string,
  ): Promise<void> {
    if (note.method === "notifications/initialized") {
      initialized = true;
      logger.info("mcp.initialized", { correlation_id: correlationId });
      return;
    }
    if (note.method === "notifications/cancelled") {
      return;
    }
    logger.warn("mcp.unknown_notification", { method: note.method, correlation_id: correlationId });
    void extras;
  }

  async function handleRequest(
    req: RpcRequest,
    extras: RequestExtras | undefined,
    correlationId: string,
  ): Promise<unknown> {
    switch (req.method) {
      case "initialize":
        return handleInitialize(req.params, correlationId);
      case "ping":
        return {};
      case "tools/list":
        requireInitialized(correlationId);
        return { tools: toolDefinitions };
      case "resources/list":
        requireInitialized(correlationId);
        return { resources: resourceDefinitions };
      case "prompts/list":
        requireInitialized(correlationId);
        return { prompts: promptDefinitions };
      case "resources/read": {
        requireInitialized(correlationId);
        requireAuth(req.params, extras, correlationId);
        const uri = readStringField(req.params, "uri");
        if (uri === undefined) {
          throw new McpAppError(ERROR_CODES.INVALID_PARAMS, "uri is required", correlationId);
        }
        const body = readResource(uri, correlationId);
        return { contents: [{ uri, mimeType: body.mimeType, text: body.text }] };
      }
      case "prompts/get": {
        requireInitialized(correlationId);
        requireAuth(req.params, extras, correlationId);
        const name = readStringField(req.params, "name");
        if (name === undefined) {
          throw new McpAppError(ERROR_CODES.INVALID_PARAMS, "name is required", correlationId);
        }
        const argMap = promptArgs(req.params);
        return getPrompt(name, argMap, correlationId);
      }
      case "tools/call":
        return handleToolCall(req.params, extras, correlationId);
      default:
        throw new McpAppError(ERROR_CODES.METHOD_NOT_FOUND, `method not found: ${req.method}`, correlationId);
    }
  }

  function handleInitialize(params: unknown, correlationId: string): unknown {
    const requested =
      isRecord(params) && typeof params["protocolVersion"] === "string"
        ? params["protocolVersion"]
        : DEFAULT_PROTOCOL_VERSION;
    const protocolVersion = (PROTOCOL_VERSIONS as readonly string[]).includes(requested)
      ? requested
      : DEFAULT_PROTOCOL_VERSION;
    initialized = false;
    logger.info("mcp.initialize", { protocolVersion, correlation_id: correlationId });
    return {
      protocolVersion,
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      serverInfo: SERVER_INFO,
      instructions: INITIALIZE_INSTRUCTIONS,
    };
  }

  async function handleToolCall(
    params: unknown,
    extras: RequestExtras | undefined,
    correlationId: string,
  ): Promise<unknown> {
    requireInitialized(correlationId);
    requireAuth(params, extras, correlationId);

    const presented = extractPresentedToken(params, extras) ?? "anonymous";
    const limitKey = tokenFingerprint(presented);
    if (!limiter.allow(limitKey)) {
      throw new McpAppError(ERROR_CODES.RATE_LIMITED, "rate limit exceeded", correlationId);
    }

    const name = readStringField(params, "name");
    if (name === undefined) {
      throw new McpAppError(ERROR_CODES.INVALID_PARAMS, "tool name is required", correlationId);
    }
    const args = isRecord(params) ? params["arguments"] : undefined;
    const canonical = canonicalToolName(name) ?? name;

    logger.info("mcp.tools_call", {
      tool: name,
      canonical_tool: canonical,
      correlation_id: correlationId,
    });
    const payload = await executeTool(context, name, args, correlationId);
    const envelope = {
      correlation_id: correlationId,
      data: payload,
      invoked_name: name,
      canonical_name: canonical,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(envelope) }],
      isError: false,
      structuredContent: envelope,
    };
  }

  function requireInitialized(correlationId: string): void {
    if (!initialized) {
      throw new McpAppError(
        ERROR_CODES.NOT_INITIALIZED,
        "server is not initialized; send initialize then notifications/initialized",
        correlationId,
      );
    }
  }

  function requireAuth(params: unknown, extras: RequestExtras | undefined, correlationId: string): void {
    authenticate({
      expectedToken,
      presentedToken: extractPresentedToken(params, extras),
      correlationId,
    });
  }

  return runtime;
}

function asId(value: unknown): string | number | null {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  return null;
}

function readStringField(params: unknown, key: string): string | undefined {
  if (!isRecord(params)) {
    return undefined;
  }
  const value = params[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function promptArgs(params: unknown): Record<string, string> | undefined {
  if (!isRecord(params)) {
    return undefined;
  }
  const raw = params["arguments"];
  if (!isRecord(raw)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      out[key] = value;
    }
  }
  return out;
}

function serializeError(
  id: string | number | null,
  code: ErrorCode,
  message: string,
  correlationId: string,
  extraSecrets: string[],
): string {
  return JSON.stringify(
    redact(
      {
        jsonrpc: "2.0",
        id,
        error: {
          code: jsonRpcCode(code),
          message,
          data: {
            error: { code, message, correlation_id: correlationId },
            correlation_id: correlationId,
          },
        },
      },
      extraSecrets,
    ),
  );
}

export function loadAuthTokenFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value = env["CONFENGE_MCP_AUTH_TOKEN"];
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function loadRateLimitFromEnv(env: NodeJS.ProcessEnv = process.env): RateLimitConfig {
  const maxRaw = env["CONFENGE_MCP_RATE_LIMIT_MAX"];
  const windowRaw = env["CONFENGE_MCP_RATE_LIMIT_WINDOW_MS"];
  const max = maxRaw !== undefined ? Number.parseInt(maxRaw, 10) : 30;
  const windowMs = windowRaw !== undefined ? Number.parseInt(windowRaw, 10) : 60_000;
  return {
    max: Number.isFinite(max) && max > 0 ? max : 30,
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60_000,
  };
}
