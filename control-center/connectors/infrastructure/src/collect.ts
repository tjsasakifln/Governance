import { parseAllowlist } from "./allowlist.js";
import { deriveExceptions } from "./exceptions.js";
import { logEvent } from "./log.js";
import { assertKnownTargets, mapCollectRecords } from "./map.js";
import type { ProbePorts } from "./ports.js";
import { runProbes } from "./probes.js";
import { ADAPTER_SCHEMA_VERSION, type Allowlist, type CollectResult, type ProbeResult } from "./types.js";
import { toUtcIso } from "./ids.js";

export interface CollectInput {
  readonly allowlist: unknown;
  readonly ports: ProbePorts;
}

export function mapCollectResult(
  allowlist: Allowlist,
  probes: readonly ProbeResult[],
  now: Date,
  startedAt: Date = now,
): CollectResult {
  assertKnownTargets(allowlist, probes);
  const { observations, service_health } = mapCollectRecords(allowlist, probes, now);
  const exceptions = deriveExceptions(allowlist, observations);
  return {
    collector_run: {
      schema_version: ADAPTER_SCHEMA_VERSION,
      collector_id: allowlist.collector_id,
      source: allowlist.source,
      started_at: toUtcIso(startedAt),
      finished_at: toUtcIso(now),
      target_count: allowlist.targets.length,
      observation_count: observations.length,
      exception_count: exceptions.length,
    },
    observations,
    service_health,
    exceptions,
  };
}

export async function collect(input: CollectInput): Promise<CollectResult> {
  const allowlist = parseAllowlist(input.allowlist);
  const startedAt = input.ports.now();
  logEvent("infra_collect_start", {
    collector_id: allowlist.collector_id,
    source: allowlist.source,
    target_count: allowlist.targets.length,
  });
  const probes = await runProbes(allowlist, input.ports);
  const finishedAt = input.ports.now();
  const result = mapCollectResult(allowlist, probes, finishedAt, startedAt);
  logEvent("infra_collect_finish", {
    collector_id: allowlist.collector_id,
    observation_count: result.observations.length,
    exception_count: result.exceptions.length,
    health_count: result.service_health.length,
  });
  return result;
}
