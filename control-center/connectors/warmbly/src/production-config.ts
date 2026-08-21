import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const WARMBLY_BASE_URL_SECRET = "WARMBLY_BASE_URL";
export const WARMBLY_TOKEN_SECRET = "WARMBLY_API_TOKEN";
export const WARMBLY_TOKEN_ALIASES = ["WARMBLY_API_TOKEN", "WARMBLY_TOKEN", "WARMBLY_API_KEY"] as const;

export const REQUIRED_SECRET_NAMES = [WARMBLY_BASE_URL_SECRET, WARMBLY_TOKEN_SECRET] as const;

export interface WarmblySecretsOk {
  readonly ok: true;
  readonly baseUrl: string;
  readonly token: string;
}

export interface WarmblySecretsMissing {
  readonly ok: false;
  readonly missing: string[];
}

export type WarmblySecrets = WarmblySecretsOk | WarmblySecretsMissing;

export interface WarmblyProductionConfig {
  readonly collector: "warmbly";
  readonly mode: "read-only";
  readonly required_secrets: readonly string[];
  readonly secret_aliases: Record<string, readonly string[]>;
}

export function productionConfigPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "config", "production.json");
}

export function loadWarmblyProductionConfig(): WarmblyProductionConfig {
  const raw = JSON.parse(readFileSync(productionConfigPath(), "utf8")) as WarmblyProductionConfig;
  if (raw.collector !== "warmbly" || raw.mode !== "read-only") {
    throw new Error("warmbly production config must be read-only collector=warmbly");
  }
  return raw;
}

export function resolveWarmblySecrets(env: NodeJS.ProcessEnv): WarmblySecrets {
  const baseUrl = env.WARMBLY_BASE_URL?.trim() ?? "";
  const token =
    env.WARMBLY_API_TOKEN?.trim() ||
    env.WARMBLY_TOKEN?.trim() ||
    env.WARMBLY_API_KEY?.trim() ||
    "";
  const missing: string[] = [];
  if (baseUrl === "") {
    missing.push(WARMBLY_BASE_URL_SECRET);
  }
  if (token === "") {
    missing.push(WARMBLY_TOKEN_SECRET);
  }
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return { ok: true, baseUrl, token };
}

export function sanitizeLocator(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
  } catch {
    return "WARMBLY_BASE_URL";
  }
}
