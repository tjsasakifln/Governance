import type { CollectionErrorCode } from "./types.js";

export type AuthSuccess = {
  ok: true;
  token: string;
  mode: "pat" | "github_app_installation_token";
};

export type AuthFailure = {
  ok: false;
  code: Extract<
    CollectionErrorCode,
    "missing_credentials" | "missing_installation_token"
  >;
  message: string;
};

export type AuthResult = AuthSuccess | AuthFailure;

const TOKEN_KEYS = [
  "GITHUB_TOKEN",
  "GITHUB_PAT",
  "GH_TOKEN",
  "GITHUB_APP_INSTALLATION_TOKEN",
] as const;

export function resolveAuth(env: NodeJS.Dict<string>): AuthResult {
  const installationToken = trimEnv(env.GITHUB_APP_INSTALLATION_TOKEN);
  if (installationToken) {
    return {
      ok: true,
      token: installationToken,
      mode: "github_app_installation_token",
    };
  }

  for (const key of ["GITHUB_TOKEN", "GITHUB_PAT", "GH_TOKEN"] as const) {
    const value = trimEnv(env[key]);
    if (value) {
      return { ok: true, token: value, mode: "pat" };
    }
  }

  const hasAppPieces =
    Boolean(trimEnv(env.GITHUB_APP_ID)) &&
    Boolean(trimEnv(env.GITHUB_APP_PRIVATE_KEY)) &&
    Boolean(trimEnv(env.GITHUB_APP_INSTALLATION_ID));

  if (hasAppPieces) {
    return {
      ok: false,
      code: "missing_installation_token",
      message:
        "GitHub App id/private key/installation id are present but GITHUB_APP_INSTALLATION_TOKEN is required. This collector does not POST to mint installation tokens.",
    };
  }

  return {
    ok: false,
    code: "missing_credentials",
    message:
      "No GitHub bearer token in env. Set GITHUB_TOKEN, GITHUB_PAT, GH_TOKEN, or GITHUB_APP_INSTALLATION_TOKEN.",
  };
}

export function tokenEnvKeys(): readonly string[] {
  return TOKEN_KEYS;
}

function trimEnv(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
