import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluatePncpFreshness } from "../src/index.js";
import type { PncpFreshnessEvaluation } from "../src/index.js";

const fixturesDir = fileURLToPath(new URL("../fixtures/", import.meta.url));

export function fixturePath(name: string): string {
  return path.join(fixturesDir, name);
}

export async function evaluateFixture(
  filename: string,
): Promise<PncpFreshnessEvaluation> {
  return evaluatePncpFreshness({
    kind: "health_artifact",
    artifactPath: fixturePath(filename),
  });
}
