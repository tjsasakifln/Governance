import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { injectedGit } from "../src/git.js";
import { importGovernance } from "../src/index.js";
import type { GitMetadataProvider, ImportResult } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));

export const PACKAGE_ROOT = join(here, "..");
export const FIXTURE_ROOT = join(PACKAGE_ROOT, "fixtures", "synthetic-repo");
export const EXPLICIT_ADR = join(
  FIXTURE_ROOT,
  "decisions",
  "ADR-SYNTHETIC-EXPLICIT-001.md",
);
export const EXPLICIT_JSON = join(
  FIXTURE_ROOT,
  "commercial",
  "authority",
  "synthetic-decision.v1.json",
);
export const AMBIGUOUS_PROSE = join(
  FIXTURE_ROOT,
  "commercial",
  "notes",
  "ambiguous-prose.md",
);
export const UNCLASSIFIABLE = join(
  FIXTURE_ROOT,
  "commercial",
  "blobs",
  "unclassifiable.json",
);

export const FIXED_NOW = new Date("2026-08-20T15:00:00.000Z");
export const FIXED_SHA = "a1b2c3d4e5f6789012345678901234567890abcd";

export function fixtureGit(): GitMetadataProvider {
  return injectedGit(FIXED_SHA);
}

export function fixtureBytes(absPath: string): Uint8Array {
  return new Uint8Array(readFileSync(absPath));
}

export async function importFixtures(now: Date = FIXED_NOW): Promise<ImportResult> {
  return importGovernance({
    root: FIXTURE_ROOT,
    now,
    git: fixtureGit(),
    dryRun: true,
    persistEnabled: false,
  });
}
