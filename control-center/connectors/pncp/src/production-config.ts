import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { commandArgvIsForbidden } from "./config.js";
import { CONTRACT_VERSION } from "./types.js";

export const PNCP_BINDING_SECRETS = ["PNCP_CONTRACT_PATH", "PNCP_CONTRACT_HTTP_URL"] as const;

export const DEFAULT_NETCUP_CANDIDATES = [
  "/var/lib/extra-cli/pncp/PNCP_CONTRACT_FRESHNESS.json",
  "/var/lib/extra-cli/pncp-contract-freshness.json",
  "/opt/extra-cli/var/PNCP_CONTRACT_FRESHNESS.json",
] as const;

export interface PncpProductionConfig {
  readonly collector: "pncp";
  readonly mode: "read-only";
  readonly contract: typeof CONTRACT_VERSION;
  readonly netcup_candidates: readonly string[];
}

export type PncpBinding =
  | { ok: true; kind: "file"; filePath: string }
  | { ok: true; kind: "http"; httpUrl: string }
  | { ok: false; code: "BINDING_MISSING" | "FIXTURE_FORBIDDEN" | "FORBIDDEN_LIVE_COLLECTION"; message: string };

export function productionConfigPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "config", "production.json");
}

export function loadPncpProductionConfig(): PncpProductionConfig {
  const raw = JSON.parse(readFileSync(productionConfigPath(), "utf8")) as PncpProductionConfig;
  if (raw.collector !== "pncp" || raw.mode !== "read-only") {
    throw new Error("pncp production config must be read-only");
  }
  if (raw.contract !== CONTRACT_VERSION) {
    throw new Error(`pncp production contract must be ${CONTRACT_VERSION}`);
  }
  return raw;
}

export function isFixtureLocator(locator: string): boolean {
  const normalized = locator.replace(/\\/g, "/");
  return (
    /(^|\/)fixtures\//.test(normalized) ||
    normalized.includes("connectors/pncp/fixtures") ||
    /\/pncp\/fixtures\//.test(normalized)
  );
}

export function argvLooksForbidden(argv: readonly string[]): boolean {
  if (commandArgvIsForbidden(argv)) {
    return true;
  }
  return argv.some((token) => /^(--)?(live|ingest|recrawl|backfill)$/i.test(token));
}

export function resolvePncpProductionBinding(
  env: NodeJS.ProcessEnv,
  exists: (path: string) => boolean = existsSync,
  candidates: readonly string[] = DEFAULT_NETCUP_CANDIDATES,
): PncpBinding {
  const httpUrl = (env.PNCP_CONTRACT_HTTP_URL ?? "").trim();
  if (httpUrl !== "") {
    if (isFixtureLocator(httpUrl)) {
      return {
        ok: false,
        code: "FIXTURE_FORBIDDEN",
        message: "production PNCP binding must not be a repo fixture",
      };
    }
    return { ok: true, kind: "http", httpUrl };
  }
  const filePath = (env.PNCP_CONTRACT_PATH ?? "").trim();
  if (filePath !== "") {
    if (isFixtureLocator(filePath)) {
      return {
        ok: false,
        code: "FIXTURE_FORBIDDEN",
        message: "production PNCP binding must not be a repo fixture",
      };
    }
    return { ok: true, kind: "file", filePath };
  }
  for (const candidate of candidates) {
    if (isFixtureLocator(candidate)) {
      continue;
    }
    if (exists(candidate)) {
      return { ok: true, kind: "file", filePath: candidate };
    }
  }
  return {
    ok: false,
    code: "BINDING_MISSING",
    message: `No extra-cli ${CONTRACT_VERSION} binding (set PNCP_CONTRACT_PATH or PNCP_CONTRACT_HTTP_URL)`,
  };
}
