import { AsaasConfigError } from "./errors.js";
import type { AsaasConfig, AsaasEnvironment } from "./types.js";

export const SANDBOX_BASE_URL = "https://api-sandbox.asaas.com";
export const PRODUCTION_BASE_URL = "https://api.asaas.com";
export const DEFAULT_USER_AGENT = "ConfengeControlCenter-AsaasConnector/1.0";

const CANONICAL: Record<AsaasEnvironment, string> = {
  sandbox: SANDBOX_BASE_URL,
  production: PRODUCTION_BASE_URL,
};

function trim(value: string | undefined): string {
  return (value ?? "").trim();
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function looksLikeUrl(value: string): boolean {
  return /:\/\//.test(value) || /asaas\.com/i.test(value);
}

/** Opposite env key slots stay mixed even when ASAAS_API_KEY is also set. */
export function parseAsaasConfig(
  env: Record<string, string | undefined>,
): AsaasConfig {
  const rawEnv = trim(env.ASAAS_ENVIRONMENT).toLowerCase();
  if (rawEnv === "") {
    throw new AsaasConfigError(
      "ASAAS_ENVIRONMENT is required and must be exactly sandbox or production",
    );
  }
  if (rawEnv !== "sandbox" && rawEnv !== "production") {
    throw new AsaasConfigError(
      `ASAAS_ENVIRONMENT is unidentified (${rawEnv}); refusing to guess`,
    );
  }
  const environment: AsaasEnvironment = rawEnv;
  const canonical = CANONICAL[environment];

  const overrideRaw = trim(env.ASAAS_BASE_URL);
  if (overrideRaw !== "") {
    const override = stripTrailingSlash(overrideRaw);
    const other =
      environment === "sandbox" ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
    if (override === other || override.startsWith(other)) {
      throw new AsaasConfigError(
        `ASAAS_BASE_URL is ${environment === "sandbox" ? "production" : "sandbox"} while ASAAS_ENVIRONMENT=${environment}`,
      );
    }
    if (override !== canonical && override !== `${canonical}/v3`) {
      throw new AsaasConfigError(
        `ASAAS_BASE_URL does not match ASAAS_ENVIRONMENT=${environment} (expected ${canonical})`,
      );
    }
  }

  const sandboxKey = trim(env.ASAAS_API_KEY_SANDBOX);
  const productionKey = trim(env.ASAAS_API_KEY_PRODUCTION);
  const genericKey = trim(env.ASAAS_API_KEY);

  if (sandboxKey !== "" && productionKey !== "") {
    throw new AsaasConfigError(
      "mixed sandbox and production API key slots; refuse to choose",
    );
  }
  if (environment === "sandbox" && productionKey !== "") {
    throw new AsaasConfigError(
      "sandbox environment with production API key slot set",
    );
  }
  if (environment === "production" && sandboxKey !== "") {
    throw new AsaasConfigError(
      "production environment with sandbox API key slot set",
    );
  }

  const apiKey =
    environment === "sandbox"
      ? genericKey || sandboxKey
      : genericKey || productionKey;

  if (apiKey === "") {
    throw new AsaasConfigError("ASAAS_API_KEY is required");
  }
  if (looksLikeUrl(apiKey)) {
    throw new AsaasConfigError("API key must not contain a URL");
  }

  const userAgent = trim(env.ASAAS_USER_AGENT) || DEFAULT_USER_AGENT;

  return {
    environment,
    baseUrl: canonical,
    apiKey,
    userAgent,
  };
}

export function canonicalBaseUrl(environment: AsaasEnvironment): string {
  return CANONICAL[environment];
}
