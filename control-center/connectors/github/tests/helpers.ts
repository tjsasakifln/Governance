import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCollectConfig } from "../src/config.js";
import { loadFixtureDir, type RecordingTransport } from "../src/fixture-transport.js";
import { MemoryEtagStore } from "../src/etag-store.js";
import type { CollectConfig, CollectResult, HttpRequest } from "../src/types.js";

export const FIXED_NOW = new Date("2026-08-20T18:00:00.000Z");
export const TEST_TOKEN = "ghs_live_secret_token_abc123xyz789notreal";
export const ALLOWLIST = ["tjsasakifln/Governance", "tjsasakifln/web-cfg"] as const;

export function fixturesRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "../fixtures"), join(here, "../../fixtures")];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "populated/manifest.json"))) {
      return candidate;
    }
  }
  throw new Error(`fixtures not found from ${here}`);
}

export function fixtureDir(name: string): string {
  return join(fixturesRoot(), name);
}

export function loadConfig(
  name: string,
  overrides: {
    repos?: string[];
    token?: string;
    extraLogs?: string[];
  } = {},
): { config: CollectConfig; transport: RecordingTransport; logs: string[] } {
  const loaded = loadFixtureDir(fixtureDir(name));
  const logs: string[] = [];
  const parsed = parseCollectConfig({
    repos: overrides.repos ?? loaded.manifest.repos ?? [...ALLOWLIST],
    token: overrides.token ?? TEST_TOKEN,
    transport: loaded.transport,
    etagStore: new MemoryEtagStore(),
    now: () => FIXED_NOW,
    logSink: (line) => {
      logs.push(line);
      if (overrides.extraLogs) {
        overrides.extraLogs.push(line);
      }
    },
    env: { GITHUB_TOKEN: overrides.token ?? TEST_TOKEN },
  });
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  return { config: parsed.config, transport: loaded.transport, logs };
}

export function observationIds(result: CollectResult): string[] {
  return result.observations.map((item) => item.observation_id).sort();
}

export function requestMethods(requests: HttpRequest[]): string[] {
  return requests.map((req) => req.method);
}

export function requestPaths(requests: HttpRequest[]): string[] {
  return requests.map((req) => new URL(req.url).pathname);
}

export function serialized(result: CollectResult): string {
  return JSON.stringify(result);
}

export function assertProvenance(item: {
  source: string;
  observed_at: string;
  freshness_status: string;
  confidence?: number;
}): void {
  assert.equal(item.source, "github");
  assert.equal(item.observed_at, FIXED_NOW.toISOString());
  assert.match(item.observed_at, /Z$/);
  assert.ok(
    ["fresh", "stale", "failed", "not_modified", "unsupported"].includes(
      item.freshness_status,
    ),
  );
}
