import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluatePncpFreshness } from "../src/index.js";
import type { PncpFreshnessEvaluation } from "../src/index.js";

const fixturesDir = fileURLToPath(new URL("../fixtures/", import.meta.url));

export function fixturePath(name: string): string {
  return path.join(fixturesDir, name);
}

export async function readFixtureJson(name: string): Promise<unknown> {
  const raw = await readFile(fixturePath(name), "utf8");
  return JSON.parse(raw) as unknown;
}

export async function evaluateFixture(
  filename: string,
): Promise<PncpFreshnessEvaluation> {
  return evaluatePncpFreshness({
    kind: "file",
    filePath: fixturePath(filename),
    now: new Date("2026-08-20T12:00:00.000Z"),
  });
}
