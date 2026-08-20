import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { ERROR_CODES, McpAppError } from "./errors.js";

export interface RequestExtras {
  authorization?: string;
}

export interface RateLimitConfig {
  max: number;
  windowMs: number;
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly config: RateLimitConfig) {}

  allow(key: string, now = Date.now()): boolean {
    const windowStart = now - this.config.windowMs;
    const previous = this.hits.get(key) ?? [];
    const recent = previous.filter((ts) => ts > windowStart);
    if (recent.length >= this.config.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

export function newCorrelationId(): string {
  return `cc-mcp-${randomUUID()}`;
}

export function extractCorrelationId(params: unknown, extras?: RequestExtras): string {
  void extras;
  if (isRecord(params)) {
    const meta = params["_meta"];
    if (isRecord(meta)) {
      const fromMeta = meta["correlation_id"];
      if (typeof fromMeta === "string" && fromMeta.trim().length > 0) {
        return fromMeta.trim();
      }
    }
  }
  return newCorrelationId();
}

export function extractPresentedToken(params: unknown, extras?: RequestExtras): string | undefined {
  const header = extras?.authorization;
  const fromHeader = bearer(header);
  if (fromHeader !== undefined) {
    return fromHeader;
  }
  if (!isRecord(params)) {
    return undefined;
  }
  const meta = params["_meta"];
  if (!isRecord(meta)) {
    return undefined;
  }
  return bearer(typeof meta["authorization"] === "string" ? meta["authorization"] : undefined);
}

export function authenticate(args: {
  expectedToken: string | undefined;
  presentedToken: string | undefined;
  correlationId: string;
}): void {
  const expected = args.expectedToken?.trim() ?? "";
  if (expected.length === 0) {
    throw new McpAppError(
      ERROR_CODES.UNAUTHENTICATED,
      "auth token is not configured; refusing to serve context",
      args.correlationId,
    );
  }
  if (args.presentedToken === undefined || args.presentedToken.length === 0) {
    throw new McpAppError(
      ERROR_CODES.UNAUTHENTICATED,
      "missing auth token",
      args.correlationId,
    );
  }
  if (!tokensEqual(expected, args.presentedToken)) {
    throw new McpAppError(ERROR_CODES.INVALID_TOKEN, "invalid auth token", args.correlationId);
  }
}

export function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

export function tokensEqual(expected: string, presented: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(presented);
  if (left.length !== right.length) {
    if (left.length > 0) {
      timingSafeEqual(left, left);
    }
    return false;
  }
  return timingSafeEqual(left, right);
}

function bearer(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  if (match?.[1]) {
    return match[1].trim();
  }
  return undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const FORBIDDEN_MUTATION_TOOLS = [
  "confenge.create_directive",
  "confenge.update_directive",
  "confenge.create_decision",
  "confenge.update_decision",
  "confenge.create_constraint",
  "confenge.update_constraint",
  "confenge.charge",
  "confenge.checkout",
  "confenge.refund",
  "confenge.cancel",
  "confenge.asaas",
] as const;

const FORBIDDEN_WRITE_KEYS = [
  "create_directive",
  "update_directive",
  "upsert_directive",
  "create_decision",
  "update_decision",
  "create_constraint",
  "update_constraint",
  "authoritative_directive",
  "mutate_decision",
  "mutate_constraint",
  "mutate_directive",
];

export function assertNoAuthoritativeMutation(
  toolName: string,
  args: unknown,
  correlationId: string,
): void {
  if (FORBIDDEN_MUTATION_TOOLS.includes(toolName as (typeof FORBIDDEN_MUTATION_TOOLS)[number])) {
    throw new McpAppError(
      ERROR_CODES.FORBIDDEN_MUTATION,
      "agents cannot create or alter decisions, constraints, or authoritative directives",
      correlationId,
    );
  }
  if (looksLikeForbiddenMutation(args)) {
    throw new McpAppError(
      ERROR_CODES.FORBIDDEN_MUTATION,
      "agents cannot create or alter decisions, constraints, or authoritative directives",
      correlationId,
    );
  }
}

function looksLikeForbiddenMutation(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(looksLikeForbiddenMutation);
  }
  if (!isRecord(value)) {
    return false;
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_WRITE_KEYS.includes(key)) {
      return true;
    }
  }
  const action = value["action"];
  const kind = value["kind"];
  if (
    typeof action === "string" &&
    /^(create|update|upsert|supersede|delete)$/i.test(action) &&
    typeof kind === "string" &&
    /^(decision|constraint|directive)$/i.test(kind)
  ) {
    return true;
  }
  return Object.values(value).some(looksLikeForbiddenMutation);
}
