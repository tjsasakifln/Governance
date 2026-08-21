import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { packageRoot } from "./paths.js";

export interface PublicArtifact {
  path: string;
  canonical: string;
}

const STATIC_JSON_ARTIFACTS = [
  "catalog.json",
  "docs/compatibility.v1.json",
  "docs/http.openapi.json",
  "docs/mcp.v1.json",
] as const;

/**
 * Public ontology inputs whose canonical bytes feed CONTRACT_FINGERPRINT.
 * Changing a schema, catalog, taxonomy, compatibility table, or HTTP/MCP
 * contract byte changes the digest.
 */
export function publicOntologyArtifacts(root = packageRoot()): PublicArtifact[] {
  const schemaDir = path.join(root, "schemas");
  const schemaFiles = readdirSync(schemaDir)
    .filter((name) => name.endsWith(".schema.json"))
    .map((name) => `schemas/${name}`);
  const rels = [...STATIC_JSON_ARTIFACTS, ...schemaFiles, "src/taxonomy.ts"].sort();
  return rels.map((rel) => ({
    path: rel,
    canonical: canonicalize(root, rel),
  }));
}

export function fingerprintArtifacts(artifacts: PublicArtifact[]): string {
  const hash = createHash("sha256");
  const sorted = [...artifacts].sort((a, b) => a.path.localeCompare(b.path));
  for (const item of sorted) {
    hash.update(item.path);
    hash.update("\n");
    hash.update(item.canonical);
    hash.update("\n");
  }
  return `sha256:${hash.digest("hex")}`;
}

export function contractFingerprint(root = packageRoot()): string {
  return fingerprintArtifacts(publicOntologyArtifacts(root));
}

function canonicalize(root: string, rel: string): string {
  const raw = readFileSync(path.join(root, rel), "utf8");
  if (rel.endsWith(".json")) {
    return JSON.stringify(sortKeys(JSON.parse(raw) as unknown));
  }
  return raw.replace(/\r\n/g, "\n");
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value === "object" && value !== null) {
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(rec).sort()) {
      out[key] = sortKeys(rec[key]);
    }
    return out;
  }
  return value;
}
