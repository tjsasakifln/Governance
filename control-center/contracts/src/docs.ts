import { readFileSync } from "node:fs";
import { resolveInPackage } from "./paths.js";

export interface ForbiddenOperation {
  name: string;
  reason: string;
}

export interface McpTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface McpContract {
  mcp_version: string;
  server_name: string;
  interface_role: string;
  scope_rule: string;
  tools: McpTool[];
  forbidden_operations: ForbiddenOperation[];
  resources: Array<{ uri_template: string; name: string }>;
}

export interface OpenApiDoc {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, unknown>;
  "x-forbidden-paths"?: Array<{ path: string; reason: string }>;
}

let mcpCache: McpContract | undefined;
let openApiCache: OpenApiDoc | undefined;

export function loadMcpContract(): McpContract {
  if (mcpCache !== undefined) {
    return mcpCache;
  }
  const raw = readFileSync(resolveInPackage("docs/mcp.v1.json"), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!isMcpContract(parsed)) {
    throw new Error("docs/mcp.v1.json is malformed");
  }
  mcpCache = parsed;
  return parsed;
}

export function loadOpenApi(): OpenApiDoc {
  if (openApiCache !== undefined) {
    return openApiCache;
  }
  const raw = readFileSync(resolveInPackage("docs/http.openapi.json"), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!isOpenApi(parsed)) {
    throw new Error("docs/http.openapi.json is malformed");
  }
  openApiCache = parsed;
  return parsed;
}

export function allowedMcpToolNames(): string[] {
  return loadMcpContract().tools.map((t) => t.name);
}

export function forbiddenMcpOperationNames(): string[] {
  return loadMcpContract().forbidden_operations.map((op) => op.name);
}

export function isForbiddenMcpOperation(name: string): boolean {
  return forbiddenMcpOperationNames().includes(name);
}

export function forbiddenHttpPaths(): string[] {
  const extra = loadOpenApi()["x-forbidden-paths"] ?? [];
  return extra.map((p) => p.path);
}

function isMcpContract(value: unknown): value is McpContract {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.mcp_version === "string" &&
    typeof rec.server_name === "string" &&
    typeof rec.interface_role === "string" &&
    typeof rec.scope_rule === "string" &&
    Array.isArray(rec.tools) &&
    Array.isArray(rec.forbidden_operations) &&
    Array.isArray(rec.resources)
  );
}

function isOpenApi(value: unknown): value is OpenApiDoc {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.openapi === "string" &&
    typeof rec.info === "object" &&
    rec.info !== null &&
    typeof rec.paths === "object" &&
    rec.paths !== null
  );
}
