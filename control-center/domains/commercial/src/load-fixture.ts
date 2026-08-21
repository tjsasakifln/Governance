import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CommercialObservationSet, CommercialSummary, ProjectOptions } from "./contracts.ts";
import { coerceObservationSet } from "./normalize.ts";
import { projectCommercialSummary } from "./project.ts";

export function loadObservationFile(path: string): CommercialObservationSet {
  const text = readFileSync(resolve(path), "utf8");
  const parsed: unknown = JSON.parse(text);
  return coerceObservationSet(parsed);
}

export function runFixture(path: string, opts: ProjectOptions = {}): CommercialSummary {
  const input = loadObservationFile(path);
  return projectCommercialSummary(input, opts);
}
