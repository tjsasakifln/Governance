import {
  SOURCE_ID,
  type FreshnessStatus,
  type Provenance,
} from "./types.js";

export function toUtcIso(date: Date): string {
  return date.toISOString();
}

export function provenance(
  now: Date,
  freshness_status: FreshnessStatus,
  confidence?: number,
): Provenance {
  const base: Provenance = {
    source: SOURCE_ID,
    observed_at: toUtcIso(now),
    freshness_status,
  };
  if (confidence !== undefined) {
    return { ...base, confidence };
  }
  return base;
}

export function confidenceFor(freshness_status: FreshnessStatus): number {
  switch (freshness_status) {
    case "fresh":
      return 1;
    case "not_modified":
      return 0.95;
    case "stale":
      return 0.4;
    case "unsupported":
      return 0.5;
    case "failed":
      return 0;
  }
}

export function observationId(parts: ReadonlyArray<string | number>): string {
  return ["github", ...parts.map((part) => encodeURIComponent(String(part)))].join(
    ":",
  );
}

export function snapshotId(allowlist: readonly string[]): string {
  const sorted = [...allowlist].map((item) => item.toLowerCase()).sort();
  return observationId(["engineering_snapshot", sorted.join(",")]);
}

export function parseRepoFullName(value: string): { owner: string; name: string; full_name: string } | null {
  const trimmed = value.trim();
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const owner = match[1];
  const name = match[2];
  if (!owner || !name) {
    return null;
  }
  return { owner, name, full_name: `${owner}/${name}` };
}
