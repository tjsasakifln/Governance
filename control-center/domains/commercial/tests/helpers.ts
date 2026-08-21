import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FUNNEL_KEYS,
  type CommercialObservationSet,
  type FunnelKey,
  type WarmblyCommercialRecord,
} from "../src/contracts.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const NOW = new Date("2026-08-20T12:00:00Z");

export function fixturePath(name: string): string {
  return join(ROOT, "fixtures", name);
}

export function loadJson(name: string): CommercialObservationSet {
  const text = readFileSync(fixturePath(name), "utf8");
  return JSON.parse(text) as CommercialObservationSet;
}

export function declaredFunnelCount(
  records: WarmblyCommercialRecord[] | null | undefined,
  key: FunnelKey,
): number {
  return (records ?? []).filter((row) => row.funnel_stage === key).length;
}

export function declaredOpenPipeline(records: WarmblyCommercialRecord[] | null | undefined): WarmblyCommercialRecord[] {
  return (records ?? []).filter((row) => {
    if (row.entity === "task") {
      return false;
    }
    const stage = row.funnel_stage;
    if (typeof stage !== "string" || !(FUNNEL_KEYS as readonly string[]).includes(stage)) {
      return false;
    }
    if (stage === "clientes") {
      return false;
    }
    const status = (row.status ?? "").toLowerCase();
    return status !== "won" && status !== "lost";
  });
}

export function provenanceFields(value: {
  source: unknown;
  observed_at: unknown;
  freshness_status: unknown;
}): string[] {
  const missing: string[] = [];
  if (!value.source || typeof value.source !== "object") {
    missing.push("source");
  }
  if (typeof value.observed_at !== "string") {
    missing.push("observed_at");
  }
  if (typeof value.freshness_status !== "string") {
    missing.push("freshness_status");
  }
  return missing;
}
