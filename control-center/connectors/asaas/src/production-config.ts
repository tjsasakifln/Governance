import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AsaasConfigError } from "./errors.js";
import { parseAsaasConfig } from "./config.js";
import type { AsaasConfig } from "./types.js";

export const ASAAS_REQUIRED_SECRETS = ["ASAAS_ENVIRONMENT", "ASAAS_API_KEY"] as const;

export interface AsaasProductionConfig {
  readonly collector: "asaas";
  readonly mode: "read-only";
  readonly egress: "https";
  readonly required_secrets: readonly string[];
}

export function productionConfigPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "config", "production.json");
}

export function loadAsaasProductionConfig(): AsaasProductionConfig {
  const raw = JSON.parse(readFileSync(productionConfigPath(), "utf8")) as AsaasProductionConfig;
  if (raw.collector !== "asaas" || raw.mode !== "read-only" || raw.egress !== "https") {
    throw new Error("asaas production config must be HTTPS read-only");
  }
  return raw;
}

export function missingAsaasSecretNames(env: NodeJS.ProcessEnv): string[] {
  const missing: string[] = [];
  if ((env.ASAAS_ENVIRONMENT ?? "").trim() === "") {
    missing.push("ASAAS_ENVIRONMENT");
  }
  const key =
    (env.ASAAS_API_KEY ?? "").trim() ||
    (env.ASAAS_API_KEY_SANDBOX ?? "").trim() ||
    (env.ASAAS_API_KEY_PRODUCTION ?? "").trim();
  if (key === "") {
    missing.push("ASAAS_API_KEY");
  }
  return missing;
}

export function resolveAsaasProductionConfig(
  env: NodeJS.ProcessEnv,
):
  | { ok: true; config: AsaasConfig }
  | { ok: false; missing: string[]; message: string; code: "CREDENTIAL_MISSING" | "CONFIG" } {
  const missing = missingAsaasSecretNames(env);
  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      code: "CREDENTIAL_MISSING",
      message: `Missing ${missing.join(", ")} (XOR sandbox/production key slots: ASAAS_API_KEY_SANDBOX / ASAAS_API_KEY_PRODUCTION)`,
    };
  }
  try {
    return { ok: true, config: parseAsaasConfig(env) };
  } catch (err) {
    const message = err instanceof AsaasConfigError ? err.message : "asaas config rejected";
    return {
      ok: false,
      missing: [],
      code: "CONFIG",
      message,
    };
  }
}
