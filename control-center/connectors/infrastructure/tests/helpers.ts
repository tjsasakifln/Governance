import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAllowlist } from "../src/allowlist.js";
import { collect } from "../src/collect.js";
import { createFixturePorts, parseFixture, type FixtureFile } from "../src/fixture-ports.js";
import { findPackageRoot } from "../src/paths.js";
import type { CollectResult, SourceObservation } from "../src/types.js";

export function loadFixtureFile(name: string): FixtureFile {
  const raw: unknown = JSON.parse(readFileSync(join(findPackageRoot(), "fixtures", name), "utf8"));
  return parseFixture(raw);
}

export async function collectFixture(name: string): Promise<CollectResult> {
  const fixture = loadFixtureFile(name);
  const allowlist = parseAllowlist(fixture.allowlist);
  return collect({
    allowlist,
    ports: createFixturePorts(fixture, allowlist),
  });
}

export function obs(
  result: CollectResult,
  targetId: string,
  check: string,
): SourceObservation {
  const found = result.observations.find((item) => item.target_id === targetId && item.check === check);
  if (!found) {
    throw new Error(`missing observation ${targetId}:${check}`);
  }
  return found;
}

export function hasProvenance(item: {
  source: string;
  observed_at: string;
  freshness_status: string;
}): boolean {
  return (
    item.source.length > 0 &&
    /^\d{4}-\d{2}-\d{2}T/.test(item.observed_at) &&
    item.observed_at.endsWith("Z") &&
    ["FRESH", "STALE", "UNKNOWN", "ERROR"].includes(item.freshness_status)
  );
}

export function isHealthyFresh(result: CollectResult, targetId: string): boolean {
  const health = result.service_health.find((item) => item.service_id === targetId);
  return health?.status === "healthy" && health.freshness_status === "FRESH";
}
