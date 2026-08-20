import { parseAgentPayload } from "./agent.js";
import { parseAllowlist } from "./allowlist.js";
import { parseUtcIso } from "./ids.js";
import type { ProbePorts } from "./ports.js";
import type { Allowlist, AllowlistTarget, HttpSample, ReachabilitySample, TlsSample } from "./types.js";

export interface FixtureFile {
  readonly now: string;
  readonly allowlist: unknown;
  readonly hang?: readonly string[];
  readonly reachability?: Readonly<Record<string, ReachabilitySample>>;
  readonly http?: Readonly<Record<string, HttpSample>>;
  readonly tls?: Readonly<Record<string, TlsSample>>;
  readonly agent?: Readonly<Record<string, unknown>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hangForever(): Promise<never> {
  return new Promise(() => {
    /* fixture-driven timeout: collect() timeout wrapper must win */
  });
}

function hangKey(targetId: string, check: string): string {
  return `${targetId}:${check}`;
}

export function parseFixture(raw: unknown): FixtureFile {
  if (!isRecord(raw) || typeof raw.now !== "string") {
    throw new Error("fixture.now is required");
  }
  parseUtcIso(raw.now, "fixture.now");
  if (!("allowlist" in raw)) {
    throw new Error("fixture.allowlist is required");
  }
  const hang = Array.isArray(raw.hang)
    ? raw.hang.filter((item): item is string => typeof item === "string")
    : [];
  const fixture: FixtureFile = {
    now: raw.now,
    allowlist: raw.allowlist,
  };
  if (hang.length > 0) {
    Object.assign(fixture, { hang });
  }
  if (isRecord(raw.reachability)) {
    Object.assign(fixture, { reachability: raw.reachability as Record<string, ReachabilitySample> });
  }
  if (isRecord(raw.http)) {
    Object.assign(fixture, { http: raw.http as Record<string, HttpSample> });
  }
  if (isRecord(raw.tls)) {
    Object.assign(fixture, { tls: raw.tls as Record<string, TlsSample> });
  }
  if (isRecord(raw.agent)) {
    Object.assign(fixture, { agent: raw.agent });
  }
  return fixture;
}

function findTarget(
  allowlist: Allowlist,
  predicate: (target: AllowlistTarget) => boolean,
): AllowlistTarget | undefined {
  return allowlist.targets.find(predicate);
}

export function createFixturePorts(fixture: FixtureFile, allowlist?: Allowlist): ProbePorts {
  const now = parseUtcIso(fixture.now, "fixture.now");
  const resolved = allowlist ?? parseAllowlist(fixture.allowlist);
  const hangs = new Set(fixture.hang ?? []);

  return {
    now: () => now,
    async reachHost(host, port) {
      const target = findTarget(
        resolved,
        (item) => item.host === host && (item.port ?? 443) === port,
      );
      if (target && hangs.has(hangKey(target.id, "reachability"))) {
        return hangForever();
      }
      if (target) {
        return fixture.reachability?.[target.id] ?? { ok: false, error: "fixture reachability missing" };
      }
      return { ok: false, error: "host is not allowlisted" };
    },
    async httpGet(url) {
      const target = findTarget(resolved, (item) => item.url === url);
      if (target && hangs.has(hangKey(target.id, "http"))) {
        return hangForever();
      }
      if (target) {
        return fixture.http?.[target.id] ?? { status: 0, error: "fixture HTTP sample missing" };
      }
      return { status: 0, error: "url is not allowlisted" };
    },
    async readTls(host, port) {
      const target = findTarget(
        resolved,
        (item) => item.host === host && (item.port ?? 443) === port,
      );
      if (target && hangs.has(hangKey(target.id, "tls"))) {
        return hangForever();
      }
      if (target) {
        return (
          fixture.tls?.[target.id] ?? {
            not_after: "1970-01-01T00:00:00.000Z",
            error: "fixture TLS sample missing",
          }
        );
      }
      return { not_after: "1970-01-01T00:00:00.000Z", error: "host is not allowlisted" };
    },
    async readAgent(targetId) {
      const agentChecks = ["host_metrics", "docker", "backup", "uptime"] as const;
      for (const check of agentChecks) {
        if (hangs.has(hangKey(targetId, check))) {
          return hangForever();
        }
      }
      const raw = fixture.agent?.[targetId];
      if (raw === undefined) {
        return null;
      }
      return parseAgentPayload(raw);
    },
  };
}
