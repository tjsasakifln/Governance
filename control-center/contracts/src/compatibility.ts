import { readFileSync } from "node:fs";
import { resolveInPackage } from "./paths.js";

export type CompatibilityVerdict = "canonical" | "reject" | "adapter_required";

export interface CompatibilityShape {
  id: string;
  description: string;
  verdict: "reject" | "adapter_required";
  reason: string;
}

export interface CompatibilityTable {
  schema_family: string;
  release: string;
  rule: string;
  shapes: CompatibilityShape[];
}

export interface CompatibilityFinding {
  shape_id: string;
  verdict: "reject" | "adapter_required";
  path: string;
  message: string;
}

export interface CompatibilityResult {
  verdict: CompatibilityVerdict;
  findings: CompatibilityFinding[];
}

const REQUIRED_SHAPE_IDS = [
  "lowercase_freshness",
  "expired_as_freshness",
  "withdrawn_or_inactive_status",
  "scope_object",
  "raw_uuid_id",
] as const;

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const LOWERCASE_FRESHNESS = new Set(["fresh", "stale", "unknown", "error"]);

const OPAQUE_KEYS = new Set(["payload", "detail", "body", "notes"]);

let tableCache: CompatibilityTable | undefined;

export function loadCompatibilityTable(): CompatibilityTable {
  if (tableCache !== undefined) {
    return tableCache;
  }
  const raw = readFileSync(resolveInPackage("docs/compatibility.v1.json"), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!isCompatibilityTable(parsed)) {
    throw new Error("docs/compatibility.v1.json is malformed");
  }
  const ids = new Set(parsed.shapes.map((s) => s.id));
  for (const required of REQUIRED_SHAPE_IDS) {
    if (!ids.has(required)) {
      throw new Error(`compatibility table missing required shape '${required}'`);
    }
  }
  tableCache = parsed;
  return parsed;
}

export function compatibilityShape(id: string): CompatibilityShape {
  const found = loadCompatibilityTable().shapes.find((s) => s.id === id);
  if (found === undefined) {
    throw new Error(`unknown compatibility shape: ${id}`);
  }
  return found;
}

/**
 * Classify a document against the public compatibility table.
 * Never silently accepts the five incompatible shapes.
 */
export function classifyCompatibility(data: unknown): CompatibilityResult {
  const table = loadCompatibilityTable();
  const findings: CompatibilityFinding[] = [];
  walk(data, "", findings, table);
  return {
    verdict: aggregateVerdict(findings),
    findings: dedupeFindings(findings),
  };
}

function aggregateVerdict(findings: CompatibilityFinding[]): CompatibilityVerdict {
  if (findings.some((f) => f.verdict === "reject")) {
    return "reject";
  }
  if (findings.some((f) => f.verdict === "adapter_required")) {
    return "adapter_required";
  }
  return "canonical";
}

function walk(
  value: unknown,
  pathExpr: string,
  findings: CompatibilityFinding[],
  table: CompatibilityTable,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${pathExpr}/${i}`, findings, table));
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  const rec = value as Record<string, unknown>;

  const freshness = rec.freshness_status ?? rec.freshness;
  if (typeof freshness === "string") {
    if (LOWERCASE_FRESHNESS.has(freshness)) {
      pushFinding(findings, table, "lowercase_freshness", freshnessPath(pathExpr, rec));
    }
    if (freshness === "expired") {
      pushFinding(findings, table, "expired_as_freshness", freshnessPath(pathExpr, rec));
    }
  }

  if (typeof rec.status === "string" && (rec.status === "withdrawn" || rec.status === "inactive")) {
    pushFinding(findings, table, "withdrawn_or_inactive_status", `${pathExpr}/status`);
  }

  if (rec.scope !== undefined && typeof rec.scope === "object" && rec.scope !== null) {
    pushFinding(findings, table, "scope_object", `${pathExpr}/scope`);
  }

  if (typeof rec.id === "string" && UUID_RE.test(rec.id)) {
    pushFinding(findings, table, "raw_uuid_id", `${pathExpr}/id`);
  }

  for (const [key, child] of Object.entries(rec)) {
    if (OPAQUE_KEYS.has(key)) {
      continue;
    }
    walk(child, `${pathExpr}/${key}`, findings, table);
  }
}

function freshnessPath(pathExpr: string, rec: Record<string, unknown>): string {
  if ("freshness_status" in rec) {
    return `${pathExpr}/freshness_status`;
  }
  if ("freshness" in rec) {
    return `${pathExpr}/freshness`;
  }
  return pathExpr;
}

function pushFinding(
  findings: CompatibilityFinding[],
  table: CompatibilityTable,
  shapeId: string,
  pathExpr: string,
): void {
  const shape = table.shapes.find((s) => s.id === shapeId);
  if (shape === undefined) {
    throw new Error(`compatibility table missing shape '${shapeId}'`);
  }
  findings.push({
    shape_id: shape.id,
    verdict: shape.verdict,
    path: pathExpr === "" ? "/" : pathExpr,
    message: shape.reason,
  });
}

function dedupeFindings(findings: CompatibilityFinding[]): CompatibilityFinding[] {
  const seen = new Set<string>();
  const out: CompatibilityFinding[] = [];
  for (const item of findings) {
    const key = `${item.shape_id}|${item.path}|${item.verdict}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }
  return out;
}

function isCompatibilityTable(value: unknown): value is CompatibilityTable {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  if (!Array.isArray(rec.shapes)) {
    return false;
  }
  for (const row of rec.shapes) {
    if (typeof row !== "object" || row === null) {
      return false;
    }
    const shape = row as Record<string, unknown>;
    if (
      typeof shape.id !== "string" ||
      typeof shape.description !== "string" ||
      typeof shape.reason !== "string" ||
      (shape.verdict !== "reject" && shape.verdict !== "adapter_required")
    ) {
      return false;
    }
  }
  return (
    typeof rec.schema_family === "string" &&
    typeof rec.release === "string" &&
    typeof rec.rule === "string"
  );
}
