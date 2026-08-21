import { resolveAuth } from "./auth.js";
import { MemoryEtagStore } from "./etag-store.js";
import { collectEnvSecrets, createLogger } from "./log.js";
import { parseRepoFullName } from "./provenance.js";
import type {
  CollectConfig,
  EtagStore,
  HttpTransport,
  StructuredLogger,
} from "./types.js";

export const DEFAULT_API_BASE = "https://api.github.com";
export const DEFAULT_RECENT_COMMIT_LIMIT = 10;

export type RawCollectInput = {
  repos?: unknown;
  token?: unknown;
  apiBase?: unknown;
  recentCommitLimit?: unknown;
  env?: NodeJS.Dict<string>;
  now?: () => Date;
  transport: HttpTransport;
  etagStore?: EtagStore;
  logger?: StructuredLogger;
  compareHeads?: unknown;
  logSink?: (line: string) => void;
};

export type ConfigSuccess = {
  ok: true;
  config: CollectConfig;
  secrets: string[];
};

export type ConfigResult =
  | ConfigSuccess
  | { ok: false; code: string; message: string };

export function parseCollectConfig(input: RawCollectInput): ConfigResult {
  const env = input.env ?? {};
  const secrets = collectEnvSecrets(env);

  const reposResult = parseRepos(input.repos ?? env.GITHUB_REPOS);
  if (!reposResult.ok) {
    return reposResult;
  }

  let token: string;
  if (typeof input.token === "string" && input.token.trim().length > 0) {
    token = input.token.trim();
    secrets.push(token);
  } else {
    const auth = resolveAuth(env);
    if (!auth.ok) {
      return { ok: false, code: auth.code, message: auth.message };
    }
    token = auth.token;
  }

  const apiBase = parseApiBase(input.apiBase ?? env.GITHUB_API_BASE);
  if (!apiBase.ok) {
    return apiBase;
  }

  const recentCommitLimit = parseRecentCommitLimit(
    input.recentCommitLimit ?? env.GITHUB_RECENT_COMMIT_LIMIT,
  );
  if (!recentCommitLimit.ok) {
    return recentCommitLimit;
  }

  const compareHeads = parseCompareHeads(input.compareHeads ?? env.GITHUB_COMPARE_HEADS);
  if (!compareHeads.ok) {
    return compareHeads;
  }

  const now = input.now ?? (() => new Date());
  const logger =
    input.logger ??
    createLogger(input.logSink, now, secrets);

  const config: CollectConfig = {
    repos: reposResult.repos,
    token,
    apiBase: apiBase.apiBase,
    recentCommitLimit: recentCommitLimit.limit,
    now,
    transport: input.transport,
    etagStore: input.etagStore ?? new MemoryEtagStore(),
    logger,
  };
  if (Object.keys(compareHeads.heads).length > 0) {
    config.compareHeads = compareHeads.heads;
  }

  return { ok: true, config, secrets };
}

export function parseRepos(raw: unknown): { ok: true; repos: string[] } | { ok: false; code: "invalid_config"; message: string } {
  const values: string[] = [];
  if (raw === undefined || raw === null || raw === "") {
    return {
      ok: false,
      code: "invalid_config",
      message: "Allowlist is required (repos input or GITHUB_REPOS=owner/name,owner/name).",
    };
  }
  if (typeof raw === "string") {
    values.push(...raw.split(",").map((part) => part.trim()).filter(Boolean));
  } else if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== "string") {
        return {
          ok: false,
          code: "invalid_config",
          message: "Each allowlisted repo must be a string owner/name.",
        };
      }
      values.push(item.trim());
    }
  } else {
    return {
      ok: false,
      code: "invalid_config",
      message: "Allowlist must be a comma-separated string or string array.",
    };
  }

  const seen = new Set<string>();
  const repos: string[] = [];
  for (const value of values) {
    const parsed = parseRepoFullName(value);
    if (!parsed) {
      return {
        ok: false,
        code: "invalid_config",
        message: `Invalid repo allowlist entry (expected owner/name): ${value}`,
      };
    }
    const key = parsed.full_name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      repos.push(parsed.full_name);
    }
  }
  if (repos.length === 0) {
    return {
      ok: false,
      code: "invalid_config",
      message: "Allowlist parsed to zero repositories.",
    };
  }
  return { ok: true, repos };
}

function parseApiBase(
  raw: unknown,
): { ok: true; apiBase: string } | { ok: false; code: "invalid_config"; message: string } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, apiBase: DEFAULT_API_BASE };
  }
  if (typeof raw !== "string") {
    return { ok: false, code: "invalid_config", message: "GITHUB_API_BASE must be a string URL." };
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { ok: false, code: "invalid_config", message: "GITHUB_API_BASE must be http(s)." };
    }
    return { ok: true, apiBase: url.origin };
  } catch {
    return { ok: false, code: "invalid_config", message: "GITHUB_API_BASE is not a valid URL." };
  }
}

function parseRecentCommitLimit(
  raw: unknown,
): { ok: true; limit: number } | { ok: false; code: "invalid_config"; message: string } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, limit: DEFAULT_RECENT_COMMIT_LIMIT };
  }
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    return {
      ok: false,
      code: "invalid_config",
      message: "recentCommitLimit must be an integer from 1 to 100.",
    };
  }
  return { ok: true, limit: n };
}

function parseCompareHeads(
  raw: unknown,
):
  | { ok: true; heads: Record<string, { base?: string; head: string }> }
  | { ok: false; code: "invalid_config"; message: string } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, heads: {} };
  }
  let record: unknown = raw;
  if (typeof raw === "string") {
    try {
      record = JSON.parse(raw) as unknown;
    } catch {
      return {
        ok: false,
        code: "invalid_config",
        message: "GITHUB_COMPARE_HEADS must be JSON object of repo -> {base,head}.",
      };
    }
  }
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return {
      ok: false,
      code: "invalid_config",
      message: "compareHeads must be an object keyed by owner/name.",
    };
  }
  const heads: Record<string, { base?: string; head: string }> = {};
  for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
    const repo = parseRepoFullName(key);
    if (!repo) {
      return {
        ok: false,
        code: "invalid_config",
        message: `compareHeads key is not owner/name: ${key}`,
      };
    }
    if (typeof value === "string" && value.trim().length > 0) {
      heads[repo.full_name] = { head: value.trim() };
      continue;
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const rec = value as Record<string, unknown>;
      if (typeof rec.head !== "string" || rec.head.trim().length === 0) {
        return {
          ok: false,
          code: "invalid_config",
          message: `compareHeads.${repo.full_name}.head must be a non-empty string.`,
        };
      }
      const entry: { base?: string; head: string } = { head: rec.head.trim() };
      if (typeof rec.base === "string" && rec.base.trim().length > 0) {
        entry.base = rec.base.trim();
      }
      heads[repo.full_name] = entry;
      continue;
    }
    return {
      ok: false,
      code: "invalid_config",
      message: `compareHeads.${repo.full_name} must be a ref string or {base,head}.`,
    };
  }
  return { ok: true, heads };
}
